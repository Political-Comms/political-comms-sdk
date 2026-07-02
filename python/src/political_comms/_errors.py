from __future__ import annotations

from typing import Any


class PoliticalCommsError(Exception):
    """Error raised for any non-success response from the Political Comms API,
    and for network failures (code "NETWORK_ERROR", status_code 0).

    The API returns errors as JSON:
    ``{"success": false, "error": str, "code": str, "statusCode": int}``
    """

    def __init__(self, message: str, code: str, status_code: int, body: Any = None) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.body = body

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"PoliticalCommsError(code={self.code!r}, status_code={self.status_code!r}, "
            f"message={str(self)!r})"
        )
