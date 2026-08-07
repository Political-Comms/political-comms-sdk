from __future__ import annotations

import json
import os
import random
import time
import uuid
from dataclasses import dataclass
from typing import Any, Optional, Sequence

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
                "dashboard under Admin > API Keys."
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
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """POST /media"""
        body = _compact(
            {
                "source_url": source_url,
                "organization_id": organization_id,
                "brand_id": brand_id,
                "name": name,
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
        the parameter is appended as its own query pair.
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
        opt_out_footer_enabled: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
    ) -> JsonDict:
        """PATCH /projects/{id}

        ``opt_out_footer_enabled`` toggles the automatic "STOP=END" footer.
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
                "opt_out_footer_enabled": opt_out_footer_enabled,
            }
        )
        return self._request("PATCH", f"/projects/{id}", body=body, idempotency_key=idempotency_key)

    def get_project_stats(self, id: str) -> JsonDict:
        """GET /projects/{id}/stats

        The response nests production counters under ``metrics`` and carries a
        ``test`` object with test-send activity (sent/delivered/failed/replies/
        clicks) tracked separately - ``metrics`` excludes test traffic.
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
        """
        return self._request(
            "POST",
            f"/projects/{id}/schedule",
            body={"scheduled_at": scheduled_at, "scheduled_timezone": scheduled_timezone},
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

    # -- transport ----------------------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        query: Optional[dict[str, Optional[str]]] = None,
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
