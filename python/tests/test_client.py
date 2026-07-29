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


class TestProjectCopyArchive:
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

    def test_archive_project(self):
        seen = {}

        def handler(request):
            seen["method"] = request.method
            seen["path"] = request.url.path
            return ok_response(
                {"project_id": "proj_1", "status": "archived", "archived_at": "2026-07-29T00:00:00Z"}
            )

        with make_client(handler) as client:
            result = client.archive_project("proj_1")
        assert seen == {"method": "POST", "path": "/v1/projects/proj_1/archive"}
        assert result["data"]["status"] == "archived"


class TestProjectListAndCreateOptions:
    @pytest.mark.parametrize(
        ("archived", "expected"),
        [(True, {"archived": "true"}), (False, {"archived": "false"}), (None, {})],
    )
    def test_list_projects_archived_serialization(self, archived, expected):
        seen = {}

        def handler(request):
            seen["params"] = dict(request.url.params)
            return ok_response([])

        with make_client(handler) as client:
            client.list_projects(archived=archived)
        assert seen["params"] == expected

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
