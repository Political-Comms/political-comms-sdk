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
    ) -> JsonDict:
        """GET /contact-lists"""
        return self._request(
            "GET",
            "/contact-lists",
            query={"organization_id": organization_id, "brand_id": brand_id},
        )

    def get_contact_list(self, id: str) -> JsonDict:
        """GET /contact-lists/{id}"""
        return self._request("GET", f"/contact-lists/{id}")

    def import_contact_list(
        self,
        source_url: str,
        list_name: str,
        phone_column: str,
        *,
        organization_id: Optional[str] = None,
        brand_id: Optional[str] = None,
        merge_tags: Optional[JsonDict] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /contact-lists/import"""
        body = _compact(
            {
                "source_url": source_url,
                "organization_id": organization_id,
                "brand_id": brand_id,
                "list_name": list_name,
                "phone_column": phone_column,
                "merge_tags": merge_tags,
            }
        )
        return self._request("POST", "/contact-lists/import", body=body, idempotency_key=idempotency_key)

    def analyze_contact_list(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """POST /contact-lists/{id}/analyze"""
        return self._request("POST", f"/contact-lists/{id}/analyze", idempotency_key=idempotency_key)

    def delete_contact_list(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """DELETE /contact-lists/{id}

        A list referenced by any project cannot be deleted; the API returns
        409 CONTACT_LIST_IN_USE with the referencing projects in the details.
        """
        return self._request("DELETE", f"/contact-lists/{id}", idempotency_key=idempotency_key)

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
        protocol: str,
        message_text: str,
        phone_number_ids: Sequence[str],
        contact_list_ids: Optional[Sequence[str]] = None,
        *,
        channel: Optional[str] = None,
        brand_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
        toll_free_verification_id: Optional[str] = None,
        suppression_list_ids: Optional[Sequence[str]] = None,
        media_ids: Optional[Sequence[str]] = None,
        link_tracking_enabled: Optional[bool] = None,
        link_tracking_destination_url: Optional[str] = None,
        link_tracking_domain_id: Optional[str] = None,
        link_tracking_param_field: Optional[str] = None,
        link_tracking_fallback_url: Optional[str] = None,
        opt_out_footer_enabled: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /projects

        Returns ``403 ONBOARDING_INCOMPLETE`` if the organization's 14-day
        setup grace window has passed and the business profile or funding
        step is still incomplete; the error's ``body["details"]`` carries
        ``missingSteps`` (``"profile"`` and/or ``"funding"``) and
        ``onboardingUrl``.

        ``contact_list_ids`` is optional: omitting it creates the project in
        draft status, and it cannot be tested or scheduled until a list is
        attached via ``update_project``. An explicitly empty list is rejected.

        ``opt_out_footer_enabled`` controls the automatic "STOP=END" footer
        (default ``True``). ``link_tracking_destination_url`` may embed the
        selected ``link_tracking_param_field`` anywhere via a placeholder named
        after it (e.g. ``?utm_content=xyzd_{linkid}``); without a placeholder
        the parameter is appended as its own query pair. It may also be exactly
        ``https://{<link_tracking_param_field>}`` (e.g. ``https://{custom_url}``)
        to send each recipient to the URL in their own contact field; then
        ``link_tracking_fallback_url`` is required and catches recipients whose
        value is empty or not a valid URL. ``{phone}`` is not allowed as a whole
        URL.
        """
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
                "message_text": message_text,
                "media_ids": list(media_ids) if media_ids else None,
                "link_tracking_enabled": link_tracking_enabled,
                "link_tracking_destination_url": link_tracking_destination_url,
                "link_tracking_domain_id": link_tracking_domain_id,
                "link_tracking_param_field": link_tracking_param_field,
                "link_tracking_fallback_url": link_tracking_fallback_url,
                "opt_out_footer_enabled": opt_out_footer_enabled,
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
        name: Optional[str] = None,
        message_text: Optional[str] = None,
        protocol: Optional[str] = None,
        phone_number_ids: Optional[Sequence[str]] = None,
        contact_list_ids: Optional[Sequence[str]] = None,
        suppression_list_ids: Optional[Sequence[str]] = None,
        media_ids: Optional[Sequence[str]] = None,
        link_tracking_enabled: Optional[bool] = None,
        link_tracking_destination_url: Optional[str] = None,
        link_tracking_domain_id: Optional[str] = None,
        link_tracking_param_field: Optional[str] = None,
        link_tracking_fallback_url: Optional[str] = None,
        opt_out_footer_enabled: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """PATCH /projects/{id}

        ``opt_out_footer_enabled`` toggles the automatic "STOP=END" footer.
        ``link_tracking_fallback_url`` is required whenever
        ``link_tracking_destination_url`` is a whole-URL placeholder such as
        ``https://{custom_url}``; see ``create_project``.
        """
        body = _compact(
            {
                "name": name,
                "message_text": message_text,
                "protocol": protocol,
                "phone_number_ids": list(phone_number_ids) if phone_number_ids else None,
                "contact_list_ids": list(contact_list_ids) if contact_list_ids else None,
                "suppression_list_ids": list(suppression_list_ids) if suppression_list_ids else None,
                "media_ids": list(media_ids) if media_ids else None,
                "link_tracking_enabled": link_tracking_enabled,
                "link_tracking_destination_url": link_tracking_destination_url,
                "link_tracking_domain_id": link_tracking_domain_id,
                "link_tracking_param_field": link_tracking_param_field,
                "link_tracking_fallback_url": link_tracking_fallback_url,
                "opt_out_footer_enabled": opt_out_footer_enabled,
            }
        )
        return self._request("PATCH", f"/projects/{id}", body=body, idempotency_key=idempotency_key)

    def get_project_stats(self, id: str) -> JsonDict:
        """GET /projects/{id}/stats

        The response nests production counters under ``metrics`` and carries a
        ``test`` object with test-send activity (sent/delivered/failed/replies/
        clicks) tracked separately - ``metrics`` excludes test traffic. The
        test counters form a pipeline: ``sent`` holds only tests awaiting a
        delivery outcome and moves into ``delivered``/``failed`` on the DLR.
        """
        return self._request("GET", f"/projects/{id}/stats")

    def test_project(
        self,
        id: str,
        test_contacts: Sequence[JsonDict],
        *,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /projects/{id}/test

        ``test_contacts`` is a list of ``{"phone": "+1..."}`` dicts (1 to 50).
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

        ``daily_cap_bypass`` runs the whole project past the brand's T-Mobile
        daily cap instead of pausing at it. It only applies to brands T-Mobile
        meters (Aegis-vetted, non-political), which otherwise pause each
        Pacific day at their cap and must be started again to continue.
        Setting it accepts that messages to T-Mobile recipients over the limit
        may fail and are still billed: carrier is not reliably known before
        sending, so the platform cannot skip only those recipients. Defaults to
        pausing. The response echoes the persisted ``daily_cap_bypass``.
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
        text: str,
        *,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /conversations/{id}/messages

        Replies inside an existing conversation from the same sending number,
        on the same project. ``text`` is 1-1600 characters, SMS only (no
        media). Returns 202 Accepted; final delivery state arrives on the
        existing ``message.sent`` / ``message.delivered`` / ``message.failed``
        webhooks (no new webhook event). Quiet hours do not apply. On a
        ``503 SEND_ENQUEUE_FAILED`` nothing was sent or charged, so it is
        safe to retry the same call.
        """
        return self._request(
            "POST",
            f"/conversations/{id}/messages",
            body={"text": text},
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

    # -- email (early access) ------------------------------------------------------------
    #
    # Every method below returns 403 EMAIL_EARLY_ACCESS until the email product reaches
    # general availability. Lists are keyset paginated: the payload is
    # {"data": [...], "has_more": bool, "next_cursor": str | None}. Page until next_cursor
    # is None, and never parse a cursor.

    def list_email_domains(
        self,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        search: Optional[str] = None,
    ) -> JsonDict:
        """GET /email/domains. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request(
            "GET",
            "/email/domains",
            query={"limit": limit, "cursor": cursor, "search": search},
        )

    def get_email_domain(self, id: str) -> JsonDict:
        """GET /email/domains/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request("GET", f"/email/domains/{id}")

    def list_email_senders(self) -> JsonDict:
        """GET /email/senders. Not paginated. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request("GET", "/email/senders")

    def get_email_sender(self, id: str) -> JsonDict:
        """GET /email/senders/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request("GET", f"/email/senders/{id}")

    def list_email_lists(
        self,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        source_type: Optional[str] = None,
        search: Optional[str] = None,
    ) -> JsonDict:
        """GET /email/lists. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request(
            "GET",
            "/email/lists",
            query={
                "limit": limit,
                "cursor": cursor,
                "source_type": source_type,
                "search": search,
            },
        )

    def get_email_list(self, id: str) -> JsonDict:
        """GET /email/lists/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request("GET", f"/email/lists/{id}")

    def create_email_list(
        self,
        name: str,
        consent_attestation: JsonDict,
        *,
        description: Optional[str] = None,
        email_domain_id: Optional[str] = None,
        acquired: Optional[str] = None,
        sunset_enabled: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/lists. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        consent_attestation is {"source": str, "note": str | None}: the record of how
        the people on this list agreed to hear from you. Set `acquired` when the list
        came from anywhere other than your own sign-up flow; acquired lists must be
        validated before their first send. email_domain_id scopes the list to one
        sending domain; omit it for a list any campaign may use.
        """
        return self._request(
            "POST",
            "/email/lists",
            body=_compact(
                {
                    "name": name,
                    "consent_attestation": consent_attestation,
                    "description": description,
                    "email_domain_id": email_domain_id,
                    "acquired": acquired,
                    "sunset_enabled": sunset_enabled,
                }
            ),
            idempotency_key=idempotency_key,
        )

    def list_email_list_contacts(
        self,
        id: str,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        status: Optional[str] = None,
        search: Optional[str] = None,
    ) -> JsonDict:
        """GET /email/lists/{id}/contacts. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request(
            "GET",
            f"/email/lists/{id}/contacts",
            query={
                "limit": limit,
                "cursor": cursor,
                "status": status,
                "search": search,
            },
        )

    def add_email_list_contacts(
        self,
        id: str,
        contacts: list[JsonDict],
        *,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/lists/{id}/contacts. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Upserts up to 1000 contacts. Invalid rows do not fail the call: read `results`
        and resend only the rows that came back "rejected".
        """
        return self._request(
            "POST",
            f"/email/lists/{id}/contacts",
            body={"contacts": contacts},
            idempotency_key=idempotency_key,
        )

    def list_email_suppressions(
        self,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        scope: Optional[str] = None,
    ) -> JsonDict:
        """GET /email/suppressions. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
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
        """POST /email/suppressions. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Up to 5000 addresses per call. Malformed addresses come back in `invalid`
        rather than failing the batch.
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
        """DELETE /email/suppressions. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Removing an address that was not suppressed is not an error.
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
        """GET /email/campaigns. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
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
        """GET /email/campaigns/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        This read also returns "blocked": the machine-readable list of reasons the
        campaign will not schedule yet. Check it before scheduling.
        """
        return self._request("GET", f"/email/campaigns/{id}")

    def create_email_campaign(
        self,
        name: str,
        sender_identity_id: str,
        list_ids: list[str],
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
        recipient_policy: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/campaigns. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Once GA, also returns ``403 ONBOARDING_INCOMPLETE`` if the
        organization's 14-day setup grace window has passed and the business
        profile or funding step is still incomplete; see ``create_project``.

        ``tracking_domain_id`` brands this campaign's tracked links, open pixel
        and unsubscribe page with your own ``links.`` host. Leave it unset to
        let the platform pick the obvious default.

        ``recipient_policy`` decides which subscribed contacts on the campaign's
        lists actually receive it: "max_reach" (default) sends to every
        subscribed contact, and "max_deliverability" sends only to contacts
        whose current validation verdict is deliverable, skipping contacts that
        have never been validated. Writable on create and update, and readable
        on every campaign response.
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
                    "recipient_policy": recipient_policy,
                }
            ),
            idempotency_key=idempotency_key,
        )

    def schedule_email_campaign(
        self,
        id: str,
        *,
        scheduled_at: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/campaigns/{id}/schedule. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Omit scheduled_at to send now. A past date returns 400 VALIDATION_ERROR. If this
        refuses, read "blocked" on the campaign to see which gate stopped it.
        """
        return self._request(
            "POST",
            f"/email/campaigns/{id}/schedule",
            body=_compact({"scheduled_at": scheduled_at}),
            idempotency_key=idempotency_key,
        )

    def unschedule_email_campaign(
        self, id: str, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """POST /email/campaigns/{id}/unschedule. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request(
            "POST",
            f"/email/campaigns/{id}/unschedule",
            idempotency_key=idempotency_key,
        )

    def get_email_campaign_stats(self, id: str) -> JsonDict:
        """GET /email/campaigns/{id}/stats. Early access: 403 EMAIL_EARLY_ACCESS until GA.

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
        """GET /email/templates. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request(
            "GET",
            "/email/templates",
            query={"limit": limit, "cursor": cursor, "search": search},
        )

    def get_email_template(self, id: str) -> JsonDict:
        """GET /email/templates/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request("GET", f"/email/templates/{id}")

    def create_email_template(
        self,
        name: str,
        content: JsonDict,
        *,
        description: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/templates. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        content is {"subject": str, "html": str, "preheader": str | None,
        "text": str | None}. This endpoint only accepts HTML content; a saved
        template reports editor "html" (a template built in the dashboard's
        document editor reports "document" and is readable here as rendered
        HTML only).

        The response carries "lint" alongside the template. The save succeeds
        either way, but a campaign will not schedule while lint["errors"] is
        non-empty, so read it here rather than at send time.
        """
        return self._request(
            "POST",
            "/email/templates",
            body=_compact(
                {"name": name, "content": content, "description": description}
            ),
            idempotency_key=idempotency_key,
        )

    def start_email_list_import(
        self,
        source_url: str,
        consent: JsonDict,
        *,
        name: Optional[str] = None,
        email_domain_id: Optional[str] = None,
        acquired: Optional[bool] = None,
        mapping: Optional[dict[str, str]] = None,
        options: Optional[JsonDict] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/lists/import. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Fetches your CSV over https (50 MB cap, SSRF-guarded) and commits it as a NEW
        list in one call: the file is the list. name defaults to the file name, and
        email_domain_id scopes the new list to one sending domain. consent is
        {"source": str, "note": str | None}, where source is one of donation_form,
        petition, signup_form, event, purchased, rented, or other.

        Omit mapping to let the server recognize a common ESP export; when neither
        your mapping nor the recognizer finds an email column the call is a 400
        VALIDATION_ERROR whose details["headers"] lists the headers that were read,
        so retry with a mapping instead of guessing. Returns 202; the import's
        progress is shown on the list in the dashboard.
        """
        return self._request(
            "POST",
            "/email/lists/import",
            body=_compact(
                {
                    "source_url": source_url,
                    "name": name,
                    "email_domain_id": email_domain_id,
                    "acquired": acquired,
                    "consent": consent,
                    "mapping": mapping,
                    "options": options,
                }
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
        params = {k: v for k, v in (query or {}).items() if v is not None}
        headers: dict[str, str] = {"X-API-Key": self._api_key}
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
                return response.json()

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
        """For 429s, wait until the X-RateLimit-Reset timestamp; fall back to backoff."""
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

def _compact(mapping: JsonDict) -> JsonDict:
    return {k: v for k, v in mapping.items() if v is not None}
