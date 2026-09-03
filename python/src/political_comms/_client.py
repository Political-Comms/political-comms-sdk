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
        archived: Optional[bool] = None,
    ) -> JsonDict:
        """GET /projects

        ``type`` filters to "broadcast" or "survey" projects.
        ``archived=True`` returns only archived projects, ``archived=False``
        excludes them, and ``None`` (default) returns everything except
        deleted projects.
        """
        return self._request(
            "GET",
            "/projects",
            query={
                "organization_id": organization_id,
                "brand_id": brand_id,
                "campaign_id": campaign_id,
                "type": type,
                "archived": None if archived is None else ("true" if archived else "false"),
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
        status, and gets a versioned name (X becomes X_v2).
        """
        return self._request("POST", f"/projects/{id}/copy", idempotency_key=idempotency_key)

    def archive_project(self, id: str, *, idempotency_key: Optional[str] = None) -> JsonDict:
        """POST /projects/{id}/archive

        Only projects in completed status can be archived; otherwise the API
        returns 409 INVALID_STATE_TRANSITION.
        """
        return self._request("POST", f"/projects/{id}/archive", idempotency_key=idempotency_key)

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

    def create_email_domain(
        self, domain: str, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """POST /email/domains. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Publish every record in the returned dns_records, then poll get_email_domain
        until status is "active". DNS is manual: we never write records in your zone.
        """
        return self._request(
            "POST",
            "/email/domains",
            body={"domain": domain},
            idempotency_key=idempotency_key,
        )

    def delete_email_domain(
        self, id: str, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """DELETE /email/domains/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Returns 409 CONFLICT while live sender identities still reference the domain.
        """
        return self._request(
            "DELETE", f"/email/domains/{id}", idempotency_key=idempotency_key
        )

    def list_email_senders(self) -> JsonDict:
        """GET /email/senders. Not paginated. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request("GET", "/email/senders")

    def get_email_sender(self, id: str) -> JsonDict:
        """GET /email/senders/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request("GET", f"/email/senders/{id}")

    def create_email_sender(
        self,
        email_domain_id: str,
        from_local_part: str,
        from_name: str,
        *,
        reply_to: Optional[str] = None,
        physical_address: Optional[str] = None,
        disclaimer: Optional[str] = None,
        disclaimer_required: Optional[bool] = None,
        authorized_by_candidate: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/senders. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request(
            "POST",
            "/email/senders",
            body=_compact(
                {
                    "email_domain_id": email_domain_id,
                    "from_local_part": from_local_part,
                    "from_name": from_name,
                    "reply_to": reply_to,
                    "physical_address": physical_address,
                    "disclaimer": disclaimer,
                    "disclaimer_required": disclaimer_required,
                    "authorized_by_candidate": authorized_by_candidate,
                }
            ),
            idempotency_key=idempotency_key,
        )

    def update_email_sender(
        self, id: str, patch: JsonDict, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """PATCH /email/senders/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Supply at least one field. Patching an active identity out of compliance
        (removing a required physical address or disclaimer) pauses it.
        """
        return self._request(
            "PATCH", f"/email/senders/{id}", body=patch, idempotency_key=idempotency_key
        )

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
        sender_identity_id: Optional[str] = None,
        acquired: Optional[str] = None,
        sunset_enabled: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/lists. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        consent_attestation is {"source": str, "note": str | None}: the record of how
        the people on this list agreed to hear from you. Set `acquired` when the list
        came from anywhere other than your own sign-up flow; acquired lists must be
        validated before their first send.
        """
        return self._request(
            "POST",
            "/email/lists",
            body=_compact(
                {
                    "name": name,
                    "consent_attestation": consent_attestation,
                    "description": description,
                    "sender_identity_id": sender_identity_id,
                    "acquired": acquired,
                    "sunset_enabled": sunset_enabled,
                }
            ),
            idempotency_key=idempotency_key,
        )

    def update_email_list(
        self, id: str, patch: JsonDict, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """PATCH /email/lists/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request(
            "PATCH", f"/email/lists/{id}", body=patch, idempotency_key=idempotency_key
        )

    def delete_email_list(
        self, id: str, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """DELETE /email/lists/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request(
            "DELETE", f"/email/lists/{id}", idempotency_key=idempotency_key
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

    def remove_email_list_contacts(
        self, id: str, emails: list[str], *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """DELETE /email/lists/{id}/contacts. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Unsubscribes the addresses; it does not delete the rows. They carry the bounce
        and complaint history that stops a later re-import from resurrecting a
        suppressed address.
        """
        return self._request(
            "DELETE",
            f"/email/lists/{id}/contacts",
            body={"emails": emails},
            idempotency_key=idempotency_key,
        )

    def validate_email_list(
        self, id: str, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """POST /email/lists/{id}/validate. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Queues a paid validation run (billed per address). Returns 409
        EMAIL_LIST_NOT_READY if the list is still importing, or 409
        EMAIL_VALIDATION_IN_PROGRESS if a run is already active.
        """
        return self._request(
            "POST", f"/email/lists/{id}/validate", idempotency_key=idempotency_key
        )

    def get_email_list_validation(self, id: str) -> JsonDict:
        """GET /email/lists/{id}/validation. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Returns 404 EMAIL_VALIDATION_JOB_NOT_FOUND when the list has never been
        validated, which is distinct from a 404 for a list id that does not exist.
        """
        return self._request("GET", f"/email/lists/{id}/validation")

    def export_email_list(
        self,
        id: str,
        *,
        state: str = "all",
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/lists/{id}/export. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Queues a CSV of the list's addresses and their validation verdicts: the
        uploaded file's own columns followed by every verdict field. Answers 202
        with a ``file_id``; poll :meth:`get_email_list_export_download`, which
        answers 409 EXPORT_NOT_READY until the worker has finished the file.

        ``state`` narrows the export to one verdict class: "all", "deliverable",
        "undeliverable", "risky", or "unknown". Verdict columns are blank when an
        address has no cached verdict (never validated, or the 90-day cache
        expired), which is not the same as false.
        """
        return self._request(
            "POST",
            f"/email/lists/{id}/export",
            body={"state": state},
            idempotency_key=idempotency_key,
        )

    def get_email_list_export_download(self, id: str, file_id: str) -> JsonDict:
        """GET /email/lists/{id}/export/{file_id}/download.

        Early access: 403 EMAIL_EARLY_ACCESS until GA. Returns 409
        EXPORT_NOT_READY while the file is still building, which is the polling
        signal rather than an error. On success ``download_url`` is a tokenized
        path valid for 7 days; join it to the API host.
        """
        return self._request("GET", f"/email/lists/{id}/export/{file_id}/download")

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
        suppression_list_id: Optional[str] = None,
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
                    "suppression_list_id": suppression_list_id,
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
        suppression_list_id: Optional[str] = None,
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
                    "suppression_list_id": suppression_list_id,
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
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/campaigns. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        ``tracking_domain_id`` brands this campaign's tracked links, open pixel
        and unsubscribe page with your own ``links.`` host. Leave it unset to
        let the platform pick the obvious default. To force the platform link
        host on an existing draft, pass ``{"tracking_domain_id": None}`` to
        :meth:`update_email_campaign`: an omitted argument here means "default",
        not "null".
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
                }
            ),
            idempotency_key=idempotency_key,
        )

    def update_email_campaign(
        self, id: str, patch: JsonDict, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """PATCH /email/campaigns/{id}. Drafts only. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request(
            "PATCH",
            f"/email/campaigns/{id}",
            body=patch,
            idempotency_key=idempotency_key,
        )

    def test_email_campaign(
        self, id: str, to: list[str], *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """POST /email/campaigns/{id}/test. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Sends a real message to up to 10 addresses. Test sends are billed, but are
        excluded from campaign stats and never fire webhooks.
        """
        return self._request(
            "POST",
            f"/email/campaigns/{id}/test",
            body={"to": to},
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

    def pause_email_campaign(
        self, id: str, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """POST /email/campaigns/{id}/pause. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request(
            "POST", f"/email/campaigns/{id}/pause", idempotency_key=idempotency_key
        )

    def resume_email_campaign(
        self, id: str, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """POST /email/campaigns/{id}/resume. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        A campaign a deliverability breaker auto-paused twice returns 409
        EMAIL_CAMPAIGN_RESUME_REQUIRES_SUPPORT. There is no override on this surface:
        escalate to a human rather than retrying.
        """
        return self._request(
            "POST", f"/email/campaigns/{id}/resume", idempotency_key=idempotency_key
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
        "text": str | None}. The API never accepts or returns the visual designer
        document, so a saved template reports editor "html".

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

    def update_email_template(
        self, id: str, patch: JsonDict, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """PATCH /email/templates/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Supply at least one of name, description, or content; content, when sent,
        replaces the whole object. Returns "lint" like create.
        """
        return self._request(
            "PATCH", f"/email/templates/{id}", body=patch, idempotency_key=idempotency_key
        )

    def delete_email_template(
        self, id: str, *, idempotency_key: Optional[str] = None
    ) -> JsonDict:
        """DELETE /email/templates/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request(
            "DELETE", f"/email/templates/{id}", idempotency_key=idempotency_key
        )

    def request_email_template_draft(
        self,
        prompt: str,
        *,
        image_media_ids: Optional[list[str]] = None,
        brand_colors: Optional[JsonDict] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/templates/drafts. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Drafting runs on a queue: this returns 202 with the draft metadata and
        unit_price, and no html at all. Poll get_email_template_draft for that, or
        let wait_for_email_template_draft do it. Usually under two minutes.

        One email_ai_draft charge ($3.00 by default, per-org pricing) is recorded
        only when the draft reaches "ready"; a failed draft is never billed. A
        wallet that cannot cover the draft now is a 402 INSUFFICIENT_BALANCE and no
        draft row is created.

        Any of the up to 6 image_media_ids must be media imported with usage
        "email_asset" and owned by this organization; anything else is a 400.
        """
        return self._request(
            "POST",
            "/email/templates/drafts",
            body=_compact(
                {
                    "prompt": prompt,
                    "image_media_ids": image_media_ids,
                    "brand_colors": brand_colors,
                }
            ),
            idempotency_key=idempotency_key,
        )

    def get_email_template_draft(self, id: str) -> JsonDict:
        """GET /email/templates/drafts/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Unlike the create response, this one carries "html", null until ready.
        """
        return self._request("GET", f"/email/templates/drafts/{id}")

    def wait_for_email_template_draft(
        self,
        id: str,
        *,
        interval_seconds: float = 2.0,
        timeout_seconds: float = 300.0,
    ) -> JsonDict:
        """Poll get_email_template_draft until the draft is "ready" or "failed".

        Generation runs on a queue and can outlast a load balancer's idle timeout,
        which is why the API is poll-based rather than a long request; this saves
        every caller writing the same loop.

        A failed draft is returned, not raised: read error_code to tell an unusable
        prompt (EMAIL_DRAFT_INVALID) from a model failure (EMAIL_DRAFT_MODEL_ERROR)
        or a wallet that emptied mid-generation (INSUFFICIENT_BALANCE). Only the
        timeout raises PoliticalCommsError.
        """
        deadline = time.monotonic() + timeout_seconds
        while True:
            draft = self.get_email_template_draft(id)["data"]
            if draft.get("status") in ("ready", "failed"):
                return draft
            if time.monotonic() + interval_seconds >= deadline:
                raise PoliticalCommsError(
                    f"Email template draft {id} was still {draft.get('status')} after "
                    f"{timeout_seconds}s.",
                    "EMAIL_DRAFT_TIMEOUT",
                    0,
                    draft,
                )
            time.sleep(interval_seconds)

    def start_email_list_import(
        self,
        source_url: str,
        email_list_id: str,
        consent: JsonDict,
        *,
        mapping: Optional[dict[str, str]] = None,
        options: Optional[JsonDict] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /email/lists/import. Early access: 403 EMAIL_EARLY_ACCESS until GA.

        Fetches your CSV over https (50 MB cap, SSRF-guarded) and commits it in one
        call. consent is {"source": str, "note": str | None}, where source is one of
        donation_form, petition, signup_form, event, purchased, rented, or other.

        Omit mapping to let the server recognize a common ESP export; when neither
        your mapping nor the recognizer finds an email column the call is a 400
        VALIDATION_ERROR whose details["headers"] lists the headers that were read,
        so retry with a mapping instead of guessing. Returns 202: poll
        get_email_list_import for the outcome.
        """
        return self._request(
            "POST",
            "/email/lists/import",
            body=_compact(
                {
                    "source_url": source_url,
                    "email_list_id": email_list_id,
                    "consent": consent,
                    "mapping": mapping,
                    "options": options,
                }
            ),
            idempotency_key=idempotency_key,
        )

    def get_email_list_import(self, id: str) -> JsonDict:
        """GET /email/lists/imports/{id}. Early access: 403 EMAIL_EARLY_ACCESS until GA."""
        return self._request("GET", f"/email/lists/imports/{id}")

    # -- transport ----------------------------------------------------------------------

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
