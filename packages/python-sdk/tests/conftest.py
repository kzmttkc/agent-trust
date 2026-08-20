"""Shared fixtures: a mock-transport-backed client factory and score payloads.

Everything runs against ``httpx.MockTransport`` — no network, no real API key.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional

import httpx
import pytest

from vet402 import VouchClient

PAYEE = "0x" + "ab" * 20
OTHER_PAYEE = "0x" + "cd" * 20


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def make_payee_score(
    *,
    recommendation: str = "ALLOW",
    score: Any = 82,
    degraded: bool = False,
    signals_unavailable: Optional[list] = None,
    scored_at: Optional[str] = None,
    cache_expires_at: Optional[str] = None,
    now: Optional[datetime] = None,
    **overrides: Any,
) -> Dict[str, Any]:
    """A fresh, clean payee score payload matching docs/openapi.yaml."""
    base_now = now or datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "payee": PAYEE.lower(),
        "score": score,
        "recommendation": recommendation,
        "dataDepth": "moderate",
        "degraded": degraded,
        "signalsUnavailable": signals_unavailable or [],
        "signals": {
            "receiving": {
                "paymentCount": 12,
                "uniqueDays": 5,
                "distinctPayers": 4,
                "score": 70,
            },
            "walletHealth": {
                "ageDays": 320,
                "txCount": 210,
                "isBurner": False,
                "score": 80,
            },
            "drainPattern": {
                "detected": False,
                "drainRatio": 0.1,
                "outgoingCount": 3,
                "incomingCount": 12,
                "score": 90,
            },
            "outcomeHistory": {"types": [], "adjustment": 0},
            "flags": [],
        },
        "scoredAt": scored_at or iso(base_now),
        "cacheExpiresAt": cache_expires_at or iso(base_now + timedelta(minutes=5)),
        "disclaimer": "Informational only.",
    }
    payload.update(overrides)
    return payload


class RequestRecorder:
    """Counts requests and hands each one to a handler."""

    def __init__(self, handler: Callable[[httpx.Request], httpx.Response]) -> None:
        self.handler = handler
        self.requests: list = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)


@pytest.fixture
def make_client() -> Callable[..., tuple]:
    """Factory: build a VouchClient wired to a MockTransport handler.

    Returns ``(client, recorder)`` so tests can assert on request counts,
    paths, and headers.
    """

    def _make(
        handler: Callable[[httpx.Request], httpx.Response],
        *,
        api_key: str = "vk_test_key",
    ) -> tuple:
        recorder = RequestRecorder(handler)
        client = VouchClient(
            api_key,
            api_url="https://vet402.test/api/v1",
            transport=httpx.MockTransport(recorder),
        )
        return client, recorder

    return _make
