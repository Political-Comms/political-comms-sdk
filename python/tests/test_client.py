import json
import re
import time
import uuid

import httpx
import pytest

from political_comms import PoliticalCommsClient, PoliticalCommsError, RateLimitState

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def ok_response(data=None, headers=None):
    return httpx.Response(
        200,
        json={"success": True, "data": data if data is not None else []},
        headers=headers or {},
    )


def error_response(status, code, headers=None):
    return httpx.Response(
        status,
        json={"success": False, "error": f"error: {code}", "code": code, "statusCode": status},
        headers=headers or {},
    )


def make_client(handler, **kwargs):
    return PoliticalCommsClient(
        api_key="pc_live_test", transport=httpx.MockTransport(handler), **kwargs
    )


class TestContactListDownload:
    def test_download_returns_csv_text(self):
        csv = "Phone Number,Original Row\n+15555550100,1\n"
        seen = {}

        def handler(request):
            seen["url"] = str(request.url)
            seen["accept"] = request.headers.get("Accept")
            seen["idem"] = request.headers.get("Idempotency-Key")
            return httpx.Response(200, text=csv, headers={"Content-Type": "text/csv"})

        client = make_client(handler)
        assert client.download_contact_list("cl_1", "original") == csv
        assert seen["url"].endswith("/contact-lists/cl_1/download?type=original")
        assert seen["accept"] == "text/csv"
        assert seen["idem"] is None

    def test_download_before_analysis_raises(self):
        client = make_client(lambda request: error_response(409, "ANALYSIS_NOT_COMPLETE"))
        with pytest.raises(PoliticalCommsError) as exc:
            client.download_contact_list("cl_1", "analyzed")
        assert exc.value.code == "ANALYSIS_NOT_COMPLETE"
        assert exc.value.status_code == 409


class TestContactListImport:
    def test_email_only_import_sends_consent_and_no_phone_column(self):
        seen = {}

        def handler(request):
            seen["url"] = str(request.url)
            seen["body"] = json.loads(request.content)
            seen["idem"] = request.headers.get("Idempotency-Key")
            return httpx.Response(
                202,
                json={
                    "success": True,
                    "data": {
                        "list_id": "cl_1",
                        "purpose": "audience",
                        "channels": ["email"],
                        "email_import": {"id": "imp_1", "status": "queued"},
                    },
                },
            )

        client = make_client(handler)
        data = client.import_contact_list(
            "https://example.com/donors.csv",
            "Donors",
            email_column="Email",
            consent={"source": "donation_form"},
            acquired=False,
        )["data"]
        assert seen["url"].endswith("/contact-lists/import")
        assert seen["body"] == {
            "source_url": "https://example.com/donors.csv",
            "list_name": "Donors",
            "email_column": "Email",
            "consent": {"source": "donation_form"},
            "acquired": False,
        }
        assert UUID_RE.match(seen["idem"])
        assert data["channels"] == ["email"]

    def test_do_not_contact_import_sends_purpose(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return httpx.Response(
                202, json={"success": True, "data": {"purpose": "do_not_contact", "channels": ["text"]}}
            )

        client = make_client(handler)
        data = client.import_contact_list(
            "https://example.com/dnc.csv", "DNC", "Phone", purpose="do_not_contact"
        )["data"]
        assert seen["body"]["purpose"] == "do_not_contact"
        assert seen["body"]["phone_column"] == "Phone"
        assert "list_id" not in data

    def test_list_contact_lists_forwards_channel(self):
        seen = {}

        def handler(request):
            seen["url"] = str(request.url)
            return ok_response([])

        make_client(handler).list_contact_lists(channel="all")
        assert seen["url"].endswith("/contact-lists?channel=all")


class TestConstructor:
    def test_missing_key_raises_clear_error(self, monkeypatch):
        monkeypatch.delenv("POLITICAL_COMMS_API_KEY", raising=False)
        with pytest.raises(ValueError, match="POLITICAL_COMMS_API_KEY"):
            PoliticalCommsClient()

    def test_env_var_fallback(self, monkeypatch):
        monkeypatch.setenv("POLITICAL_COMMS_API_KEY", "pc_live_from_env")
        seen = {}

        def handler(request):
            seen["key"] = request.headers.get("X-API-Key")
            return ok_response()

        client = PoliticalCommsClient(transport=httpx.MockTransport(handler))
        client.list_organizations()
        assert seen["key"] == "pc_live_from_env"


class TestAuthAndHeaders:
    def test_api_key_header(self):
        seen = {}

        def handler(request):
            seen["key"] = request.headers.get("X-API-Key")
            seen["url"] = str(request.url)
            return ok_response()

        with make_client(handler) as client:
            client.list_organizations()
        assert seen["key"] == "pc_live_test"
        assert seen["url"] == "https://api.politicalcomms.com/v1/organizations"

    def test_no_idempotency_key_on_get(self):
        seen = {}

        def handler(request):
            seen["idem"] = request.headers.get("Idempotency-Key")
            return ok_response()

        with make_client(handler) as client:
            client.list_brands(organization_id="org_1")
        assert seen["idem"] is None

    def test_query_serialization_uses_spec_names(self):
        seen = {}

        def handler(request):
            seen["params"] = dict(request.url.params)
            seen["path"] = request.url.path
            return ok_response({})

        with make_client(handler) as client:
            client.get_message_stats(
                "2026-06-01", "2026-06-30", organization_id="org_1", brand_id="brand_1"
            )
        assert seen["path"] == "/v1/messages/stats"
        assert seen["params"] == {
            "startDate": "2026-06-01",
            "endDate": "2026-06-30",
            "organizationId": "org_1",
            "brandId": "brand_1",
        }


class TestIdempotency:
    def test_auto_uuid_on_post(self):
        seen = {}

        def handler(request):
            seen["idem"] = request.headers.get("Idempotency-Key")
            seen["body"] = json.loads(request.content)
            return ok_response({})

        with make_client(handler) as client:
            client.create_project(
                "org_1",
                "Turnout wave 1",
                "sms",
                "Hello",
                phone_number_ids=["pn_1"],
                contact_list_ids=["cl_1"],
            )
        assert UUID_RE.match(seen["idem"])
        # uuid4 keys must be valid UUIDs
        uuid.UUID(seen["idem"])
        assert seen["body"] == {
            "organization_id": "org_1",
            "phone_number_ids": ["pn_1"],
            "name": "Turnout wave 1",
            "protocol": "sms",
            "contact_list_ids": ["cl_1"],
            "message_text": "Hello",
        }

    def test_caller_supplied_key_on_patch(self):
        seen = {}

        def handler(request):
            seen["idem"] = request.headers.get("Idempotency-Key")
            seen["method"] = request.method
            seen["path"] = request.url.path
            return ok_response({})

        with make_client(handler) as client:
            client.update_project("proj_1", name="Renamed", idempotency_key="my-key-1")
        assert seen == {"idem": "my-key-1", "method": "PATCH", "path": "/v1/projects/proj_1"}


class TestErrorMapping:
    def test_api_error_maps_to_exception(self):
        def handler(request):
            return httpx.Response(
                404,
                json={
                    "success": False,
                    "error": "Project not found",
                    "code": "NOT_FOUND",
                    "statusCode": 404,
                },
            )

        with make_client(handler) as client:
            with pytest.raises(PoliticalCommsError) as excinfo:
                client.get_project("missing")
        err = excinfo.value
        assert str(err) == "Project not found"
        assert err.code == "NOT_FOUND"
        assert err.status_code == 404
        assert err.body["code"] == "NOT_FOUND"

    @pytest.mark.parametrize("status", [400, 401, 403, 404])
    def test_4xx_never_retried(self, status, monkeypatch):
        calls = []
        monkeypatch.setattr(time, "sleep", lambda s: pytest.fail("should not sleep"))

        def handler(request):
            calls.append(1)
            return error_response(status, "NO_RETRY")

        with make_client(handler) as client:
            with pytest.raises(PoliticalCommsError) as excinfo:
                client.list_organizations()
        assert excinfo.value.status_code == status
        assert len(calls) == 1

    def test_non_json_error_body(self):
        def handler(request):
            return httpx.Response(502, text="Bad gateway")

        with make_client(handler, max_retries=0) as client:
            with pytest.raises(PoliticalCommsError) as excinfo:
                client.list_organizations()
        err = excinfo.value
        assert err.code == "HTTP_502"
        assert err.status_code == 502
        assert err.body == "Bad gateway"

    def test_network_error(self):
        def handler(request):
            raise httpx.ConnectError("connection refused")

        with make_client(handler) as client:
            with pytest.raises(PoliticalCommsError) as excinfo:
                client.list_organizations()
        err = excinfo.value
        assert err.code == "NETWORK_ERROR"
        assert err.status_code == 0


class TestRateLimiting:
    def test_429_waits_until_reset(self, monkeypatch):
        sleeps = []
        monkeypatch.setattr(time, "sleep", lambda s: sleeps.append(s))
        reset_at = int(time.time()) + 30
        responses = [
            error_response(
                429,
                "RATE_LIMIT_EXCEEDED",
                headers={
                    "X-RateLimit-Limit": "100",
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(reset_at),
                },
            ),
            ok_response(
                [],
                headers={
                    "X-RateLimit-Limit": "100",
                    "X-RateLimit-Remaining": "99",
                    "X-RateLimit-Reset": str(reset_at + 3600),
                },
            ),
        ]

        def handler(request):
            return responses.pop(0)

        with make_client(handler) as client:
            result = client.list_organizations()
        assert result["success"] is True
        assert len(sleeps) == 1
        assert 25 <= sleeps[0] <= 31
        assert client.last_rate_limit == RateLimitState(limit=100, remaining=99, reset=reset_at + 3600)

    def test_429_prefers_retry_after_over_reset(self, monkeypatch):
        sleeps = []
        monkeypatch.setattr(time, "sleep", lambda s: sleeps.append(s))
        reset_at = int(time.time()) + 30  # a skewed or stale Reset
        responses = [
            error_response(
                429,
                "RATE_LIMIT_EXCEEDED",
                headers={
                    "Retry-After": "3",
                    "X-RateLimit-Limit": "600",
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(reset_at),
                },
            ),
            ok_response([], headers={"X-RateLimit-Limit": "600", "X-RateLimit-Remaining": "599"}),
        ]

        def handler(request):
            return responses.pop(0)

        with make_client(handler) as client:
            result = client.list_organizations()
        assert result["success"] is True
        assert sleeps == [3.0]

    def test_last_rate_limit_updates_per_response(self):
        def handler(request):
            return ok_response(
                [],
                headers={
                    "X-RateLimit-Limit": "100",
                    "X-RateLimit-Remaining": "42",
                    "X-RateLimit-Reset": "1767225600",
                },
            )

        with make_client(handler) as client:
            assert client.last_rate_limit is None
            client.list_organizations()
            assert client.last_rate_limit == RateLimitState(limit=100, remaining=42, reset=1767225600)


class TestBackoff:
    def test_5xx_retries_then_succeeds(self, monkeypatch):
        sleeps = []
        monkeypatch.setattr(time, "sleep", lambda s: sleeps.append(s))
        responses = [
            error_response(500, "INTERNAL_ERROR"),
            error_response(502, "BAD_GATEWAY"),
            error_response(503, "UPSTREAM_UNAVAILABLE"),
            ok_response([{"id": "org_1"}]),
        ]

        def handler(request):
            return responses.pop(0)

        with make_client(handler) as client:
            result = client.list_organizations()
        assert result["data"] == [{"id": "org_1"}]
        assert len(sleeps) == 3
        # Exponential backoff with jitter: 50 to 100 percent of 1s, 2s, 4s.
        assert 0.5 <= sleeps[0] <= 1.0
        assert 1.0 <= sleeps[1] <= 2.0
        assert 2.0 <= sleeps[2] <= 4.0

    def test_gives_up_after_max_retries(self, monkeypatch):
        monkeypatch.setattr(time, "sleep", lambda s: None)
        calls = []

        def handler(request):
            calls.append(1)
            return error_response(500, "INTERNAL_ERROR")

        with make_client(handler, max_retries=2) as client:
            with pytest.raises(PoliticalCommsError) as excinfo:
                client.list_organizations()
        assert excinfo.value.status_code == 500
        assert len(calls) == 3

    def test_idempotency_key_replayed_across_retries(self, monkeypatch):
        monkeypatch.setattr(time, "sleep", lambda s: None)
        keys = []
        responses = [error_response(503, "UPSTREAM_UNAVAILABLE"), ok_response({})]

        def handler(request):
            keys.append(request.headers.get("Idempotency-Key"))
            return responses.pop(0)

        with make_client(handler) as client:
            client.test_project("proj_1", [{"phone": "+15555550100"}])
        assert len(keys) == 2
        assert keys[0] == keys[1]
        assert UUID_RE.match(keys[0])


class TestDeletes:
    def test_delete_contact_list(self):
        seen = {}

        def handler(request):
            seen["method"] = request.method
            seen["path"] = request.url.path
            seen["idem"] = request.headers.get("Idempotency-Key")
            return ok_response({"list_id": "cl_1", "name": "Voters", "deleted": True})

        with make_client(handler) as client:
            result = client.delete_contact_list("cl_1")
        assert seen["method"] == "DELETE"
        assert seen["path"] == "/v1/contact-lists/cl_1"
        # No auto-generated Idempotency-Key on DELETE.
        assert seen["idem"] is None
        assert result["data"] == {"list_id": "cl_1", "name": "Voters", "deleted": True}

    def test_delete_media_with_idempotency_key(self):
        seen = {}

        def handler(request):
            seen["method"] = request.method
            seen["path"] = request.url.path
            seen["idem"] = request.headers.get("Idempotency-Key")
            return ok_response({"media_id": "media_1", "name": "rally-photo.jpg", "deleted": True})

        with make_client(handler) as client:
            result = client.delete_media("media_1", idempotency_key="delete-key-1")
        assert seen == {"method": "DELETE", "path": "/v1/media/media_1", "idem": "delete-key-1"}
        assert result["data"]["deleted"] is True

    def test_delete_conflict_surfaces_in_use_error(self):
        def handler(request):
            return httpx.Response(
                409,
                json={
                    "success": False,
                    "error": "Contact list is in use",
                    "code": "CONTACT_LIST_IN_USE",
                    "statusCode": 409,
                    "details": {"projects": [{"id": "proj_1", "name": "GOTV", "status": "draft"}]},
                },
            )

        with make_client(handler) as client:
            with pytest.raises(PoliticalCommsError) as excinfo:
                client.delete_contact_list("cl_1")
        err = excinfo.value
        assert err.code == "CONTACT_LIST_IN_USE"
        assert err.status_code == 409
        assert err.body["details"]["projects"][0]["id"] == "proj_1"


class TestThroughput:
    def test_throughput_paths(self):
        seen = []

        def handler(request):
            seen.append((request.method, request.url.path))
            return ok_response({"carrier_metered": False, "t_mobile": None, "att": None})

        with make_client(handler) as client:
            campaign = client.get_campaign_throughput("camp_1")
            client.get_project_throughput("proj_1")
        assert seen == [
            ("GET", "/v1/campaigns/camp_1/throughput"),
            ("GET", "/v1/projects/proj_1/throughput"),
        ]
        assert campaign["data"]["carrier_metered"] is False


class TestProjectSurveyResults:
    def test_get_project_survey_results_gets_path_and_returns_data(self):
        seen = {}
        data = {
            "project_id": "proj_1",
            "name": "Voter survey",
            "status": "completed",
            "total_recipients": 1000,
            "completion_rate": 62.5,
            "dropoff_rate": 37.5,
            "results": [
                {
                    "question_id": "q_1",
                    "sequence": 1,
                    "question_text": "Will you vote?",
                    "question_type": "multiple_choice",
                    "total_responses": 400,
                    "option_results": [{"value": 1, "label": "Yes", "count": 300, "percentage": 75}],
                    "other_count": 100,
                    "other_percentage": 25,
                }
            ],
        }

        def handler(request):
            seen["method"] = request.method
            seen["path"] = request.url.path
            return ok_response(data)

        with make_client(handler) as client:
            result = client.get_project_survey_results("proj_1")
        assert seen["method"] == "GET"
        assert seen["path"] == "/v1/projects/proj_1/survey-results"
        assert result["data"] == data


class TestProjectCopy:
    def test_copy_project_posts_without_body(self):
        seen = {}

        def handler(request):
            seen["method"] = request.method
            seen["path"] = request.url.path
            seen["content"] = request.content
            seen["idem"] = request.headers.get("Idempotency-Key")
            return httpx.Response(
                201,
                json={
                    "success": True,
                    "data": {"project_id": "proj_2", "name": "GOTV_v2", "status": "draft"},
                },
            )

        with make_client(handler) as client:
            result = client.copy_project("proj_1")
        assert seen["method"] == "POST"
        assert seen["path"] == "/v1/projects/proj_1/copy"
        assert seen["content"] == b""
        assert UUID_RE.match(seen["idem"])
        assert result["data"]["name"] == "GOTV_v2"
        assert result["data"]["status"] == "draft"

    def test_pause_project_posts_without_body_by_default(self):
        seen = {}

        def handler(request):
            seen["method"] = request.method
            seen["path"] = request.url.path
            seen["content"] = request.content
            seen["idem"] = request.headers.get("Idempotency-Key")
            return ok_response({"project_id": "proj_1", "status": "paused", "pause_reason": "manual"})

        with make_client(handler) as client:
            result = client.pause_project("proj_1")
        assert seen["method"] == "POST"
        assert seen["path"] == "/v1/projects/proj_1/pause"
        assert seen["content"] == b""
        assert UUID_RE.match(seen["idem"])
        assert result["data"]["status"] == "paused"

    def test_pause_project_sends_reason_when_given(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({"project_id": "proj_1", "status": "paused", "pause_reason": "donor call"})

        with make_client(handler) as client:
            client.pause_project("proj_1", reason="donor call")
        assert seen["body"] == {"reason": "donor call"}


class TestProjectListAndCreateOptions:
    @pytest.mark.parametrize(
        ("type", "expected"),
        [("survey", {"type": "survey"}), ("broadcast", {"type": "broadcast"}), (None, {})],
    )
    def test_list_projects_type_serialization(self, type, expected):
        seen = {}

        def handler(request):
            seen["params"] = dict(request.url.params)
            return ok_response([])

        with make_client(handler) as client:
            client.list_projects(type=type)
        assert seen["params"] == expected

    def test_create_project_without_contact_list_ids(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({"project_id": "proj_9", "status": "draft"})

        with make_client(handler) as client:
            client.create_project(
                "org_1",
                "List attached later",
                "sms",
                "Hello",
                phone_number_ids=["pn_1"],
            )
        assert "contact_list_ids" not in seen["body"]

    def test_create_project_sends_link_tracking_fallback_url(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({"project_id": "proj_10", "status": "awaiting_test"})

        with make_client(handler) as client:
            client.create_project(
                "org_1",
                "Per-recipient links",
                "sms",
                "Hello {tracking_url}",
                phone_number_ids=["pn_1"],
                contact_list_ids=["cl_1"],
                link_tracking_enabled=True,
                link_tracking_domain_id="td_1",
                link_tracking_param_field="custom_url",
                link_tracking_destination_url="https://{custom_url}",
                link_tracking_fallback_url="https://example.com/fallback",
            )
        assert seen["body"]["link_tracking_destination_url"] == "https://{custom_url}"
        assert seen["body"]["link_tracking_fallback_url"] == "https://example.com/fallback"

    def test_update_project_omits_link_tracking_fallback_url_unless_given(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({"project_id": "proj_1"})

        with make_client(handler) as client:
            client.update_project("proj_1", name="Renamed")
            client.update_project("proj_1", link_tracking_fallback_url="https://example.com/fb")
        assert seen["body"] == {"link_tracking_fallback_url": "https://example.com/fb"}

    def test_update_project_sends_sending_setup_fields(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({"project_id": "proj_1"})

        with make_client(handler) as client:
            client.update_project(
                "proj_1",
                channel="10dlc",
                brand_id="b1",
                campaign_id="c1",
                phone_number_ids=["pn_1"],
            )
        assert seen["body"] == {
            "channel": "10dlc",
            "brand_id": "b1",
            "campaign_id": "c1",
            "phone_number_ids": ["pn_1"],
        }

    def test_schedule_project_omits_daily_cap_bypass_by_default(self):
        # Absent means pause at the brand's daily T-Mobile carrier limit, which
        # is the safe default; the client must not send the field unasked.
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({"project_id": "proj_1", "status": "scheduled"})

        with make_client(handler) as client:
            client.schedule_project(
                "proj_1", "2026-11-03T09:00:00-04:00", "America/New_York"
            )
        assert seen["body"] == {
            "scheduled_at": "2026-11-03T09:00:00-04:00",
            "scheduled_timezone": "America/New_York",
        }

    def test_schedule_project_sends_daily_cap_bypass_when_set(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({"project_id": "proj_1", "daily_cap_bypass": True})

        with make_client(handler) as client:
            client.schedule_project(
                "proj_1",
                "2026-11-03T09:00:00-04:00",
                "America/New_York",
                daily_cap_bypass=True,
            )
        assert seen["body"]["daily_cap_bypass"] is True

    def test_schedule_project_sends_explicit_false(self):
        # False is a real choice ("pause at the limit"), not an omission.
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({})

        with make_client(handler) as client:
            client.schedule_project(
                "proj_1",
                "2026-11-03T09:00:00-04:00",
                "America/New_York",
                daily_cap_bypass=False,
            )
        assert seen["body"]["daily_cap_bypass"] is False

    def test_create_project_still_sends_explicit_empty_list(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({})

        with make_client(handler) as client:
            client.create_project(
                "org_1",
                "Empty list",
                "sms",
                "Hello",
                phone_number_ids=["pn_1"],
                contact_list_ids=[],
            )
        # The API rejects an explicitly empty array; the SDK must not drop it.
        assert seen["body"]["contact_list_ids"] == []


class TestConversations:
    def test_list_serializes_query_and_omits_unset(self):
        seen = {}

        def handler(request):
            seen["url"] = request.url
            return ok_response({"data": [], "has_more": False, "next_cursor": None})

        with make_client(handler) as client:
            client.list_conversations(project_id="proj_1", updated_since="2026-08-25T00:00:00Z", include_test=True)
        assert seen["url"].path == "/v1/conversations"
        assert seen["url"].params["project_id"] == "proj_1"
        assert seen["url"].params["updated_since"] == "2026-08-25T00:00:00Z"
        assert seen["url"].params["include_test"] == "true"
        assert "limit" not in seen["url"].params
        assert "cursor" not in seen["url"].params

    def test_get_conversation(self):
        seen = {}

        def handler(request):
            seen["path"] = request.url.path
            return ok_response({"conversation_id": "conv_1", "status": "active"})

        with make_client(handler) as client:
            result = client.get_conversation("conv_1")
        assert seen["path"] == "/v1/conversations/conv_1"
        assert result["data"]["status"] == "active"

    def test_list_conversation_messages(self):
        seen = {}

        def handler(request):
            seen["path"] = request.url.path
            seen["params"] = dict(request.url.params)
            return ok_response(
                {
                    "data": [{"message_id": "msg_1", "direction": "inbound", "received_at": "2026-09-01T00:00:00Z"}],
                    "has_more": False,
                    "next_cursor": None,
                }
            )

        with make_client(handler) as client:
            result = client.list_conversation_messages("conv_1", limit=25, cursor="cursor_1")
        assert seen["path"] == "/v1/conversations/conv_1/messages"
        assert seen["params"] == {"limit": "25", "cursor": "cursor_1"}
        assert result["data"]["data"][0]["direction"] == "inbound"

    def test_reply_to_conversation_posts_text_and_auto_generates_idempotency_key(self):
        seen = {}

        def handler(request):
            seen["method"] = request.method
            seen["path"] = request.url.path
            seen["body"] = json.loads(request.content)
            seen["idem"] = request.headers.get("Idempotency-Key")
            return httpx.Response(
                202,
                json={
                    "success": True,
                    "data": {
                        "message_id": "msg_2",
                        "conversation_id": "conv_1",
                        "project_id": "proj_1",
                        "from": "+15559876543",
                        "to": "+15551234567",
                        "text": "Thanks for reaching out",
                        "created_at": "2026-09-07T10:00:00.000Z",
                    },
                },
            )

        with make_client(handler) as client:
            result = client.reply_to_conversation("conv_1", "Thanks for reaching out")
        assert seen["method"] == "POST"
        assert seen["path"] == "/v1/conversations/conv_1/messages"
        assert seen["body"] == {"text": "Thanks for reaching out"}
        assert UUID_RE.match(seen["idem"])
        assert result["data"]["message_id"] == "msg_2"

    def test_reply_to_conversation_sends_media_ids_without_text(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({"message_id": "msg_4", "media_urls": ["https://cdn.example.com/m/a.png"]})

        with make_client(handler) as client:
            result = client.reply_to_conversation("conv_1", media_ids=["media_1"])
        assert seen["body"] == {"text": "", "media_ids": ["media_1"]}
        assert result["data"]["media_urls"] == ["https://cdn.example.com/m/a.png"]

    def test_reply_to_conversation_uses_caller_supplied_idempotency_key(self):
        seen = {}

        def handler(request):
            seen["idem"] = request.headers.get("Idempotency-Key")
            return ok_response({"message_id": "msg_3"})

        with make_client(handler) as client:
            client.reply_to_conversation("conv_1", "Hi", idempotency_key="reply-key-1")
        assert seen["idem"] == "reply-key-1"


class TestEmailTemplates:
    def test_list_serializes_query_and_omits_unset(self):
        seen = {}

        def handler(request):
            seen["url"] = request.url
            return ok_response({"data": [], "has_more": False, "next_cursor": None})

        with make_client(handler) as client:
            client.list_email_templates(limit=100, search="gotv")
        assert seen["url"].path == "/v1/email/templates"
        assert seen["url"].params["limit"] == "100"
        assert seen["url"].params["search"] == "gotv"
        assert "cursor" not in seen["url"].params

    def test_create_returns_lint_alongside_the_template(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return httpx.Response(
                201,
                json={
                    "success": True,
                    "data": {
                        "id": "tpl_1",
                        "name": "GOTV",
                        "content": {"subject": "Vote Tuesday", "editor": "html"},
                        "lint": {"errors": [{"code": "MISSING_UNSUBSCRIBE"}], "warnings": []},
                    },
                },
            )

        with make_client(handler) as client:
            result = client.create_email_template(
                "GOTV", {"subject": "Vote Tuesday", "html": "<p>Vote</p>"}
            )
        assert seen["body"]["content"]["subject"] == "Vote Tuesday"
        assert "description" not in seen["body"]
        assert len(result["data"]["lint"]["errors"]) == 1


class TestMediaUsage:
    def test_email_asset_usage_is_sent_without_a_brand(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({"media_id": "media_1"})

        with make_client(handler) as client:
            client.import_media(
                "https://example.com/header.png",
                organization_id="org_1",
                usage="email_asset",
            )
        assert seen["body"]["usage"] == "email_asset"
        # Email assets are organization-scoped: sending brand_id too is a 400.
        assert "brand_id" not in seen["body"]

    def test_usage_is_omitted_for_a_default_mms_import(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return ok_response({"media_id": "media_2"})

        with make_client(handler) as client:
            client.import_media("https://example.com/rally.jpg", brand_id="brand_1")
        assert "usage" not in seen["body"]


class TestTriggered:
    def _capture(self, data=None):
        seen = {}

        def handler(request):
            seen["method"] = request.method
            seen["path"] = request.url.path
            seen["content"] = request.content
            seen["idem"] = request.headers.get("Idempotency-Key")
            return ok_response(data if data is not None else {})

        return seen, handler

    def test_create_project_sends_type_and_trigger(self):
        seen, handler = self._capture({"project_id": "proj_1", "type": "triggered"})
        trigger = {"source": "api", "delay_minutes": 0}
        with make_client(handler) as client:
            client.create_project(
                "org_1", "Thanks", "sms", "Hi {first_name}", ["pn_1"], type="triggered", trigger=trigger
            )
        body = json.loads(seen["content"])
        assert seen["path"] == "/v1/projects"
        assert body["type"] == "triggered"
        assert body["trigger"] == trigger
        assert "contact_list_ids" not in body

    def test_create_project_sends_a_tag_trigger_with_follow_ups_and_send_time(self):
        seen, handler = self._capture({"project_id": "proj_2"})
        trigger = {"source": "tag", "tag": {"tag_ids": ["tag_1"]}, "start": "next_day"}
        follow_ups = {
            "steps": [{"message_text": "Still in?", "wait": {"unit": "days", "amount": 2}}],
            "stop_on_reply": True,
            "stop_on_click": False,
        }
        with make_client(handler) as client:
            client.create_project(
                "org_1", "Welcome", "sms", "Welcome!", ["pn_1"],
                type="triggered", trigger=trigger, follow_ups=follow_ups,
                scheduled_timezone="America/Chicago", sequence_send_time="09:00",
            )
        body = json.loads(seen["content"])
        assert body["trigger"] == trigger
        assert body["follow_ups"] == follow_ups
        assert body["scheduled_timezone"] == "America/Chicago"
        assert body["sequence_send_time"] == "09:00"

    def test_update_project_clear_follow_ups_sends_null(self):
        seen, handler = self._capture({"follow_ups": None})
        with make_client(handler) as client:
            client.update_project("proj_1", clear_follow_ups=True)
        assert json.loads(seen["content"]) == {"follow_ups": None}

    def test_update_project_refuses_follow_ups_and_clear_together(self):
        with make_client(lambda request: ok_response()) as client:
            with pytest.raises(ValueError, match="not both"):
                client.update_project("proj_1", follow_ups={"steps": []}, clear_follow_ups=True)

    def test_start_project_sends_the_audience(self):
        seen, handler = self._capture({"project_id": "proj_1", "status": "active"})
        with make_client(handler) as client:
            client.start_project("proj_1", audience="new_only")
        assert json.loads(seen["content"]) == {"audience": "new_only"}

    def test_add_project_recipient_returns_already_entered(self):
        seen, handler = self._capture({"status": "already_entered", "reason": "already_entered"})
        with make_client(handler) as client:
            result = client.add_project_recipient("proj_1", "+12025550141")
        assert result["data"] == {"status": "already_entered", "reason": "already_entered"}

    def test_create_email_campaign_sends_timezone_send_time_and_stop_on_click(self):
        seen, handler = self._capture({"id": "camp_2", "type": "broadcast"})
        trigger = {"source": "tag", "tag": {"tag_ids": ["tag_1"]}, "start": "next_day"}
        with make_client(handler) as client:
            client.create_email_campaign(
                "Welcome", "sid_1", template_id="tpl_1", trigger=trigger,
                timezone="America/Denver", sequence_send_time="08:00",
            )
            triggered = json.loads(seen["content"])
            client.create_email_campaign(
                "Drip", "sid_1", ["l_1"], template_id="tpl_1",
                sequence={"stop_on_reply": False, "stop_on_click": True, "steps": [
                    {"template_id": "tpl_2", "delay_days": 3, "send_time": "09:00"},
                ]},
            )
            drip = json.loads(seen["content"])
        assert triggered["timezone"] == "America/Denver"
        assert triggered["sequence_send_time"] == "08:00"
        assert drip["sequence"]["stop_on_click"] is True

    def test_schedule_email_campaign_sends_the_audience(self):
        seen, handler = self._capture({"id": "camp_2"})
        with make_client(handler) as client:
            client.schedule_email_campaign("camp_2", audience="current_and_new")
        assert seen["path"] == "/v1/email/campaigns/camp_2/schedule"
        assert json.loads(seen["content"]) == {"audience": "current_and_new"}

    def test_update_project_sends_trigger(self):
        seen, handler = self._capture()
        with make_client(handler) as client:
            client.update_project("proj_1", trigger={"source": "api"})
        assert seen["method"] == "PATCH"
        assert json.loads(seen["content"]) == {"trigger": {"source": "api"}}

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("start_project", "/v1/projects/proj_1/start"),
            ("end_project", "/v1/projects/proj_1/end"),
            ("create_project_hook", "/v1/projects/proj_1/hook"),
        ],
    )
    def test_project_posts_without_body(self, method, path):
        seen, handler = self._capture()
        with make_client(handler) as client:
            getattr(client, method)("proj_1", idempotency_key="key-1")
        assert seen["method"] == "POST"
        assert seen["path"] == path
        assert seen["content"] == b""
        assert seen["idem"] == "key-1"

    def test_add_project_recipient(self):
        seen, handler = self._capture({"status": "queued", "send_at": "2026-11-13T14:00:00.000Z"})
        with make_client(handler) as client:
            result = client.add_project_recipient(
                "proj_1",
                "+12025550141",
                fields={"first_name": "Ada", "amount": 25},
                occurrence_id="evt_123",
                idempotency_key="add-1",
            )
        assert seen["method"] == "POST"
        assert seen["path"] == "/v1/projects/proj_1/recipients"
        assert json.loads(seen["content"]) == {
            "phone_number": "+12025550141",
            "fields": {"first_name": "Ada", "amount": 25},
            "occurrence_id": "evt_123",
        }
        assert seen["idem"] == "add-1"
        assert result["data"]["status"] == "queued"

    def test_add_project_recipient_opted_out_raises(self):
        def handler(request):
            return error_response(409, "CONTACT_OPTED_OUT")

        with make_client(handler) as client:
            with pytest.raises(PoliticalCommsError) as exc:
                client.add_project_recipient("proj_1", "+12025550141")
        assert exc.value.code == "CONTACT_OPTED_OUT"

    def test_create_email_campaign_with_trigger_omits_list_ids(self):
        seen, handler = self._capture({"id": "camp_1", "type": "triggered"})
        trigger = {"source": "event", "event": {"event": "email_open", "sources": "any"}}
        with make_client(handler) as client:
            client.create_email_campaign("Welcome", "sid_1", template_id="tpl_1", trigger=trigger)
        body = json.loads(seen["content"])
        assert seen["path"] == "/v1/email/campaigns"
        assert body["trigger"] == trigger
        assert "list_ids" not in body

    def test_create_email_campaign_sends_a_sequence_beside_a_trigger(self):
        seen, handler = self._capture({"id": "camp_1", "type": "triggered"})
        sequence = {"steps": [{"template_id": "tpl_2", "delay_days": 1, "send_time": "09:00"}]}
        with make_client(handler) as client:
            client.create_email_campaign(
                "Welcome", "sid_1", template_id="tpl_1", trigger={"source": "api"}, sequence=sequence
            )
        body = json.loads(seen["content"])
        assert body["trigger"] == {"source": "api"}
        assert body["sequence"] == sequence

    def test_create_email_campaign_sends_an_hour_step(self):
        seen, handler = self._capture({"id": "camp_1", "type": "broadcast"})
        sequence = {"steps": [
            {"template_id": "tpl_2", "delay_days": 3, "send_time": "09:00"},
            {"template_id": "tpl_3", "delay_hours": 48},
        ]}
        with make_client(handler) as client:
            client.create_email_campaign("Drip", "sid_1", ["l_1"], template_id="tpl_1", sequence=sequence)
        body = json.loads(seen["content"])
        assert body["sequence"]["steps"][1] == {"template_id": "tpl_3", "delay_hours": 48}

    @pytest.mark.parametrize(
        ("method", "path"),
        [
            ("end_email_campaign", "/v1/email/campaigns/camp_1/end"),
            ("pause_email_campaign", "/v1/email/campaigns/camp_1/pause"),
            ("create_email_campaign_hook", "/v1/email/campaigns/camp_1/hook"),
        ],
    )
    def test_email_campaign_posts_without_body(self, method, path):
        seen, handler = self._capture()
        with make_client(handler) as client:
            getattr(client, method)("camp_1", idempotency_key="key-2")
        assert seen["method"] == "POST"
        assert seen["path"] == path
        assert seen["content"] == b""
        assert seen["idem"] == "key-2"

    def test_resume_email_campaign_with_resume_at(self):
        seen, handler = self._capture({"status": "paused", "resume_at": "2026-12-01T15:00:00Z"})
        with make_client(handler) as client:
            result = client.resume_email_campaign(
                "camp_1", resume_at="2026-12-01T15:00:00Z", idempotency_key="key-3"
            )
        assert seen["method"] == "POST"
        assert seen["path"] == "/v1/email/campaigns/camp_1/resume"
        assert json.loads(seen["content"]) == {"resume_at": "2026-12-01T15:00:00Z"}
        assert seen["idem"] == "key-3"
        assert result["data"]["resume_at"] == "2026-12-01T15:00:00Z"

    def test_resume_email_campaign_now_sends_no_resume_at(self):
        seen, handler = self._capture()
        with make_client(handler) as client:
            client.resume_email_campaign("camp_1")
        assert seen["path"] == "/v1/email/campaigns/camp_1/resume"
        assert b"resume_at" not in seen["content"]

    def test_add_email_campaign_recipient(self):
        seen, handler = self._capture({"status": "already_entered", "reason": "duplicate"})
        with make_client(handler) as client:
            result = client.add_email_campaign_recipient(
                "camp_1", "ada@example.org", fields={"first_name": "Ada"}, occurrence_id="evt_9"
            )
        assert seen["path"] == "/v1/email/campaigns/camp_1/recipients"
        assert json.loads(seen["content"]) == {
            "email": "ada@example.org",
            "fields": {"first_name": "Ada"},
            "occurrence_id": "evt_9",
        }
        assert UUID_RE.match(seen["idem"])
        assert result["data"]["reason"] == "duplicate"


class TestWebhookEndpoints:
    ENDPOINT = {
        "id": "ep_1",
        "name": "CRM sync",
        "url": "https://example.org/hooks",
        "enabled": False,
        "event_types": ["message.delivered"],
        "failing_since": "2026-11-10T00:00:00Z",
        "disabled_reason": "consecutive_failures",
        "created_at": "2026-10-01T00:00:00Z",
        "updated_at": "2026-11-13T00:00:00Z",
    }

    def test_list_serializes_query_and_omits_unset(self):
        seen = {}

        def handler(request):
            seen["method"] = request.method
            seen["url"] = request.url
            return ok_response({"data": [self.ENDPOINT], "has_more": True, "next_cursor": "c2"})

        with make_client(handler) as client:
            result = client.list_webhook_endpoints(limit=25)
            client.list_webhook_endpoints(cursor="c1")
        assert seen["method"] == "GET"
        assert seen["url"].path == "/v1/webhook-endpoints"
        assert seen["url"].params["cursor"] == "c1"
        assert "limit" not in seen["url"].params
        assert result["data"]["next_cursor"] == "c2"
        assert result["data"]["data"][0]["disabled_reason"] == "consecutive_failures"

    def test_get_reads_one_endpoint(self):
        seen = {}

        def handler(request):
            seen["method"] = request.method
            seen["path"] = request.url.path
            return ok_response(self.ENDPOINT)

        with make_client(handler) as client:
            result = client.get_webhook_endpoint("ep_1")
        assert seen["method"] == "GET"
        assert seen["path"] == "/v1/webhook-endpoints/ep_1"
        assert result["data"]["event_types"] == ["message.delivered"]


class TestTags:
    TAG = {
        "id": "tag_1",
        "name": "Volunteers",
        "kind": "manual",
        "activity_event": None,
        "within_days": None,
        "member_count": 10000,
        "member_count_capped": True,
        "organization_id": "org_1",
        "created_at": "2026-11-17T00:00:00Z",
    }

    @staticmethod
    def record(seen, data):
        def handler(request):
            seen["method"] = request.method
            seen["url"] = request.url
            seen["body"] = json.loads(request.content) if request.content else None
            seen["idem"] = request.headers.get("Idempotency-Key")
            return ok_response(data)

        return handler

    def test_list_tags_passes_the_organization(self):
        seen = {}
        with make_client(self.record(seen, [self.TAG])) as client:
            result = client.list_tags(organization_id="org_2")
        assert seen["method"] == "GET"
        assert seen["url"].path == "/v1/tags"
        assert seen["url"].params["organization_id"] == "org_2"
        assert result["data"][0]["member_count_capped"] is True

    def test_list_tags_omits_an_unset_organization(self):
        seen = {}
        with make_client(self.record(seen, [])) as client:
            client.list_tags()
        assert "organization_id" not in seen["url"].params

    def test_create_manual_tag(self):
        seen = {}
        with make_client(self.record(seen, self.TAG)) as client:
            result = client.create_tag("Volunteers")
        assert seen["method"] == "POST"
        assert seen["url"].path == "/v1/tags"
        assert seen["body"] == {"name": "Volunteers"}
        assert UUID_RE.match(seen["idem"])
        assert result["data"]["kind"] == "manual"

    def test_create_activity_tag(self):
        seen = {}
        with make_client(self.record(seen, {**self.TAG, "kind": "activity"})) as client:
            client.create_tag(activity_event="donated", within_days=90, organization_id="org_2")
        assert seen["body"] == {"activity_event": "donated", "within_days": 90, "organization_id": "org_2"}

    def test_rename_tag(self):
        seen = {}
        with make_client(self.record(seen, {**self.TAG, "name": "Core"})) as client:
            result = client.rename_tag("tag_1", "Core", idempotency_key="rename-1")
        assert seen["method"] == "PATCH"
        assert seen["url"].path == "/v1/tags/tag_1"
        assert seen["body"] == {"name": "Core"}
        assert seen["idem"] == "rename-1"
        assert result["data"]["name"] == "Core"

    def test_delete_tag_sends_no_body_and_no_generated_key(self):
        seen = {}
        with make_client(self.record(seen, {"id": "tag_1", "deleted": True})) as client:
            result = client.delete_tag("tag_1")
        assert seen["method"] == "DELETE"
        assert seen["url"].path == "/v1/tags/tag_1"
        assert seen["body"] is None
        assert seen["idem"] is None
        assert result["data"]["deleted"] is True

    def test_delete_tag_in_use_exposes_the_blocking_sends(self):
        details = {
            "projects": [{"id": "proj_1", "name": "GOTV", "status": "scheduled"}],
            "emailCampaigns": [],
        }

        def handler(request):
            return httpx.Response(
                409,
                json={"success": False, "error": "in use", "code": "TAG_IN_USE", "details": details},
            )

        with make_client(handler) as client:
            with pytest.raises(PoliticalCommsError) as exc:
                client.delete_tag("tag_1")
        assert exc.value.code == "TAG_IN_USE"
        assert exc.value.body["details"] == details

    def test_add_tag_contacts_by_identifiers(self):
        seen = {}
        with make_client(self.record(seen, {"added": 2, "invalid": 1})) as client:
            result = client.add_tag_contacts("tag_1", ("(202) 555-0101", "ada@example.org", "nope"))
        assert seen["method"] == "POST"
        assert seen["url"].path == "/v1/tags/tag_1/contacts"
        assert seen["body"] == {"identifiers": ["(202) 555-0101", "ada@example.org", "nope"]}
        assert UUID_RE.match(seen["idem"])
        assert result["data"] == {"added": 2, "invalid": 1}

    @staticmethod
    def queued(data):
        return lambda request: httpx.Response(202, json={"success": True, "data": data})

    def test_add_tag_contacts_sends_fire_triggers_and_returns_entered(self):
        seen = {}
        with make_client(self.record(seen, {"added": 1, "invalid": 0, "triggers": {"entered": 1}})) as client:
            result = client.add_tag_contacts("tag_1", ["+12025550101"], fire_triggers=False)
        assert seen["body"] == {"identifiers": ["+12025550101"], "fire_triggers": False}
        assert result["data"]["triggers"] == {"entered": 1}

    def test_tag_contacts_by_name_sends_fire_triggers(self):
        seen = {}
        with make_client(self.record(seen, {"queued": True, "job_id": "job_1", "fire_triggers": True})) as client:
            client.tag_contacts("Volunteers", contact_list_id="cl_1", fire_triggers=True)
        assert seen["body"] == {"name": "Volunteers", "contact_list_id": "cl_1", "fire_triggers": True}

    def test_add_tag_contacts_by_list_returns_the_queued_answer(self):
        with make_client(self.queued({"queued": True, "job_id": "job_1"})) as client:
            result = client.add_tag_contacts("tag_1", contact_list_id="cl_1")
        assert result["data"] == {"queued": True, "job_id": "job_1"}

    def test_remove_tag_contacts_is_a_delete_with_a_body(self):
        seen = {}
        with make_client(self.record(seen, {"removed": 3, "not_tagged": 0, "invalid": 0})) as client:
            result = client.remove_tag_contacts("tag_1", ["ada@example.org"], idempotency_key="untag-1")
        assert seen["method"] == "DELETE"
        assert seen["url"].path == "/v1/tags/tag_1/contacts"
        assert seen["body"] == {"identifiers": ["ada@example.org"]}
        assert seen["idem"] == "untag-1"
        assert result["data"]["removed"] == 3

    def test_remove_tag_contacts_by_list_returns_the_queued_answer(self):
        with make_client(self.queued({"queued": True, "job_id": "job_2"})) as client:
            result = client.remove_tag_contacts("tag_1", contact_list_id="cl_1")
        assert result["data"] == {"queued": True, "job_id": "job_2"}

    def test_tag_contacts_by_name_and_list_returns_the_tag_and_the_job(self):
        reply = {"tag": {"id": "tag_9", "name": "Donor"}, "created": True, "queued": True, "job_id": "job_3"}
        with make_client(self.queued(reply)) as client:
            result = client.tag_contacts("Donor", contact_list_id="cl_1")
        assert result["data"] == reply

    def test_get_contact_list_passes_the_failure_reasons_through(self):
        error = {"code": "TAG_COLUMN_TOO_MANY_TAGS", "message": "That column would create more than 100 tags."}
        data = {"list_id": "cl_1", "import": {"status": "failed", "error": error}, "email": {"status": "ready", "error": None}}
        with make_client(lambda request: ok_response(data)) as client:
            result = client.get_contact_list("cl_1")
        assert result["data"]["import"]["error"] == error
        assert result["data"]["email"]["error"] is None

    @pytest.mark.parametrize("kwargs", [{}, {"identifiers": ["a@example.org"], "contact_list_id": "cl_1"}])
    def test_tag_contacts_need_exactly_one_source(self, kwargs):
        calls = []
        with make_client(lambda request: calls.append(request) or ok_response({})) as client:
            with pytest.raises(ValueError):
                client.add_tag_contacts("tag_1", **kwargs)
        assert calls == []

    def test_tag_contacts_by_name_posts_and_returns_created(self):
        seen = {}
        reply = {"tag": {"id": "tag_9", "name": "Donor"}, "created": True, "added": 1, "invalid": 0}
        with make_client(self.record(seen, reply)) as client:
            result = client.tag_contacts("Donor", ["ada@example.org"], organization_id="org_2")
        assert seen["method"] == "POST"
        assert seen["url"].path == "/v1/tags/contacts"
        assert seen["body"] == {"name": "Donor", "organization_id": "org_2", "identifiers": ["ada@example.org"]}
        assert UUID_RE.match(seen["idem"])
        assert result["data"]["created"] is True

    def test_untag_contacts_by_name_is_a_delete_with_a_body(self):
        seen = {}
        reply = {"tag": {"id": "tag_9"}, "queued": True, "job_id": "job_4"}
        with make_client(self.record(seen, reply)) as client:
            result = client.untag_contacts("donor", contact_list_id="cl_1", idempotency_key="untag-2")
        assert seen["method"] == "DELETE"
        assert seen["url"].path == "/v1/tags/contacts"
        assert seen["body"] == {"name": "donor", "contact_list_id": "cl_1"}
        assert seen["idem"] == "untag-2"
        assert result["data"]["job_id"] == "job_4"

    def test_tag_contacts_by_name_needs_exactly_one_source(self):
        calls = []
        with make_client(lambda request: calls.append(request) or ok_response({})) as client:
            with pytest.raises(ValueError):
                client.tag_contacts("Donor")
        assert calls == []

    def test_create_project_sends_tags_without_a_list(self):
        seen = {}
        with make_client(self.record(seen, {"project_id": "proj_1"})) as client:
            client.create_project(
                "org_1", "Tagged", "sms", "Hi", ["pn_1"],
                tag_ids=["t1"], require_tag_ids=["t2"], suppression_tag_ids=["t3"],
            )
        assert seen["body"]["tag_ids"] == ["t1"]
        assert seen["body"]["require_tag_ids"] == ["t2"]
        assert seen["body"]["suppression_tag_ids"] == ["t3"]
        assert "contact_list_ids" not in seen["body"]

    def test_update_project_sends_empty_lists_to_clear_fields(self):
        seen = {}
        with make_client(self.record(seen, {"project_id": "proj_1"})) as client:
            client.update_project("proj_1", contact_list_ids=[], tag_ids=["t1"], suppression_tag_ids=[])
        assert seen["method"] == "PATCH"
        assert seen["body"] == {"contact_list_ids": [], "tag_ids": ["t1"], "suppression_tag_ids": []}

    def test_create_email_campaign_with_tags_and_no_lists(self):
        seen = {}
        with make_client(self.record(seen, {"id": "camp_1", "tag_ids": ["t1"]})) as client:
            result = client.create_email_campaign(
                "N", "s_1", template_id="tpl_1",
                tag_ids=["t1"], require_tag_ids=["t2"], suppression_tag_ids=["t3"],
            )
        assert seen["url"].path == "/v1/email/campaigns"
        assert seen["body"] == {
            "name": "N",
            "sender_identity_id": "s_1",
            "template_id": "tpl_1",
            "tag_ids": ["t1"],
            "require_tag_ids": ["t2"],
            "suppression_tag_ids": ["t3"],
        }
        assert result["data"]["tag_ids"] == ["t1"]

    def test_import_contact_list_sends_tag_fields(self):
        seen = {}
        with make_client(self.record(seen, {"purpose": "audience", "list_id": "cl_1"})) as client:
            client.import_contact_list(
                "https://example.org/a.csv", "A", "Phone",
                tag_ids=["t1"], tag_names=["Walk list"], tags_column="Tags", fire_triggers=True,
            )
        assert seen["body"] == {
            "source_url": "https://example.org/a.csv",
            "list_name": "A",
            "phone_column": "Phone",
            "tag_ids": ["t1"],
            "tag_names": ["Walk list"],
            "tags_column": "Tags",
            "fire_triggers": True,
        }


SURVEY_QUESTIONS = [
    {"sequence": 1, "question_type": "intro", "question_text": "Hi, 1 quick question?"},
    {
        "sequence": 2,
        "question_type": "multiple_choice",
        "question_text": "Will you vote? Reply 1 Yes, 2 No.",
        "response_options": [{"value": 1, "label": "Yes"}, {"value": 2, "label": "No"}],
        "no_match_sequence": None,
    },
]


class TestSurveyProjects:
    def capture(self, data):
        seen = {}

        def handler(request):
            seen["method"] = request.method
            seen["body"] = json.loads(request.content) if request.content else None
            return ok_response(data)

        return make_client(handler), seen

    def test_create_survey_sends_exactly_the_survey_body(self):
        client, seen = self.capture({"project_id": "proj_1", "type": "survey", "question_count": 2})
        result = client.create_project(
            "org_1",
            "Intent",
            type="survey",
            campaign_id="camp_1",
            phone_number_ids=["pn_1"],
            contact_list_ids=["cl_1"],
            tag_ids=["tag_1"],
            questions=SURVEY_QUESTIONS,
            ai_survey_analysis_enabled=True,
        )
        assert seen["body"] == {
            "organization_id": "org_1",
            "campaign_id": "camp_1",
            "phone_number_ids": ["pn_1"],
            "name": "Intent",
            "contact_list_ids": ["cl_1"],
            "tag_ids": ["tag_1"],
            "type": "survey",
            "questions": SURVEY_QUESTIONS,
            "ai_survey_analysis_enabled": True,
        }
        assert result["data"]["question_count"] == 2

    @pytest.mark.parametrize(
        "kwargs, message",
        [
            (
                {"type": "survey", "campaign_id": "c", "questions": SURVEY_QUESTIONS, "protocol": "sms", "message_text": "Hi"},
                "remove protocol, message_text",
            ),
            ({"type": "survey", "questions": SURVEY_QUESTIONS}, "needs questions and campaign_id"),
            ({"protocol": "sms", "message_text": "Hi", "questions": SURVEY_QUESTIONS}, "Only a survey"),
            ({}, "needs protocol and message_text"),
        ],
    )
    def test_create_refuses_a_mixed_body_before_any_request(self, kwargs, message):
        client, seen = self.capture({})
        with pytest.raises(ValueError, match=message):
            client.create_project("org_1", "S", phone_number_ids=["pn_1"], **kwargs)
        assert seen == {}

    def test_positional_broadcast_create_still_works(self):
        client, seen = self.capture({"project_id": "proj_2"})
        client.create_project("org_1", "B", "sms", "Hi", ["pn_1"], ["cl_1"])
        assert seen["body"]["protocol"] == "sms"
        assert "questions" not in seen["body"]

    def test_update_survey_replaces_questions_and_refuses_message_fields(self):
        client, seen = self.capture({"project_id": "proj_1", "type": "survey"})
        client.update_project("proj_1", questions=SURVEY_QUESTIONS, name="Renamed")
        assert seen["body"] == {"name": "Renamed", "questions": SURVEY_QUESTIONS}
        with pytest.raises(ValueError, match="remove message_text"):
            client.update_project("proj_1", questions=SURVEY_QUESTIONS, message_text="Hi")

    def test_get_project_returns_survey_questions(self):
        questions = [
            {
                "id": "q_1",
                "sequence": 1,
                "question_type": "intro",
                "question_text": "Hi",
                "message_type": "sms",
                "media_urls": [],
                "response_options": [],
                "no_match_sequence": None,
                "is_required": True,
            }
        ]
        client, _ = self.capture({"project_id": "proj_1", "type": "survey", "message_text": None, "questions": questions})
        assert client.get_project("proj_1")["data"]["questions"] == questions
