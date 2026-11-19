from __future__ import annotations

import json
import os
import random
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional, Sequence, Union

import httpx

from ._errors import PoliticalCommsError

DEFAULT_BASE_URL = "https://api.politicalcomms.com/v1"
# Retries after the first attempt, so 5 attempts total by default.
DEFAULT_MAX_RETRIES = 4
BACKOFF_BASE_SECONDS = 1.0
BACKOFF_CAP_SECONDS = 60.0
RETRYABLE_STATUS = frozenset({500, 502, 503, 504})

JsonDict = dict[str, Any]

@dataclass(frozen=True)
class RateLimitState:
    """Rate limit state parsed from the most recent response headers."""

    limit: int
    remaining: int
    reset: int

def _backoff_delay(attempt: int) -> float:
    capped = min(BACKOFF_CAP_SECONDS, BACKOFF_BASE_SECONDS * (2**attempt))
    # Jitter: 50 to 100 percent of the capped delay.
    return capped * (0.5 + random.random() * 0.5)

class PoliticalCommsClient:
    """Synchronous client for the Political Comms REST API.

    Mirrors the TypeScript SDK (@political-comms/sdk): one method per API
    operation, automatic Idempotency-Key headers on writes, and built-in
    retries. 429 responses are retried after waiting until the
    X-RateLimit-Reset timestamp; 500/502/503/504 are retried with exponential
    backoff and jitter (1s base, 60s cap, at most 5 attempts total);
    400/401/403/404 are never retried.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: str = DEFAULT_BASE_URL,
        max_retries: int = DEFAULT_MAX_RETRIES,
        timeout: float = 30.0,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        key = api_key or os.environ.get("POLITICAL_COMMS_API_KEY")
        if not key:
            raise ValueError(
                "Missing Political Comms API key. Pass api_key to PoliticalCommsClient or set "
                "the POLITICAL_COMMS_API_KEY environment variable. Keys are created in the "
                "dashboard under Admin > API."
            )
        self._api_key = key
        self._max_retries = max_retries
        self.base_url = base_url.rstrip("/")
        #: Rate limit state from the most recent response, or None.
        self.last_rate_limit: Optional[RateLimitState] = None
        self._http = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            transport=transport,
            headers={"Accept": "application/json"},
        )

    # -- lifecycle ----------------------------------------------------------

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "PoliticalCommsClient":
        return self

    def __exit__(self, *exc_info: Any) -> None:
        self.close()

    # -- organizations and hierarchy ----------------------------------------

    def list_organizations(self) -> JsonDict:
        """GET /organizations"""
        return self._request("GET", "/organizations")

    def get_hierarchy(self, *, organization_id: Optional[str] = None) -> JsonDict:
        """GET /hierarchy"""
        return self._request("GET", "/hierarchy", query={"organizationId": organization_id})

    # -- brands, campaigns, tracking domains, phone numbers -------------------

    def list_brands(self, *, organization_id: Optional[str] = None) -> JsonDict:
        """GET /brands"""
        return self._request("GET", "/brands", query={"organization_id": organization_id})

    def list_campaigns(
        self,
        *,
        organization_id: Optional[str] = None,
        brand_id: Optional[str] = None,
    ) -> JsonDict:
        """GET /campaigns"""
        return self._request(
            "GET",
            "/campaigns",
            query={"organization_id": organization_id, "brand_id": brand_id},
        )

    def get_campaign_throughput(self, id: str) -> JsonDict:
        """GET /campaigns/{id}/throughput

        The brand's T-Mobile daily cap (``t_mobile``: ``daily_cap``,
        ``used_today``, ``remaining_today``, ``pacific_day``) and AT&T
        per-minute rates (``att``: ``sms_tpm``, ``mms_tpm``), counted in
        message parts: a two-part text counts twice. The lanes are
        independent: ``t_mobile`` is None when the brand has no T-Mobile daily
        limit on file (so ``daily_cap`` is always an integer when present), and
        ``att`` is None only when the campaign has no AT&T rate on file.
        ``carrier_metered`` is True if either applies; False with both None
        when neither does. ``used_today`` / ``remaining_today`` are None
        when usage is temporarily unavailable (never zero).
        """
        return self._request("GET", f"/campaigns/{id}/throughput")

    def list_tracking_domains(self, *, organization_id: Optional[str] = None) -> JsonDict:
        """GET /tracking-domains"""
        return self._request("GET", "/tracking-domains", query={"organization_id": organization_id})

    def list_phone_numbers(
        self,
        *,
        organization_id: Optional[str] = None,
        brand_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
        channel: Optional[str] = None,
        owner_type: Optional[str] = None,
    ) -> JsonDict:
        """GET /phone-numbers"""
        return self._request(
            "GET",
            "/phone-numbers",
            query={
                "organization_id": organization_id,
                "brand_id": brand_id,
                "campaign_id": campaign_id,
                "channel": channel,
                "owner_type": owner_type,
            },
        )

    # -- toll-free verifications ----------------------------------------------

    def list_toll_free_verifications(
        self,
        *,
        organization_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> JsonDict:
        """GET /toll-free-verifications"""
        return self._request(
            "GET",
            "/toll-free-verifications",
            query={"organization_id": organization_id, "status": status},
        )

    def get_toll_free_verification(self, id: str) -> JsonDict:
        """GET /toll-free-verifications/{id}"""
        return self._request("GET", f"/toll-free-verifications/{id}")

    # -- contact lists ---------------------------------------------------------

    def list_contact_lists(
        self,
        *,
        organization_id: Optional[str] = None,
        brand_id: Optional[str] = None,
        channel: Optional[str] = None,
    ) -> JsonDict:
        """GET /contact-lists

        ``channel`` is ``"text"`` (the default: lists that hold phone numbers),
        ``"email"``, or ``"all"``. Each list reports its ``channels``.
        """
        return self._request(
            "GET",
            "/contact-lists",
            query={"organization_id": organization_id, "brand_id": brand_id, "channel": channel},
        )

    def get_contact_list(self, id: str) -> JsonDict:
        """GET /contact-lists/{id}

        The result includes ``available_merge_tags``: each merge tag the list
        offers, the column it reads, and whether it is a standard field. When
        ``import.status`` or ``email.status`` is ``failed``, that side's
        ``error`` (``{"code", "message"}``, ``None`` otherwise) says why; the
        message is safe to show an end user.
        """
        return self._request("GET", f"/contact-lists/{id}")

    def import_contact_list(
        self,
        source_url: str,
        list_name: str,
        phone_column: Optional[str] = None,
        *,
        email_column: Optional[str] = None,
        purpose: Optional[str] = None,
        organization_id: Optional[str] = None,
        brand_id: Optional[str] = None,
        merge_tags: Optional[JsonDict] = None,
        consent: Optional[JsonDict] = None,
        email_domain_id: Optional[str] = None,
        acquired: Optional[bool] = None,
        tag_ids: Optional[Sequence[str]] = None,
        tag_names: Optional[Sequence[str]] = None,
        tags_column: Optional[str] = None,
        fire_triggers: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /contact-lists/import

        The one list import. The server fetches ``source_url`` (https, 50 MB
        cap) and returns 202. Send ``phone_column``, ``email_column``, or
        both; the two must differ, and there is no automatic email column
        detection. ``email_column`` needs email enabled for the organization
        (403 ``ENTITLEMENT_REQUIRED``).

        ``purpose`` is ``"audience"`` (the default) or ``"do_not_contact"``,
        which turns phones into an opt-out list and emails into unsubscribes
        and returns no ``list_id``. ``consent`` is ``{"source": str, "note":
        str | None}``, source one of donation_form, petition, signup_form,
        event, purchased, rented, or other; it is optional (omit it and no
        consent record is stored), allowed only for an audience list with an
        email column, and a 400 otherwise. ``email_domain_id`` scopes the
        emails to one sending domain (omit for the whole organization);
        ``acquired`` (default false) marks emails that were purchased or
        rented, which are sent more gradually.

        When ``merge_tags`` is omitted or maps nothing, every non-phone column
        gets a merge tag automatically: a header that matches a standard field
        gets the standard tag, and any other column gets a tag named after its
        header in lowercase with underscores. When ``merge_tags`` is supplied,
        phones map only the named columns, while emails map the named columns
        and also every remaining column by its default name; with an email
        column, custom field names must match ``^[a-z][a-z0-9_]{0,63}$``.
        Unknown keys inside ``merge_tags`` or ``consent`` are a 400; unknown
        top-level fields are ignored.

        An ``audience`` import can tag its contacts: ``tag_ids`` (up to 20
        manual tag ids) and ``tag_names`` (up to 20 names, created if missing)
        tag every contact; ``tags_column`` names a header whose cells hold tag
        names separated by commas, semicolons, or pipes. A column that would
        create more than 100 new tags fails the import (``import.status``
        ``failed``). ``fire_triggers`` (default false) enters the contacts the
        import newly tags into those tags' live triggers (a tag's
        ``live_triggers`` on :meth:`list_tags`), which MESSAGES them; the 202
        echoes it.

        Poll ``get_contact_list(list_id)``: ``import`` is the phone side and
        ``email.status`` is the email side.
        """
        body = _compact(
            {
                "source_url": source_url,
                "organization_id": organization_id,
                "brand_id": brand_id,
                "list_name": list_name,
                "purpose": purpose,
                "phone_column": phone_column,
                "email_column": email_column,
                "merge_tags": merge_tags,
                "consent": consent,
                "email_domain_id": email_domain_id,
                "acquired": acquired,
                "tag_ids": _list(tag_ids),
                "tag_names": _list(tag_names),
                "tags_column": tags_column,
                "fire_triggers": fire_triggers,
            }
        )
        return self._request("POST", "/contact-lists/import", body=body, idempotency_key=idempotency_key)

    def analyze_contact_list(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """POST /contact-lists/{id}/analyze

        Billable per lookup, charged to the list's organization. Returns 202
        with `cost_cents` and `numbers_queued`, or 200 with `analysis.status`
        `complete` (cost 0) when nothing is left to analyze; a run already in
        progress returns 202 with cost 0. An insufficient balance raises a 402
        `INSUFFICIENT_BALANCE` with nothing queued. The client sends an
        Idempotency-Key automatically, so a retry is not charged twice. Poll
        `get_contact_list` until `analysis.status` is `complete`, or subscribe
        to the `contact_list.analyzed` webhook.
        """
        return self._request("POST", f"/contact-lists/{id}/analyze", idempotency_key=idempotency_key)

    def download_contact_list(self, id: str, type: str) -> str:
        """GET /contact-lists/{id}/download?type=original|analyzed

        Returns the CSV text. `original` has the phone number, original row,
        and custom fields; `analyzed` adds phone type, carrier, mobile flag,
        opt-out flag, city, and state. Requesting `analyzed` before
        `analysis.status` is `complete` raises a 409 `ANALYSIS_NOT_COMPLETE`.
        """
        return self._send(
            "GET",
            f"/contact-lists/{id}/download",
            query={"type": type},
            accept="text/csv",
        ).text

    def delete_contact_list(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """DELETE /contact-lists/{id}

        Needs an API key with the `public:delete` permission (and `public:write`);
        other keys get a 403.

        Removes the list's phone numbers and its emails. A list referenced by any project cannot be deleted; the API returns
        409 CONTACT_LIST_IN_USE with the referencing projects in the details.
        """
        return self._request("DELETE", f"/contact-lists/{id}", idempotency_key=idempotency_key)

    # -- tags --------------------------------------------------------------------
    #
    # A tag labels a contact (a phone number or an email address). A tagged
    # contact is only sent to through a list row the sender can use, so a tag
    # never reaches anyone who is on no such list.

    def list_tags(self, *, organization_id: Optional[str] = None) -> JsonDict:
        """GET /tags

        Every tag of one organization (the key's own unless ``organization_id``
        names another it reaches), sorted by name; not paginated. Each tag has
        ``kind`` ``"manual"`` or ``"activity"``; a manual tag's
        ``member_count`` is capped at 10000 (``member_count_capped``), and an
        activity tag's is ``None``. ``live_triggers`` lists the started
        triggered projects and campaigns listening for the tag (``[{"id",
        "name", "channel": "text" | "email"}]``, empty when none): tagging
        contacts into such a tag messages them unless ``fire_triggers`` is
        false.
        """
        return self._request("GET", "/tags", query={"organization_id": organization_id})

    def create_tag(
        self,
        name: Optional[str] = None,
        *,
        activity_event: Optional[str] = None,
        within_days: Optional[int] = None,
        organization_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /tags

        A manual tag by ``name`` (1-64 characters; 409 ``TAG_NAME_TAKEN`` when
        the organization has it, ignoring case), or an activity tag by
        ``activity_event`` (``donated``, ``clicked``, ``responded``, ``sent``)
        and optional ``within_days`` (1-365). Creating an activity tag that
        already exists returns it with a 200.
        """
        body = _compact(
            {
                "name": name,
                "activity_event": activity_event,
                "within_days": within_days,
                "organization_id": organization_id,
            }
        )
        return self._request("POST", "/tags", body=body, idempotency_key=idempotency_key)

    def rename_tag(self, id: str, name: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """PATCH /tags/{id}

        Manual tags only (400 ``TAG_NOT_MANUAL``); 409 ``TAG_NAME_TAKEN`` on a clash.
        """
        return self._request("PATCH", f"/tags/{id}", body={"name": name}, idempotency_key=idempotency_key)

    def delete_tag(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """DELETE /tags/{id}

        Needs an API key with the `public:delete` permission (and `public:write`).
        A 409 ``TAG_IN_USE`` carries ``body["details"]`` =
        ``{"projects": [{"id", "name", "status"}], "emailCampaigns": [...]}``:
        the scheduled, compiling, active, sending, or paused sends using the
        tag (up to 10 each). Drafts and finished sends never block a delete.
        """
        return self._request("DELETE", f"/tags/{id}", idempotency_key=idempotency_key)

    def add_tag_contacts(
        self,
        id: str,
        identifiers: Optional[Sequence[str]] = None,
        *,
        contact_list_id: Optional[str] = None,
        fire_triggers: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /tags/{id}/contacts

        Pass exactly one of ``identifiers`` (1-10000 US phone numbers in any
        common format, or email addresses) and ``contact_list_id`` (every
        active phone and subscribed address on that list). ``identifiers``
        return ``added`` and ``invalid`` counts. A ``contact_list_id`` is tagged in the background: the
        API answers 202 with ``{"queued": True, "job_id": ...}`` and no counts.
        There is no job status endpoint; the outcome shows as the tag's
        ``member_count`` on :meth:`list_tags` once the job finishes.
        Manual tags only (400 ``TAG_NOT_MANUAL``); a 409 ``TAG_BUSY`` means
        an import is writing the same contacts, so retry in about a minute.

        ``fire_triggers`` says whether newly tagged contacts enter the tag's
        live triggers, which MESSAGES them. The API defaults it to true for
        ``identifiers`` and false for a ``contact_list_id``; ``None`` leaves
        that default. A 200 then carries ``triggers: {"entered": n}`` when the
        tag has live triggers, and a 202 echoes ``fire_triggers``.
        """
        return self._request(
            "POST",
            f"/tags/{id}/contacts",
            body=_compact({**_tag_contacts(identifiers, contact_list_id), "fire_triggers": fire_triggers}),
            idempotency_key=idempotency_key,
        )

    def remove_tag_contacts(
        self,
        id: str,
        identifiers: Optional[Sequence[str]] = None,
        *,
        contact_list_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """DELETE /tags/{id}/contacts

        Same body as :meth:`add_tag_contacts`. Needs an API key with the
        `public:delete` permission (and `public:write`). ``identifiers``
        return ``removed``, ``not_tagged``, and ``invalid`` counts; a
        ``contact_list_id`` is queued as for :meth:`add_tag_contacts`.
        """
        return self._request(
            "DELETE",
            f"/tags/{id}/contacts",
            body=_tag_contacts(identifiers, contact_list_id),
            idempotency_key=idempotency_key,
        )

    def tag_contacts(
        self,
        name: str,
        identifiers: Optional[Sequence[str]] = None,
        *,
        contact_list_id: Optional[str] = None,
        organization_id: Optional[str] = None,
        fire_triggers: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /tags/contacts

        Tags contacts with the manual tag named ``name`` (1-64 characters,
        matched ignoring case), creating it when the organization has none.
        Same sources as :meth:`add_tag_contacts`. Returns the ``tag``,
        ``created`` (true only when this call created it, which catches a
        misspelled name), and ``added`` and ``invalid`` counts, or, for a
        ``contact_list_id``, ``queued`` and ``job_id`` as for
        :meth:`add_tag_contacts` (the tag is still created by this call). A
        name matching an activity tag's generated name makes a manual tag
        beside it. ``fire_triggers`` as for :meth:`add_tag_contacts`.
        """
        return self._request(
            "POST",
            "/tags/contacts",
            body=_compact(
                {**_tag_by_name(name, organization_id, identifiers, contact_list_id), "fire_triggers": fire_triggers}
            ),
            idempotency_key=idempotency_key,
        )

    def untag_contacts(
        self,
        name: str,
        identifiers: Optional[Sequence[str]] = None,
        *,
        contact_list_id: Optional[str] = None,
        organization_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """DELETE /tags/contacts

        Same arguments as :meth:`tag_contacts`, but never creates a tag (404
        ``NOT_FOUND`` when none has that name). Needs an API key with the
        `public:delete` permission (and `public:write`). Returns the ``tag``
        and ``removed``, ``not_tagged``, and ``invalid`` counts, or ``queued``
        and ``job_id`` for a ``contact_list_id``.
        """
        return self._request(
            "DELETE",
            "/tags/contacts",
            body=_tag_by_name(name, organization_id, identifiers, contact_list_id),
            idempotency_key=idempotency_key,
        )

    # -- media -------------------------------------------------------------------

    def list_media(
        self,
        *,
        organization_id: Optional[str] = None,
        brand_id: Optional[str] = None,
    ) -> JsonDict:
        """GET /media"""
        return self._request(
            "GET",
            "/media",
            query={"organization_id": organization_id, "brand_id": brand_id},
        )

    def import_media(
        self,
        source_url: str,
        *,
        organization_id: Optional[str] = None,
        brand_id: Optional[str] = None,
        name: Optional[str] = None,
        usage: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /media

        usage is "mms" (the default) or "email_asset". MMS attachments are
        brand-scoped; email assets are organization-scoped, so brand_id must be
        omitted for them. Sending both is refused with a 400 VALIDATION_ERROR
        rather than the brand being ignored.
        """
        body = _compact(
            {
                "source_url": source_url,
                "organization_id": organization_id,
                "brand_id": brand_id,
                "name": name,
                "usage": usage,
            }
        )
        return self._request("POST", "/media", body=body, idempotency_key=idempotency_key)

    def get_media(self, id: str) -> JsonDict:
        """GET /media/{id}"""
        return self._request("GET", f"/media/{id}")

    def delete_media(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """DELETE /media/{id}

        Needs an API key with the `public:delete` permission (and `public:write`);
        other keys get a 403.

        A file referenced by any project cannot be deleted; the API returns
        409 MEDIA_IN_USE with the referencing projects in the details.
        """
        return self._request("DELETE", f"/media/{id}", idempotency_key=idempotency_key)

    # -- projects -------------------------------------------------------------------

    def list_projects(
        self,
        *,
        organization_id: Optional[str] = None,
        brand_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
        type: Optional[str] = None,
    ) -> JsonDict:
        """GET /projects

        ``type`` filters to "broadcast" or "survey" projects.
        """
        return self._request(
            "GET",
            "/projects",
            query={
                "organization_id": organization_id,
                "brand_id": brand_id,
                "campaign_id": campaign_id,
                "type": type,
            },
        )

    def create_project(
        self,
        organization_id: str,
        name: str,
        protocol: Optional[str] = None,
        message_text: Optional[str] = None,
        phone_number_ids: Optional[Sequence[str]] = None,
        contact_list_ids: Optional[Sequence[str]] = None,
        *,
        channel: Optional[str] = None,
        brand_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
        toll_free_verification_id: Optional[str] = None,
        suppression_list_ids: Optional[Sequence[str]] = None,
        tag_ids: Optional[Sequence[str]] = None,
        require_tag_ids: Optional[Sequence[str]] = None,
        suppression_tag_ids: Optional[Sequence[str]] = None,
        media_ids: Optional[Sequence[str]] = None,
        link_tracking_enabled: Optional[bool] = None,
        link_tracking_links: Optional[Sequence[JsonDict]] = None,
        link_tracking_destination_url: Optional[str] = None,
        link_tracking_domain_id: Optional[str] = None,
        link_tracking_param_field: Optional[str] = None,
        link_tracking_fallback_url: Optional[str] = None,
        opt_out_footer_enabled: Optional[bool] = None,
        type: Optional[str] = None,
        trigger: Optional[JsonDict] = None,
        follow_ups: Optional[JsonDict] = None,
        scheduled_timezone: Optional[str] = None,
        sequence_send_time: Optional[str] = None,
        questions: Optional[Sequence[JsonDict]] = None,
        ai_survey_analysis_enabled: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /projects

        Returns ``403 ONBOARDING_INCOMPLETE`` if the organization's 14-day
        setup grace window has passed and the business profile or funding
        step is still incomplete; the error's ``body["details"]`` carries
        ``missingSteps`` (``"profile"`` and/or ``"funding"``) and
        ``onboardingUrl``. Returns ``409 SENDING_PAUSED`` if sending is
        paused for the organization or platform-wide; the error's
        ``body["details"]["scope"]`` is ``"organization"`` or ``"platform"``.

        ``type`` is ``"broadcast"`` (default), ``"survey"``, or ``"triggered"``.
        ``phone_number_ids`` is required for every type, and ``protocol`` and
        ``message_text`` for a broadcast or triggered project.

        A survey (``type="survey"``) sends ``questions`` instead of a message,
        so it takes no ``protocol``, ``message_text``, ``media_ids``,
        ``follow_ups``, ``opt_out_footer_enabled``, or ``brand_id``; it needs
        ``campaign_id`` on every channel. ``questions`` is the full flow, 2-32
        dicts: ``{"sequence": n, "question_type": "intro" |
        "multiple_choice" | "open_ended" | "outro", "question_text": ...}``,
        numbered 1..N with the ``intro`` first. A ``multiple_choice`` question
        takes 2-9 ``response_options`` (``{"value": 1-9, "label": ...,
        "next_sequence": n}``); ``no_match_sequence`` branches on a reply that
        matches none; branches point to a later question. Optional per
        question: ``message_type`` (``"sms"`` or ``"mms"`` with ``media_ids``)
        and ``is_required``. Only recipients who reply move on.
        ``ai_survey_analysis_enabled`` classifies unmatched replies with AI,
        billed per analyzed reply. A mixed body raises ``ValueError`` before
        any request.

        A triggered project has no contact list: pass ``type="triggered"`` and a
        ``trigger`` dict (``{"source": "api" | "donation" | "event" | "tag",
        ...}``) and leave out ``contact_list_ids`` and
        ``suppression_list_ids``. Test it with :meth:`test_project`, then
        :meth:`start_project`. Each phone number is sent it at most once. The
        trigger's ``start`` is ``"immediate"`` (default, after
        ``delay_minutes``) or ``"next_day"`` (the day after it fired, at
        ``sequence_send_time`` ``"HH:MM"`` in ``scheduled_timezone``, both then
        required; ``delay_minutes`` 0). A tag trigger is ``{"source": "tag",
        "tag": {"tag_ids": [...]}}`` (1-20 manual tags): a newly tagged phone
        enters it, and re-tagging never fires.

        ``follow_ups`` (broadcast and triggered projects; a survey refuses it)
        is ``{"steps": [{"message_text": ..., "media_ids": [...], "wait":
        {"unit": "days" | "hours", "amount": n}}], "stop_on_reply": bool,
        "stop_on_click": bool}``: 1-9 texts after the first message, days 1-365
        (sent at ``sequence_send_time`` in ``scheduled_timezone``, both then
        required) or hours 1-72; media only on an MMS project. A person stops
        getting them on a reply (``stop_on_reply``), a tracked-link click
        (``stop_on_click``), or an opt-out; at least one flag must be true.
        Each follow-up is charged when it sends; a person whose first message
        failed gets none. A broadcast takes ``scheduled_timezone`` and
        ``sequence_send_time`` at create only for follow-ups that wait days.

        ``contact_list_ids`` is optional: a project with neither a list nor a
        ``tag_ids`` entry is created in draft status, and it cannot be tested
        or scheduled until one is attached via ``update_project``. An
        explicitly empty list is rejected.

        Tags (up to 50 ids each): ``tag_ids`` also sends to contacts carrying
        ANY of these tags, in union with the lists; ``require_tag_ids`` keeps
        only recipients carrying ALL of them; ``suppression_tag_ids`` leaves
        out recipients carrying any of them. A tag cannot be both a source or
        required tag and a suppression tag (400). A tagged phone is only sent
        to when it is on a live list the project's sender can use (unscoped,
        or scoped to the project's own brand, toll-free number, or short code).
        Survey projects take the tag fields too; triggered projects refuse them.

        Raises a 409 ``LIST_ANALYSIS_IN_PROGRESS`` while a contact list on the
        project is being analyzed; wait for ``analysis.status`` ``complete``.
        A 409 ``LIST_ARCHIVED`` names a list whose contacts were removed 12
        months after upload; choose another list or upload the file again.

        ``opt_out_footer_enabled`` controls the automatic "STOP=END" footer
        (default ``True``).

        ``link_tracking_links`` is a list of up to 3 tracked links per message
        (1 to 3 on create), each ``{"destination_url": ..., "param_fields":
        [...], "fallback_url": ...}`` with up to 10 unique ``param_fields``
        (``"phone"`` or a contact field name). Entry order is tag order:
        ``{tracking_url}``, ``{tracking_url_2}``, ``{tracking_url_3}``; each tag
        becomes that recipient's own short link, and a tag with no link behind
        it is rejected when link tracking is enabled. A ``{field}`` placeholder
        in a ``destination_url`` (e.g. ``?utm_content=xyzd_{linkid}``) must be
        one of that link's ``param_fields``; fields without a placeholder are
        appended as ``&field=value`` after ``short_id``. A destination may also
        be exactly ``https://{<field>}`` (e.g. ``https://{custom_url}``) to send
        each recipient to the URL in their own contact field; then that link's
        ``fallback_url`` is required and catches recipients whose value is empty
        or not a valid URL. ``{phone}`` is not allowed as a whole URL.
        ``link_tracking_destination_url``, ``link_tracking_param_field`` and
        ``link_tracking_fallback_url`` are aliases for the first link; sending
        them together with ``link_tracking_links`` is a 400.
        """
        message_args = {
            "protocol": protocol,
            "message_text": message_text,
            "media_ids": media_ids,
            "opt_out_footer_enabled": opt_out_footer_enabled,
            "follow_ups": follow_ups,
            "trigger": trigger,
            "brand_id": brand_id,
            "toll_free_verification_id": toll_free_verification_id,
            "scheduled_timezone": scheduled_timezone,
            "sequence_send_time": sequence_send_time,
        }
        if type == "survey":
            _refuse(message_args, "A survey sends questions, not a message")
            if questions is None or campaign_id is None:
                raise ValueError("A survey needs questions and campaign_id")
        else:
            _refuse(
                {"questions": questions, "ai_survey_analysis_enabled": ai_survey_analysis_enabled},
                'Only a survey (type="survey") takes questions',
            )
            if protocol is None or message_text is None:
                raise ValueError("A broadcast or triggered project needs protocol and message_text")
        if phone_number_ids is None:
            raise ValueError("create_project needs phone_number_ids")
        body = _compact(
            {
                "organization_id": organization_id,
                "channel": channel,
                "brand_id": brand_id,
                "campaign_id": campaign_id,
                "toll_free_verification_id": toll_free_verification_id,
                "phone_number_ids": list(phone_number_ids),
                "name": name,
                "protocol": protocol,
                "contact_list_ids": list(contact_list_ids) if contact_list_ids is not None else None,
                "suppression_list_ids": list(suppression_list_ids) if suppression_list_ids else None,
                "tag_ids": _list(tag_ids),
                "require_tag_ids": _list(require_tag_ids),
                "suppression_tag_ids": _list(suppression_tag_ids),
                "message_text": message_text,
                "media_ids": list(media_ids) if media_ids else None,
                "link_tracking_enabled": link_tracking_enabled,
                "link_tracking_links": list(link_tracking_links) if link_tracking_links is not None else None,
                "link_tracking_destination_url": link_tracking_destination_url,
                "link_tracking_domain_id": link_tracking_domain_id,
                "link_tracking_param_field": link_tracking_param_field,
                "link_tracking_fallback_url": link_tracking_fallback_url,
                "opt_out_footer_enabled": opt_out_footer_enabled,
                "type": type,
                "trigger": trigger,
                "follow_ups": follow_ups,
                "scheduled_timezone": scheduled_timezone,
                "sequence_send_time": sequence_send_time,
                "questions": list(questions) if questions is not None else None,
                "ai_survey_analysis_enabled": ai_survey_analysis_enabled,
            }
        )
        return self._request("POST", "/projects", body=body, idempotency_key=idempotency_key)

    def get_all_project_stats(
        self,
        start_date: str,
        end_date: str,
        *,
        organization_id: Optional[str] = None,
        brand_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> JsonDict:
        """GET /projects/stats"""
        return self._request(
            "GET",
            "/projects/stats",
            query={
                "startDate": start_date,
                "endDate": end_date,
                "organizationId": organization_id,
                "brandId": brand_id,
                "campaignId": campaign_id,
                "status": status,
                "limit": str(limit) if limit is not None else None,
                "offset": str(offset) if offset is not None else None,
            },
        )

    def get_project(self, id: str) -> JsonDict:
        """GET /projects/{id}"""
        return self._request("GET", f"/projects/{id}")

    def update_project(
        self,
        id: str,
        *,
        channel: Optional[str] = None,
        brand_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
        toll_free_verification_id: Optional[str] = None,
        name: Optional[str] = None,
        message_text: Optional[str] = None,
        protocol: Optional[str] = None,
        phone_number_ids: Optional[Sequence[str]] = None,
        contact_list_ids: Optional[Sequence[str]] = None,
        suppression_list_ids: Optional[Sequence[str]] = None,
        tag_ids: Optional[Sequence[str]] = None,
        require_tag_ids: Optional[Sequence[str]] = None,
        suppression_tag_ids: Optional[Sequence[str]] = None,
        media_ids: Optional[Sequence[str]] = None,
        link_tracking_enabled: Optional[bool] = None,
        link_tracking_links: Optional[Sequence[JsonDict]] = None,
        link_tracking_destination_url: Optional[str] = None,
        link_tracking_domain_id: Optional[str] = None,
        link_tracking_param_field: Optional[str] = None,
        link_tracking_fallback_url: Optional[str] = None,
        opt_out_footer_enabled: Optional[bool] = None,
        trigger: Optional[JsonDict] = None,
        follow_ups: Optional[JsonDict] = None,
        clear_follow_ups: bool = False,
        scheduled_timezone: Optional[str] = None,
        sequence_send_time: Optional[str] = None,
        questions: Optional[Sequence[JsonDict]] = None,
        ai_survey_analysis_enabled: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """PATCH /projects/{id}

        Raises a 409 ``LIST_ANALYSIS_IN_PROGRESS`` while a contact list on the
        project is being analyzed; wait for ``analysis.status`` ``complete``.
        A 409 ``LIST_ARCHIVED`` names a list whose contacts were removed 12
        months after upload; choose another list or upload the file again.

        Editable in ``draft``, ``awaiting_test``, ``ready``, and ``paused``;
        any edit moves the project to ``awaiting_test``. To resume a paused
        project after an edit: ``update_project``, then ``test_project``, then
        ``schedule_project``. Only ``organization_id`` and ``type`` are
        immutable. Sending any of ``channel`` (``10dlc``, ``toll-free``,
        ``short-code``), ``brand_id``, ``campaign_id``, or
        ``toll_free_verification_id`` requires the full setup for the
        effective channel plus ``phone_number_ids``: 10dlc needs ``brand_id``
        and ``campaign_id``; toll-free needs ``toll_free_verification_id``;
        short-code takes none. Send new list and media ids in the same request
        when the old ones belong to the old brand or registration (400
        ``ASSET_OUT_OF_SCOPE``); a suspended campaign returns 409
        ``CAMPAIGN_SUSPENDED`` and an expired one 409 ``CAMPAIGN_EXPIRED``.

        ``opt_out_footer_enabled`` toggles the automatic "STOP=END" footer.
        ``link_tracking_links`` replaces the project's tracked links (see
        ``create_project``); ``link_tracking_fallback_url`` is required whenever
        ``link_tracking_destination_url`` is a whole-URL placeholder such as
        ``https://{custom_url}``. ``trigger`` replaces
        the trigger of a triggered project (triggered projects only; a tag
        trigger's tags cannot change after it has started).

        ``follow_ups`` replaces the follow-ups (see ``create_project``) and
        ``clear_follow_ups=True`` removes them (sends ``null``). Once the
        project has started a changed value is a 409 ``CONFLICT``.
        ``scheduled_timezone`` and ``sequence_send_time`` can still change
        after start: people already waiting get their next message at the new
        time, and nothing already sent is re-sent.

        ``tag_ids``, ``require_tag_ids``, and ``suppression_tag_ids`` replace
        the project's tags; see ``create_project``. An empty list clears a
        field: ``contact_list_ids=[]`` is accepted while the project keeps a
        ``tag_ids`` entry (or is a draft), and ``suppression_list_ids=[]`` or
        ``media_ids=[]`` removes them all. ``None`` leaves a field unchanged.

        Survey projects take ``name``, the phone number, list, tag, and link
        tracking fields, ``ai_survey_analysis_enabled``, and ``questions``,
        which replaces the whole set (see ``create_project``); the channel and
        campaign are fixed. Passing ``questions`` or
        ``ai_survey_analysis_enabled`` with a message's fields raises
        ``ValueError`` before any request.
        """
        if questions is not None or ai_survey_analysis_enabled is not None:
            _refuse(
                {
                    "channel": channel,
                    "brand_id": brand_id,
                    "campaign_id": campaign_id,
                    "toll_free_verification_id": toll_free_verification_id,
                    "message_text": message_text,
                    "protocol": protocol,
                    "media_ids": media_ids,
                    "opt_out_footer_enabled": opt_out_footer_enabled,
                    "trigger": trigger,
                    "follow_ups": follow_ups,
                    "clear_follow_ups": clear_follow_ups or None,
                    "scheduled_timezone": scheduled_timezone,
                    "sequence_send_time": sequence_send_time,
                },
                "A survey update cannot carry a message's fields",
            )
        body = _compact(
            {
                "channel": channel,
                "brand_id": brand_id,
                "campaign_id": campaign_id,
                "toll_free_verification_id": toll_free_verification_id,
                "name": name,
                "message_text": message_text,
                "protocol": protocol,
                "phone_number_ids": list(phone_number_ids) if phone_number_ids else None,
                "contact_list_ids": _list(contact_list_ids),
                "suppression_list_ids": _list(suppression_list_ids),
                "tag_ids": _list(tag_ids),
                "require_tag_ids": _list(require_tag_ids),
                "suppression_tag_ids": _list(suppression_tag_ids),
                "media_ids": _list(media_ids),
                "link_tracking_enabled": link_tracking_enabled,
                "link_tracking_links": list(link_tracking_links) if link_tracking_links is not None else None,
                "link_tracking_destination_url": link_tracking_destination_url,
                "link_tracking_domain_id": link_tracking_domain_id,
                "link_tracking_param_field": link_tracking_param_field,
                "link_tracking_fallback_url": link_tracking_fallback_url,
                "opt_out_footer_enabled": opt_out_footer_enabled,
                "trigger": trigger,
                "follow_ups": follow_ups,
                "scheduled_timezone": scheduled_timezone,
                "sequence_send_time": sequence_send_time,
                "questions": list(questions) if questions is not None else None,
                "ai_survey_analysis_enabled": ai_survey_analysis_enabled,
            }
        )
        if clear_follow_ups:
            if follow_ups is not None:
                raise ValueError("Pass follow_ups or clear_follow_ups, not both")
            # _compact drops None, so the clearing null is added after it.
            body["follow_ups"] = None
        return self._request("PATCH", f"/projects/{id}", body=body, idempotency_key=idempotency_key)

    def get_project_stats(self, id: str) -> JsonDict:
        """GET /projects/{id}/stats

        The response nests production counters under ``metrics`` and carries a
        ``test`` object with test-send activity (sent/delivered/failed/replies/
        clicks) tracked separately - ``metrics`` excludes test traffic. The
        test counters form a pipeline: ``sent`` holds only tests awaiting a
        delivery outcome and moves into ``delivered``/``failed`` on the DLR.
        ``cost_breakdown`` lists the project's cost per product (``code`` such as
        ``sms_outbound`` or ``mms_inbound``, with ``messages``, ``segments`` and
        ``cost``), net of refunds and summing to the project total; ``messages``
        is ``None`` when the billing record cannot state a count. Each entry also
        has ``replies``: ``{"messages", "segments", "cost"}`` for the part of an
        outbound product that is the automatic replies sent to STOP, START and
        HELP (included in the entry's own figures, not added on top), or ``None``
        for inbound products, when there are none, or when an older billing
        record cannot split them.
        """
        return self._request("GET", f"/projects/{id}/stats")

    def get_project_survey_results(self, id: str) -> JsonDict:
        """GET /projects/{id}/survey-results

        Topline survey results: per-question option counts and percentages, the
        unmatched/open-ended "other" bucket (``other_count``/``other_percentage``),
        and overall ``completion_rate``/``dropoff_rate``. The numbers match the
        survey results page in the dashboard. Raises a 409 ``NOT_A_SURVEY``
        error when the project is not a survey.
        """
        return self._request("GET", f"/projects/{id}/survey-results")

    def get_project_throughput(self, id: str) -> JsonDict:
        """GET /projects/{id}/throughput

        Pre-flight estimate of carrier limits for the project:
        ``t_mobile.estimated_recipients`` (``will_pause`` is always False and
        ``estimated_send_days`` is always 1, kept for compatibility),
        ``att.estimated_minutes`` (the minutes AT&T needs for what the campaign
        already has waiting plus this project's AT&T recipients, accounting for
        the number of parts in the project's text; ``att.tpm`` is in message parts per minute), ``recipients`` and ``carrier_coverage``
        (0 to 1; low coverage means the estimates use the platform-wide carrier
        split). A political brand with an AT&T rate on file returns
        ``carrier_metered: True``, ``t_mobile: None`` and a populated ``att``. ``used_today`` / ``remaining_today`` are
        None (not 0) when usage is temporarily unavailable. Results are cached up to 60 seconds. A timed-out
        estimate raises an error with status 503 and code
        ``CARRIER_ESTIMATE_TIMEOUT``; retry later.
        """
        return self._request("GET", f"/projects/{id}/throughput")

    def test_project(
        self,
        id: str,
        test_contacts: Sequence[JsonDict],
        *,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /projects/{id}/test

        ``test_contacts`` is a list of ``{"phone": "+1..."}`` dicts (1 to 50). Each dict may
        also include ``merge_values``: a dict of str to str, keyed by merge-tag name. When a
        contact supplies ``merge_values``, no contact is sampled from the project's lists for
        that test send and every tag renders from the supplied values, using the normal
        fallback chain (inline fallback, then org default, then standard default, then empty)
        for any tag not present. Omitting ``merge_values`` keeps the old behavior of sampling
        a contact from the project's lists.
        """
        return self._request(
            "POST",
            f"/projects/{id}/test",
            body={"test_contacts": list(test_contacts)},
            idempotency_key=idempotency_key,
        )

    def schedule_project(
        self,
        id: str,
        scheduled_at: str,
        scheduled_timezone: str,
        *,
        daily_cap_bypass: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /projects/{id}/schedule

        ``scheduled_at`` is an ISO 8601 date-time with an explicit offset. It
        may be now or in the past - the project starts sending as soon as
        audience compilation finishes (no minimum lead time).

        ``scheduled_timezone`` must be one of the six supported US IANA zones:
        ``America/New_York``, ``America/Chicago``, ``America/Denver``,
        ``America/Los_Angeles``, ``America/Anchorage``, or ``Pacific/Honolulu``.
        Any other value is rejected with a 400.

        ``daily_cap_bypass`` skips the reduced rate past the brand's T-Mobile
        daily cap and sends T-Mobile recipients at full speed. It only applies to
        brands that have a T-Mobile daily limit on file (political brands have
        none today), whose T-Mobile recipients otherwise send at a reduced rate
        past the cap. A carrier rejection still pauses the project, and rejected
        messages are still billed. Defaults to the reduced rate. It holds only until the next schedule or resume call rewrites
        it, so send it on every such call; this call also resumes a paused
        project. The response echoes the persisted ``daily_cap_bypass``.

        Raises a 409 ``LIST_ANALYSIS_IN_PROGRESS`` while a contact list on the
        project is being analyzed; wait for ``analysis.status`` ``complete``.
        A 409 ``LIST_ARCHIVED`` names a list whose contacts were removed 12
        months after upload; choose another list or upload the file again.
        A 409 ``NO_SENDABLE_CONTACTS`` means the lists hold no contact that
        can receive a text.

        To resume a project paused with ``pause_reason`` ``brand_daily_cap``,
        schedule it for the next day during sending hours (the project's window:
        8 AM to 10 PM in the time zone of most recipients, or 8 AM Eastern to
        10 PM Pacific when no zone holds a majority) with a morning ``scheduled_at``, or call
        without one to try T-Mobile again at the reduced rate (it pauses again
        if T-Mobile is still rejecting; rejected messages are still billed).

        Returns ``409 SENDING_PAUSED`` if sending is paused for the
        organization or platform-wide; the error's
        ``body["details"]["scope"]`` is ``"organization"`` or ``"platform"``.
        """
        body: JsonDict = {
            "scheduled_at": scheduled_at,
            "scheduled_timezone": scheduled_timezone,
        }
        if daily_cap_bypass is not None:
            body["daily_cap_bypass"] = daily_cap_bypass
        return self._request(
            "POST",
            f"/projects/{id}/schedule",
            body=body,
            idempotency_key=idempotency_key,
        )

    def unschedule_project(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """POST /projects/{id}/unschedule"""
        return self._request("POST", f"/projects/{id}/unschedule", idempotency_key=idempotency_key)

    def pause_project(
        self,
        id: str,
        *,
        reason: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /projects/{id}/pause

        Stops an ``active``, ``sending``, or ``scheduled`` project. ``reason``
        (1-100 characters) is returned as ``pause_reason`` on
        ``get_project``; omitted means ``manual``. An already paused project
        returns 200 with its current ``pause_reason``. Resume with
        :meth:`schedule_project`.
        """
        body: Optional[JsonDict] = {"reason": reason} if reason is not None else None
        return self._request(
            "POST", f"/projects/{id}/pause", body=body, idempotency_key=idempotency_key
        )

    def start_project(
        self, id: str, *, audience: Optional[str] = None, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """POST /projects/{id}/start

        Starts or resumes a triggered project (test it first with
        :meth:`test_project`; stop it with :meth:`pause_project`). Raises a 409
        ``CONFLICT`` for a project that is not triggered. ``audience`` is
        required for a tag trigger's first start and refused (400) otherwise:
        ``"current_and_new"`` also texts everyone carrying the tag now,
        ``"new_only"`` only contacts tagged from now on.
        """
        body: Optional[JsonDict] = {"audience": audience} if audience is not None else None
        return self._request("POST", f"/projects/{id}/start", body=body, idempotency_key=idempotency_key)

    def end_project(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """POST /projects/{id}/end

        Completes a triggered project; final. Recipients still waiting are not
        sent. Raises a 409 ``CONFLICT`` if the project is not triggered or was
        never started.
        """
        return self._request("POST", f"/projects/{id}/end", idempotency_key=idempotency_key)

    def add_project_recipient(
        self,
        id: str,
        phone_number: str,
        *,
        fields: Optional[JsonDict] = None,
        occurrence_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /projects/{id}/recipients

        Adds one recipient to an active triggered project. ``phone_number`` is
        +1 E.164. ``fields`` (up to 50 keys, scalar values) are merge tags in
        the message and are stored on the recipient. ``occurrence_id`` (up to
        128 characters) is your id for the event, so a retry of the same event
        is a no-op.

        ``data`` is ``{"status": "queued", "send_at": ...}`` (202) or
        ``{"status": "already_entered", "reason": "duplicate" | "already_entered"}``
        (200): ``duplicate`` for a repeated ``occurrence_id``,
        ``already_entered`` for a person already sent this project (each gets
        it at most once). Raises a 409 ``CONTACT_OPTED_OUT``, a 409
        ``CONFLICT`` (not triggered, or not active, which includes paused), a
        422 ``VALIDATION_ERROR`` (``body["details"]`` has ``field`` and
        ``reason``), or a 404 ``PROJECT_NOT_FOUND``.
        """
        return self._request(
            "POST",
            f"/projects/{id}/recipients",
            body=_compact(
                {"phone_number": phone_number, "fields": fields, "occurrence_id": occurrence_id}
            ),
            idempotency_key=idempotency_key,
        )

    def create_project_hook(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """POST /projects/{id}/hook

        Mints the inbound hook URL for a triggered project (any tool that can
        POST, such as Zapier, Make, or n8n). ``data["hook_url"]`` carries the
        secret in its path; ``data["endpoint_url"]`` has none and takes
        ``data["secret"]`` in an ``X-Hook-Secret`` header. Both are shown only
        in this response; any previous URL or secret stops working at once.
        """
        return self._request("POST", f"/projects/{id}/hook", idempotency_key=idempotency_key)

    def copy_project(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """POST /projects/{id}/copy

        The copy drops contact lists, schedule, and stats, starts in draft
        status, and gets a versioned name (X becomes X_v2). Returns
        ``403 ONBOARDING_INCOMPLETE`` if the organization's 14-day setup
        grace window has passed and the business profile or funding step is
        still incomplete; see ``create_project``.
        """
        return self._request("POST", f"/projects/{id}/copy", idempotency_key=idempotency_key)

    # -- conversations ----------------------------------------------------------
    #
    # A conversation is one thread between one of the organization's sending
    # numbers and one contact, created by a project send. The API never
    # creates a conversation; it replies inside an existing one, from the
    # same number, on the same project. Lists are keyset paginated: the
    # payload is {"data": [...], "has_more": bool, "next_cursor": str | None}.
    # Page until next_cursor is None, and never parse a cursor.

    def list_conversations(
        self,
        *,
        project_id: Optional[str] = None,
        updated_since: Optional[str] = None,
        include_test: Optional[bool] = None,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> JsonDict:
        """GET /conversations

        Lists conversations that have at least one inbound message, across
        every organization the key can access, sorted by ``last_inbound_at``
        descending. ``updated_since`` is an ISO 8601 date-time filtering on
        ``last_inbound_at`` (defaults to now minus 7 days; more than 90 days
        back is a 400). ``include_test`` defaults to False. There is no
        status filter; filter the results client side.

        Recommended for recovering inbound messages missed when a
        ``message.replied`` webhook endpoint was down: poll no more than once
        a minute, advancing ``updated_since`` to the newest ``last_inbound_at``
        seen.
        """
        return self._request(
            "GET",
            "/conversations",
            query={
                "project_id": project_id,
                "updated_since": updated_since,
                "include_test": include_test,
                "limit": limit,
                "cursor": cursor,
            },
        )

    def get_conversation(self, id: str) -> JsonDict:
        """GET /conversations/{id}"""
        return self._request("GET", f"/conversations/{id}")

    def list_conversation_messages(
        self,
        id: str,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> JsonDict:
        """GET /conversations/{id}/messages

        Newest first. Reading never marks the thread read in the dashboard.
        """
        return self._request(
            "GET",
            f"/conversations/{id}/messages",
            query={"limit": limit, "cursor": cursor},
        )

    def reply_to_conversation(
        self,
        id: str,
        text: str = "",
        *,
        media_ids: Optional[Sequence[str]] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /conversations/{id}/messages

        Replies inside an existing conversation from the same sending number,
        on the same project. ``text`` is up to 10 SMS parts (1,530 GSM-7 or
        670 Unicode characters), or 1,500 characters with media, and
        optional when ``media_ids`` has an entry; at least one of non-blank
        ``text`` or one media id is required. ``media_ids`` takes at most one
        media library id and sends the reply as one flat-rate MMS (SMS billed
        per segment without it); an unusable id is a ``400 MEDIA_NOT_USABLE``
        and nothing is charged. The result's ``media_urls`` lists the CDN URLs
        of the attached media. Returns 202 Accepted; final delivery state arrives on the
        existing ``message.sent`` / ``message.delivered`` / ``message.failed``
        webhooks (no new webhook event). Quiet hours do not apply. On a
        ``503 SEND_ENQUEUE_FAILED`` nothing was sent or charged, so it is
        safe to retry the same call. Returns ``409 SENDING_PAUSED`` if
        sending is paused for the organization or platform-wide; the error's
        ``body["details"]["scope"]`` is ``"organization"`` or ``"platform"``.
        """
        body: JsonDict = {"text": text}
        if media_ids:
            body["media_ids"] = list(media_ids)
        return self._request(
            "POST",
            f"/conversations/{id}/messages",
            body=body,
            idempotency_key=idempotency_key,
        )

    # -- analytics and billing -------------------------------------------------------

    def get_message_stats(
        self,
        start_date: str,
        end_date: str,
        *,
        organization_id: Optional[str] = None,
        brand_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
    ) -> JsonDict:
        """GET /messages/stats"""
        return self._request(
            "GET",
            "/messages/stats",
            query={
                "startDate": start_date,
                "endDate": end_date,
                "organizationId": organization_id,
                "brandId": brand_id,
                "campaignId": campaign_id,
            },
        )

    def get_ledger_usage(
        self,
        start_date: str,
        end_date: str,
        *,
        organization_id: Optional[str] = None,
        brand_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
    ) -> JsonDict:
        """GET /ledger/usage"""
        return self._request(
            "GET",
            "/ledger/usage",
            query={
                "startDate": start_date,
                "endDate": end_date,
                "organizationId": organization_id,
                "brandId": brand_id,
                "campaignId": campaign_id,
            },
        )

    def get_ledger_usage_by_initiator(
        self,
        start_date: str,
        end_date: str,
        *,
        organization_id: Optional[str] = None,
    ) -> JsonDict:
        """GET /ledger/usage/by-initiator"""
        return self._request(
            "GET",
            "/ledger/usage/by-initiator",
            query={
                "startDate": start_date,
                "endDate": end_date,
                "organizationId": organization_id,
            },
        )

    # -- webhook endpoints -----------------------------------------------
    #
    # Read-only: endpoints and their signing secret are created and edited in the
    # dashboard. The list payload is {"data": [...], "has_more": bool, "next_cursor": str | None}.

    def list_webhook_endpoints(
        self,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
    ) -> JsonDict:
        """GET /webhook-endpoints."""
        return self._request(
            "GET",
            "/webhook-endpoints",
            query={"limit": limit, "cursor": cursor},
        )

    def get_webhook_endpoint(self, id: str) -> JsonDict:
        """GET /webhook-endpoints/{id}."""
        return self._request("GET", f"/webhook-endpoints/{id}")

    # -- email ------------------------------------------------------------
    #
    # Write methods need the email entitlement on the organization and return
    # 403 ENTITLEMENT_REQUIRED without it. Lists are keyset paginated: the payload is
    # {"data": [...], "has_more": bool, "next_cursor": str | None}. Page until next_cursor
    # is None, and never parse a cursor.

    def list_email_domains(
        self,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        search: Optional[str] = None,
    ) -> JsonDict:
        """GET /email/domains."""
        return self._request(
            "GET",
            "/email/domains",
            query={"limit": limit, "cursor": cursor, "search": search},
        )

    def get_email_domain(self, id: str) -> JsonDict:
        """GET /email/domains/{id}."""
        return self._request("GET", f"/email/domains/{id}")

    def list_email_senders(self) -> JsonDict:
        """GET /email/senders. Not paginated."""
        return self._request("GET", "/email/senders")

    def get_email_sender(self, id: str) -> JsonDict:
        """GET /email/senders/{id}."""
        return self._request("GET", f"/email/senders/{id}")

    def list_email_suppressions(
        self,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        scope: Optional[str] = None,
    ) -> JsonDict:
        """GET /email/suppressions."""
        return self._request(
            "GET",
            "/email/suppressions",
            query={"limit": limit, "cursor": cursor, "scope": scope},
        )

    def add_email_suppressions(
        self,
        scope: str,
        emails: list[str],
        *,
        reason: Optional[str] = None,
        sender_identity_id: Optional[str] = None,
        email_domain_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/suppressions.

        Up to 5000 addresses per call. Malformed addresses come back in `invalid`
        rather than failing the batch.

        Once GA, also returns ``403 ENTITLEMENT_REQUIRED`` if the
        organization is not entitled to email; the error's
        ``body["details"]["entitlement"]`` is ``"email"``.
        """
        return self._request(
            "POST",
            "/email/suppressions",
            body=_compact(
                {
                    "scope": scope,
                    "emails": emails,
                    "reason": reason,
                    "sender_identity_id": sender_identity_id,
                    "email_domain_id": email_domain_id,
                }
            ),
            idempotency_key=idempotency_key,
        )

    def remove_email_suppressions(
        self,
        scope: str,
        emails: list[str],
        *,
        sender_identity_id: Optional[str] = None,
        email_domain_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """DELETE /email/suppressions.

        Needs an API key with the `public:delete` permission (and `public:write`);
        other keys get a 403. Removing an address that was not suppressed is not an error.

        Once GA, also returns ``403 ENTITLEMENT_REQUIRED`` if the
        organization is not entitled to email; the error's
        ``body["details"]["entitlement"]`` is ``"email"``.
        """
        return self._request(
            "DELETE",
            "/email/suppressions",
            body=_compact(
                {
                    "scope": scope,
                    "emails": emails,
                    "sender_identity_id": sender_identity_id,
                    "email_domain_id": email_domain_id,
                }
            ),
            idempotency_key=idempotency_key,
        )

    def list_email_campaigns(
        self,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
    ) -> JsonDict:
        """GET /email/campaigns."""
        return self._request(
            "GET",
            "/email/campaigns",
            query={
                "limit": limit,
                "cursor": cursor,
                "status": status,
                "search": search,
            },
        )

    def get_email_campaign(self, id: str) -> JsonDict:
        """GET /email/campaigns/{id}.

        This read also returns "blocked": the machine-readable list of reasons the
        campaign will not schedule yet. Check it before scheduling.
        """
        return self._request("GET", f"/email/campaigns/{id}")

    def create_email_campaign(
        self,
        name: str,
        sender_identity_id: str,
        list_ids: Optional[list[str]] = None,
        *,
        subject: Optional[str] = None,
        preheader: Optional[str] = None,
        html: Optional[str] = None,
        template_id: Optional[str] = None,
        suppression_list_ids: Optional[list[str]] = None,
        source_code: Optional[str] = None,
        refcode: Optional[str] = None,
        append_utm: Optional[bool] = None,
        is_repermission: Optional[bool] = None,
        tracking_domain_id: Optional[str] = None,
        require_approval: Optional[bool] = None,
        sequence: Optional[JsonDict] = None,
        trigger: Optional[JsonDict] = None,
        timezone: Optional[str] = None,
        sequence_send_time: Optional[str] = None,
        tag_ids: Optional[Sequence[str]] = None,
        require_tag_ids: Optional[Sequence[str]] = None,
        suppression_tag_ids: Optional[Sequence[str]] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/campaigns.

        ``trigger`` makes this a triggered campaign: no list, recipients arrive
        when the trigger fires (``{"source": "api" | "donation" | "event" |
        "tag", ...}``, the same shape as on :meth:`create_project`), and each
        address is sent it at most once. A campaign without ``trigger`` needs
        ``list_ids`` or a non-empty ``tag_ids``; a trigger cannot be combined
        with ``list_ids`` or tags (400); a ``sequence`` is accepted. Start it with
        :meth:`schedule_email_campaign` and no ``scheduled_at``; stop it with
        :meth:`end_email_campaign`. ``timezone`` (one of the six schedule
        zones, default America/New_York) and ``sequence_send_time``
        (``"HH:MM"``, triggered campaigns only) set when a ``"next_day"``
        trigger start sends.

        ``sequence`` gives this campaign follow-ups (it still reads
        ``type`` ``"broadcast"``): ``{"stop_on_reply": True, "stop_on_click":
        False, "thread_replies": False, "steps": [{"template_id": ...,
        "delay_days": 3, "send_time": "08:30"}, {"template_id": ...,
        "delay_hours": 48}, ...]}``; ``thread_replies``
        sends each follow-up as a reply in the first email's thread. Each
        follow-up waits either ``delay_days`` (0 to 365, with ``send_time``
        ``"HH:MM"``) after the previous email at that time in the campaign's
        time zone, or ``delay_hours`` (1 to 72) real hours after it, never
        both (a 400 at ``sequence.steps[i].delay_days`` or ``.send_time``).
        On a broadcast an hour step still respects the campaign's send window:
        if it would land outside, it goes when the window next opens. The
        follow-ups go to the people the first
        email reached, skipping anyone who left (a reply with
        ``stop_on_reply``, a tracked-link click with ``stop_on_click``; at
        least one must be true), unsubscribed, bounced or complained.
        Scheduling the first email schedules them all. Beside ``trigger``
        each person is on their own clock: ``delay_days`` must be 1 to 365
        (0 is a 400) and counts from the calendar day that person's previous
        email was sent, and ``delay_hours`` counts from the moment it was.
        ``get_email_campaign`` returns ``sequence["steps"]`` with each step's
        ``delay_days``, ``delay_hours`` and ``send_time``; an hour step has
        ``delay_days`` and ``send_time`` null.

        Once GA, also returns ``403 ONBOARDING_INCOMPLETE`` if the
        organization's 14-day setup grace window has passed and the business
        profile or funding step is still incomplete (see ``create_project``),
        or ``403 ENTITLEMENT_REQUIRED`` if the organization is not entitled
        to email; the error's ``body["details"]["entitlement"]`` is
        ``"email"``.

        ``tracking_domain_id`` brands this campaign's tracked links, open pixel
        and unsubscribe page with your own ``links.`` host. Leave it unset to
        let the platform pick the obvious default.

        A campaign sends to every subscribed, unsuppressed contact on its lists,
        plus every address carrying ANY ``tag_ids`` tag that is subscribed on a
        list the sending domain can use. ``require_tag_ids`` keeps only
        recipients carrying ALL of its tags; ``suppression_tag_ids`` leaves out
        recipients carrying any of its tags.
        """
        return self._request(
            "POST",
            "/email/campaigns",
            body=_compact(
                {
                    "name": name,
                    "sender_identity_id": sender_identity_id,
                    "list_ids": list_ids,
                    "subject": subject,
                    "preheader": preheader,
                    "html": html,
                    "template_id": template_id,
                    "suppression_list_ids": suppression_list_ids,
                    "source_code": source_code,
                    "refcode": refcode,
                    "append_utm": append_utm,
                    "is_repermission": is_repermission,
                    "tracking_domain_id": tracking_domain_id,
                    "require_approval": require_approval,
                    "sequence": sequence,
                    "trigger": trigger,
                    "timezone": timezone,
                    "sequence_send_time": sequence_send_time,
                    "tag_ids": _list(tag_ids),
                    "require_tag_ids": _list(require_tag_ids),
                    "suppression_tag_ids": _list(suppression_tag_ids),
                }
            ),
            idempotency_key=idempotency_key,
        )

    def schedule_email_campaign(
        self,
        id: str,
        *,
        scheduled_at: Optional[str] = None,
        audience: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/campaigns/{id}/schedule.

        Omit scheduled_at to send now. A past date returns 400 VALIDATION_ERROR. If this
        refuses, read "blocked" on the campaign to see which gate stopped it.
        ``audience`` (``"current_and_new"`` or ``"new_only"``) is required for
        a tag-triggered campaign's first start and refused otherwise.

        Once GA, also returns ``403 ENTITLEMENT_REQUIRED`` if the
        organization is not entitled to email (the error's
        ``body["details"]["entitlement"]`` is ``"email"``), or
        ``409 SENDING_PAUSED`` if sending is paused for the organization or
        platform-wide (the error's ``body["details"]["scope"]`` is
        ``"organization"`` or ``"platform"``).
        """
        return self._request(
            "POST",
            f"/email/campaigns/{id}/schedule",
            body=_compact({"scheduled_at": scheduled_at, "audience": audience}),
            idempotency_key=idempotency_key,
        )

    def unschedule_email_campaign(
        self, id: str, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """POST /email/campaigns/{id}/unschedule.

        Once GA, also returns ``403 ENTITLEMENT_REQUIRED`` if the
        organization is not entitled to email; the error's
        ``body["details"]["entitlement"]`` is ``"email"``.
        """
        return self._request(
            "POST",
            f"/email/campaigns/{id}/unschedule",
            idempotency_key=idempotency_key,
        )

    def pause_email_campaign(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """POST /email/campaigns/{id}/pause.

        Pauses a ``scheduled``, ``compiling`` or ``sending`` campaign with
        ``pause_reason`` ``"api"`` and ``resume_at`` null; the platform never
        resumes an ``api`` pause by itself. Messages already handed off still
        deliver. An already paused campaign returns 200 with its own
        ``pause_reason`` kept and any planned resume cancelled. Any other
        status raises a 409 ``CONFLICT``. Works even while sending is
        suspended. Takes no body; the reason is always ``api``.
        """
        return self._request(
            "POST", f"/email/campaigns/{id}/pause", idempotency_key=idempotency_key
        )

    def resume_email_campaign(
        self,
        id: str,
        resume_at: Optional[str] = None,
        *,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/campaigns/{id}/resume.

        Clears any pause reason and sends now, or, with ``resume_at`` (ISO 8601)
        more than a minute ahead, keeps the campaign paused and resumes it at
        that time (the campaign's ``resume_at`` shows the plan; a later pause
        cancels it). If the cause still holds the platform pauses it again.
        A ``resume_at`` more than a minute in the past is a 400
        ``VALIDATION_ERROR``. Raises ``409 SENDING_PAUSED`` if sending is
        suspended, ``409 EMAIL_CAMPAIGN_TEST_REQUIRED`` if content changed
        during the pause and was not tested since, and a 409 ``CONFLICT`` for
        ``draft``, ``awaiting_test``, ``awaiting_approval``, ``ready`` or
        ``completed``. An already running campaign returns 200 unchanged.
        """
        return self._request(
            "POST",
            f"/email/campaigns/{id}/resume",
            body=_compact({"resume_at": resume_at}),
            idempotency_key=idempotency_key,
        )

    def end_email_campaign(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """POST /email/campaigns/{id}/end.

        Completes a triggered campaign; final. Raises a 409 ``CONFLICT`` unless
        it is a triggered campaign that is sending or paused.
        """
        return self._request("POST", f"/email/campaigns/{id}/end", idempotency_key=idempotency_key)

    def add_email_campaign_recipient(
        self,
        id: str,
        email: str,
        *,
        fields: Optional[JsonDict] = None,
        occurrence_id: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/campaigns/{id}/recipients.

        Adds one recipient to a triggered campaign; same answers as
        :meth:`add_project_recipient` (422 reasons name why the address cannot
        be sent to).
        """
        return self._request(
            "POST",
            f"/email/campaigns/{id}/recipients",
            body=_compact({"email": email, "fields": fields, "occurrence_id": occurrence_id}),
            idempotency_key=idempotency_key,
        )

    def create_email_campaign_hook(
        self, id: str, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """POST /email/campaigns/{id}/hook.

        Mints the inbound hook URL; see :meth:`create_project_hook`.
        """
        return self._request("POST", f"/email/campaigns/{id}/hook", idempotency_key=idempotency_key)

    def get_email_campaign_stats(self, id: str) -> JsonDict:
        """GET /email/campaigns/{id}/stats.

        Cached for 60 seconds. Test and seed sends are excluded from every figure.
        """
        return self._request("GET", f"/email/campaigns/{id}/stats")

    def list_email_templates(
        self,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        search: Optional[str] = None,
    ) -> JsonDict:
        """GET /email/templates."""
        return self._request(
            "GET",
            "/email/templates",
            query={"limit": limit, "cursor": cursor, "search": search},
        )

    def get_email_template(self, id: str) -> JsonDict:
        """GET /email/templates/{id}."""
        return self._request("GET", f"/email/templates/{id}")

    def create_email_template(
        self,
        name: str,
        content: JsonDict,
        *,
        description: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/templates.

        content is {"subject": str, "html": str, "preheader": str | None,
        "text": str | None}. This endpoint only accepts HTML content; a saved
        template reports editor "html" (a template built in the dashboard's
        document editor reports "document" and is readable here as rendered
        HTML only).

        The response carries "lint" alongside the template. The save succeeds
        either way, but a campaign will not schedule while lint["errors"] is
        non-empty, so read it here rather than at send time.

        Once GA, also returns ``403 ENTITLEMENT_REQUIRED`` if the
        organization is not entitled to email; the error's
        ``body["details"]["entitlement"]`` is ``"email"``.
        """
        return self._request(
            "POST",
            "/email/templates",
            body=_compact(
                {"name": name, "content": content, "description": description}
            ),
            idempotency_key=idempotency_key,
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[dict[str, Optional[Union[str, int]]]] = None,
        body: Optional[JsonDict] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        return self._send(
            method, path, query=query, body=body, idempotency_key=idempotency_key
        ).json()

    def _send(
        self,
        method: str,
        path: str,
        *,
        query: Optional[dict[str, Optional[Union[str, int]]]] = None,
        body: Optional[JsonDict] = None,
        idempotency_key: Optional[str] = None,
        accept: Optional[str] = None,
    ) -> httpx.Response:
        """Send with retries; return the successful response or raise PoliticalCommsError."""
        params = {k: v for k, v in (query or {}).items() if v is not None}
        headers: dict[str, str] = {"X-API-Key": self._api_key}
        if accept is not None:
            headers["Accept"] = accept
        content: Optional[bytes] = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            content = json.dumps(body).encode("utf-8")
        if method in ("POST", "PATCH"):
            # Generated once so retries replay the same key and the API can
            # deduplicate the write.
            headers["Idempotency-Key"] = idempotency_key or str(uuid.uuid4())
        elif method == "DELETE" and idempotency_key is not None:
            # DELETEs accept an optional Idempotency-Key but never auto-generate one.
            headers["Idempotency-Key"] = idempotency_key

        attempt = 0
        while True:
            try:
                response = self._http.request(method, path, params=params, headers=headers, content=content)
            except httpx.HTTPError as cause:
                raise PoliticalCommsError(
                    f"Network request failed: {cause}", "NETWORK_ERROR", 0
                ) from cause

            self._capture_rate_limit(response)

            if response.is_success:
                return response

            try:
                parsed: Any = response.json()
            except ValueError:
                parsed = None

            if attempt < self._max_retries:
                if response.status_code == 429:
                    time.sleep(self._rate_limit_delay(response, attempt))
                    attempt += 1
                    continue
                if response.status_code in RETRYABLE_STATUS:
                    time.sleep(_backoff_delay(attempt))
                    attempt += 1
                    continue

            message = None
            code = None
            if isinstance(parsed, dict):
                if isinstance(parsed.get("error"), str) and parsed["error"]:
                    message = parsed["error"]
                if isinstance(parsed.get("code"), str) and parsed["code"]:
                    code = parsed["code"]
            raise PoliticalCommsError(
                message or f"Request failed with status {response.status_code}",
                code or f"HTTP_{response.status_code}",
                response.status_code,
                parsed if parsed is not None else response.text,
            )

    def _capture_rate_limit(self, response: httpx.Response) -> None:
        limit = response.headers.get("X-RateLimit-Limit")
        if limit is None:
            return
        try:
            self.last_rate_limit = RateLimitState(
                limit=int(limit),
                remaining=int(response.headers.get("X-RateLimit-Remaining", "0")),
                reset=int(response.headers.get("X-RateLimit-Reset", "0")),
            )
        except ValueError:
            pass

    def _rate_limit_delay(self, response: httpx.Response, attempt: int) -> float:
        """For 429s: Retry-After (relative seconds, immune to clock skew) wins,
        then the X-RateLimit-Reset timestamp, then exponential backoff."""
        retry_after = response.headers.get("Retry-After")
        if retry_after is not None:
            try:
                seconds = float(retry_after)
                if seconds > 0:
                    return seconds
            except ValueError:
                pass
        reset = response.headers.get("X-RateLimit-Reset")
        if reset is not None:
            try:
                wait = int(reset) - time.time()
                if wait > 0:
                    return wait
                return BACKOFF_BASE_SECONDS
            except ValueError:
                pass
        return _backoff_delay(attempt)

def _refuse(args: JsonDict, why: str) -> None:
    """The API refuses each of these with a 400 (strict body); naming them here says which to drop."""
    sent = [key for key, value in args.items() if value is not None]
    if sent:
        raise ValueError(f"{why}: remove {', '.join(sent)}")


def _compact(mapping: JsonDict) -> JsonDict:
    return {k: v for k, v in mapping.items() if v is not None}


def _list(values: Optional[Sequence[str]]) -> Optional[list[str]]:
    """A list for the JSON body; ``None`` stays omitted, while ``[]`` is sent so it can clear a field."""
    return None if values is None else list(values)


def _tag_contacts(identifiers: Optional[Sequence[str]], contact_list_id: Optional[str]) -> JsonDict:
    # The API takes exactly one source; refusing a mix here names the arguments.
    if (identifiers is None) == (contact_list_id is None):
        raise ValueError("Pass exactly one of identifiers and contact_list_id")
    if contact_list_id is not None:
        return {"contact_list_id": contact_list_id}
    return {"identifiers": list(identifiers or [])}


def _tag_by_name(
    name: str,
    organization_id: Optional[str],
    identifiers: Optional[Sequence[str]],
    contact_list_id: Optional[str],
) -> JsonDict:
    return _compact({"name": name, "organization_id": organization_id, **_tag_contacts(identifiers, contact_list_id)})
