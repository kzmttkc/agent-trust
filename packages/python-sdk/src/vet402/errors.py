"""Error types for the vet402 SDK."""

from __future__ import annotations

__all__ = ["VouchApiError"]


class VouchApiError(Exception):
    """Raised when the Vouch API answers with a non-2xx status.

    ``str(error)`` is the machine-readable code the API returned (e.g.
    ``missing_api_key``, ``invalid_api_key``, ``rate_limit_exceeded``) so
    string checks keep working; ``code`` and ``status`` expose the same facts
    without string parsing. :class:`~vet402.spend_guard.SpendGuard` uses them
    to tell "your key is missing" apart from "the upstream is down".

    Mirrors ``VouchApiError`` in the TypeScript SDK (same fields, same codes).
    """

    def __init__(self, code: str, status: int) -> None:
        super().__init__(code)
        self.code: str = code
        self.status: int = status

    def __repr__(self) -> str:  # pragma: no cover - debug convenience
        return f"VouchApiError(code={self.code!r}, status={self.status})"
