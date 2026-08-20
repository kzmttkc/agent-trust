"""SpendGuard semantics tests — same observation points as the TS SDK suite:

- fail-closed default (nothing but a clean ALLOW moves money)
- 401/403 vs network/5xx reason-code distinction
- local rules (per-tx cap, daily budget) and lookup skipping
- staleness gate, degraded/partial measurement gates
- tampered-response resilience (deny, never crash)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import httpx
import pytest

from vet402 import (
    DEFAULT_MAX_SCORE_AGE_MS,
    SpendDecision,
    SpendGuard,
    VouchApiError,
    classify_lookup_failure,
)

from conftest import PAYEE, iso, make_payee_score


# ---------------------------------------------------------------------------
# ALLOW happy path
# ---------------------------------------------------------------------------


def test_clean_allow_passes(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(200, json=make_payee_score())
    )
    guard = client.create_spend_guard(max_per_tx_usd=10, daily_budget_usd=50)
    decision = guard.evaluate(PAYEE, 5)
    assert isinstance(decision, SpendDecision)
    assert decision.allow is True
    assert decision.reasons == []
    assert decision.spent_today_usd == 5
    assert decision.remaining_daily_budget_usd == 45
    assert decision.payee_score is not None
    assert decision.payee_score["recommendation"] == "ALLOW"


# ---------------------------------------------------------------------------
# Lookup failure classification: caller's key vs upstream
# ---------------------------------------------------------------------------


def test_missing_api_key_401_denies_as_unauthenticated(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(401, json={"error": "missing_api_key"})
    )
    guard = client.create_spend_guard()
    decision = guard.evaluate(PAYEE, 5)
    assert decision.allow is False
    assert decision.reasons == ["payee_trust_unauthenticated"]
    assert decision.payee_score is None


def test_forbidden_403_denies_as_unauthenticated(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(403, json={"error": "forbidden"})
    )
    guard = client.create_spend_guard()
    decision = guard.evaluate(PAYEE, 5)
    assert decision.reasons == ["payee_trust_unauthenticated"]


def test_5xx_denies_as_unavailable(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(503, json={"error": "upstream_down"})
    )
    guard = client.create_spend_guard()
    decision = guard.evaluate(PAYEE, 5)
    assert decision.allow is False
    assert decision.reasons == ["payee_trust_unavailable"]


def test_network_error_denies_as_unavailable(make_client) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client, _ = make_client(handler)
    guard = client.create_spend_guard()
    decision = guard.evaluate(PAYEE, 5)
    assert decision.allow is False
    assert decision.reasons == ["payee_trust_unavailable"]


def test_classify_lookup_failure_matches_ts_semantics() -> None:
    assert classify_lookup_failure(VouchApiError("missing_api_key", 401)) == (
        "payee_trust_unauthenticated"
    )
    assert classify_lookup_failure(VouchApiError("forbidden", 403)) == (
        "payee_trust_unauthenticated"
    )
    assert classify_lookup_failure(VouchApiError("rate_limit_exceeded", 429)) == (
        "payee_trust_unavailable"
    )
    assert classify_lookup_failure(VouchApiError("upstream_down", 500)) == (
        "payee_trust_unavailable"
    )
    # Fallback by code/message when no structured status exists (injected
    # fetcher in a host app).
    assert classify_lookup_failure(RuntimeError("invalid_api_key")) == (
        "payee_trust_unauthenticated"
    )
    assert classify_lookup_failure(RuntimeError("boom")) == "payee_trust_unavailable"


# ---------------------------------------------------------------------------
# Local rules: per-tx cap and daily budget
# ---------------------------------------------------------------------------


def test_max_per_tx_denies_without_burning_lookup_quota(make_client) -> None:
    client, recorder = make_client(
        lambda request: httpx.Response(200, json=make_payee_score())
    )
    guard = client.create_spend_guard(max_per_tx_usd=10)
    decision = guard.evaluate(PAYEE, 25)
    assert decision.allow is False
    assert decision.reasons == ["max_per_tx_exceeded"]
    assert recorder.requests == []  # local deny skips the API call


def test_daily_budget_exceeded_denies_and_counter_persists(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(200, json=make_payee_score())
    )
    guard = client.create_spend_guard(daily_budget_usd=50)

    first = guard.evaluate(PAYEE, 30)
    assert first.allow is True
    assert first.spent_today_usd == 30

    second = guard.evaluate(PAYEE, 30)  # 30 + 30 > 50
    assert second.allow is False
    assert second.reasons == ["daily_budget_exceeded"]
    assert second.spent_today_usd == 30  # denied amount not counted

    third = guard.evaluate(PAYEE, 20)  # exactly fills the budget
    assert third.allow is True
    assert third.remaining_daily_budget_usd == 0


def test_trust_deny_returns_optimistic_reservation(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(200, json=make_payee_score(recommendation="WARN"))
    )
    guard = client.create_spend_guard(daily_budget_usd=50)
    decision = guard.evaluate(PAYEE, 30)
    assert decision.allow is False
    assert decision.spent_today_usd == 0  # reservation given back on deny
    assert guard.state()["spent_today_usd"] == 0


def test_release_returns_budget_and_clamps_at_zero(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(200, json=make_payee_score())
    )
    guard = client.create_spend_guard(daily_budget_usd=50)
    assert guard.evaluate(PAYEE, 30).allow is True
    guard.release(30)
    assert guard.state()["spent_today_usd"] == 0
    guard.release(10)  # over-release clamps, never negative
    assert guard.state()["spent_today_usd"] == 0


def test_daily_budget_resets_on_utc_day_rollover() -> None:
    current = {"now": datetime(2026, 8, 20, 23, 0, tzinfo=timezone.utc)}
    guard = SpendGuard(
        lambda payee: make_payee_score(now=current["now"]),
        daily_budget_usd=50,
        now=lambda: current["now"],
    )
    assert guard.evaluate(PAYEE, 40).allow is True
    assert guard.evaluate(PAYEE, 40).allow is False  # same day: over budget
    current["now"] = datetime(2026, 8, 21, 0, 5, tzinfo=timezone.utc)
    decision = guard.evaluate(PAYEE, 40)  # fresh UTC day: counter reset
    assert decision.allow is True
    assert decision.spent_today_usd == 40


# ---------------------------------------------------------------------------
# Fail-closed trust verdicts
# ---------------------------------------------------------------------------


def test_warn_denies_under_default_allow_only(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(200, json=make_payee_score(recommendation="WARN"))
    )
    guard = client.create_spend_guard()
    decision = guard.evaluate(PAYEE, 5)
    assert decision.allow is False
    assert decision.reasons == ["payee_recommendation_not_allow"]
    assert decision.payee_score is not None  # verdict is attached for logging


def test_block_denies_under_default_allow_only(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(
            200, json=make_payee_score(recommendation="BLOCK", score=5)
        )
    )
    guard = client.create_spend_guard()
    assert guard.evaluate(PAYEE, 5).reasons == ["payee_recommendation_not_allow"]


def test_degraded_read_denies(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(
            200,
            json=make_payee_score(degraded=True, recommendation="ALLOW"),
        )
    )
    guard = client.create_spend_guard()
    assert guard.evaluate(PAYEE, 5).reasons == ["payee_score_degraded"]


def test_partial_measurement_denies(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(
            200,
            json=make_payee_score(signals_unavailable=["walletHealth"]),
        )
    )
    guard = client.create_spend_guard()
    assert guard.evaluate(PAYEE, 5).reasons == ["payee_partial_measurement"]


def test_stale_scored_at_denies(make_client) -> None:
    old = datetime.now(timezone.utc) - timedelta(minutes=30)
    client, _ = make_client(
        lambda request: httpx.Response(
            200,
            json=make_payee_score(
                scored_at=iso(old),
                cache_expires_at=iso(datetime.now(timezone.utc) + timedelta(minutes=5)),
            ),
        )
    )
    guard = client.create_spend_guard()
    assert guard.evaluate(PAYEE, 5).reasons == ["payee_score_stale"]


def test_cache_expires_at_is_hard_ceiling_even_with_lax_age(make_client) -> None:
    now = datetime.now(timezone.utc)
    client, _ = make_client(
        lambda request: httpx.Response(
            200,
            json=make_payee_score(
                scored_at=iso(now - timedelta(minutes=1)),
                cache_expires_at=iso(now - timedelta(seconds=1)),  # already expired
            ),
        )
    )
    guard = client.create_spend_guard(max_score_age_ms=float("inf"))
    assert guard.evaluate(PAYEE, 5).reasons == ["payee_score_stale"]


def test_min_payee_score_composes_on_top(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(
            200, json=make_payee_score(recommendation="ALLOW", score=35)
        )
    )
    guard = client.create_spend_guard(min_payee_score=40)
    assert guard.evaluate(PAYEE, 5).reasons == ["payee_score_below_min"]


# ---------------------------------------------------------------------------
# Tampered / malformed response resilience: deny, never crash
# ---------------------------------------------------------------------------


def test_missing_recommendation_denies(make_client) -> None:
    payload = make_payee_score()
    del payload["recommendation"]
    client, _ = make_client(lambda request: httpx.Response(200, json=payload))
    guard = client.create_spend_guard()
    decision = guard.evaluate(PAYEE, 5)
    assert decision.allow is False
    assert decision.reasons == ["payee_recommendation_not_allow"]


def test_lowercase_allow_string_does_not_pass(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(
            200, json=make_payee_score(recommendation="allow")
        )
    )
    guard = client.create_spend_guard()
    assert guard.evaluate(PAYEE, 5).allow is False


def test_non_string_recommendation_denies(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(
            200, json=make_payee_score(recommendation={"$gt": ""})
        )
    )
    guard = client.create_spend_guard()
    assert guard.evaluate(PAYEE, 5).allow is False


def test_garbage_json_body_denies_as_stale(make_client) -> None:
    # 200 with a non-JSON body parses to {}, which has no scoredAt — the
    # freshness gate fails closed (same net effect as the TS SDK).
    client, _ = make_client(lambda request: httpx.Response(200, text="<html>oops"))
    guard = client.create_spend_guard()
    decision = guard.evaluate(PAYEE, 5)
    assert decision.allow is False
    assert decision.reasons == ["payee_score_stale"]


def test_unparseable_scored_at_denies_as_stale(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(
            200, json=make_payee_score(scored_at="not-a-date")
        )
    )
    guard = client.create_spend_guard()
    assert guard.evaluate(PAYEE, 5).reasons == ["payee_score_stale"]


def test_non_numeric_score_cannot_clear_min_floor(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(
            200, json=make_payee_score(score="99999")
        )
    )
    guard = client.create_spend_guard(min_payee_score=40)
    assert "payee_score_below_min" in guard.evaluate(PAYEE, 5).reasons


# ---------------------------------------------------------------------------
# Opt-out modes: block-only / custom
# ---------------------------------------------------------------------------


def test_block_only_lets_warn_pass_but_denies_block(make_client) -> None:
    verdicts = iter(["WARN", "BLOCK"])
    client, _ = make_client(
        lambda request: httpx.Response(
            200, json=make_payee_score(recommendation=next(verdicts))
        )
    )
    guard = client.create_spend_guard(trust_policy="block-only")
    assert guard.evaluate(PAYEE, 5).allow is True  # WARN passes
    assert guard.evaluate(PAYEE, 5).reasons == ["payee_recommendation_block"]


def test_block_only_still_denies_degraded_and_failed_lookup(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(200, json=make_payee_score(degraded=True))
    )
    guard = client.create_spend_guard(trust_policy="block-only")
    assert guard.evaluate(PAYEE, 5).reasons == ["payee_score_degraded"]

    client2, _ = make_client(lambda request: httpx.Response(500, json={}))
    guard2 = client2.create_spend_guard(trust_policy="block-only")
    assert guard2.evaluate(PAYEE, 5).reasons == ["payee_trust_unavailable"]


def test_custom_with_no_trust_rules_makes_no_api_calls(make_client) -> None:
    client, recorder = make_client(
        lambda request: httpx.Response(200, json=make_payee_score())
    )
    guard = client.create_spend_guard(
        trust_policy="custom", max_per_tx_usd=10, daily_budget_usd=50
    )
    decision = guard.evaluate(PAYEE, 5)
    assert decision.allow is True
    assert decision.payee_score is None
    assert recorder.requests == []


def test_custom_with_block_on_recommendation(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(
            200, json=make_payee_score(recommendation="BLOCK")
        )
    )
    guard = client.create_spend_guard(
        trust_policy="custom", block_on_recommendation=True
    )
    assert guard.evaluate(PAYEE, 5).reasons == ["payee_recommendation_block"]


# ---------------------------------------------------------------------------
# Input and policy validation
# ---------------------------------------------------------------------------


def test_invalid_payee_and_amount_raise(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(200, json=make_payee_score())
    )
    guard = client.create_spend_guard()
    with pytest.raises(ValueError, match="invalid_payee_address"):
        guard.evaluate("bob.eth", 5)
    with pytest.raises(ValueError, match="invalid_amount_usd"):
        guard.evaluate(PAYEE, 0)
    with pytest.raises(ValueError, match="invalid_amount_usd"):
        guard.evaluate(PAYEE, float("nan"))


def test_invalid_policy_values_raise(make_client) -> None:
    client, _ = make_client(
        lambda request: httpx.Response(200, json=make_payee_score())
    )
    with pytest.raises(ValueError, match="invalid_policy_max_per_tx_usd"):
        client.create_spend_guard(max_per_tx_usd=-1)
    with pytest.raises(ValueError, match="invalid_policy_min_payee_score"):
        client.create_spend_guard(min_payee_score=101)
    with pytest.raises(ValueError, match="invalid_policy_max_score_age_ms"):
        client.create_spend_guard(max_score_age_ms=0)
    with pytest.raises(ValueError, match="invalid_policy_trust_policy"):
        client.create_spend_guard(trust_policy="yolo")  # type: ignore[arg-type]


def test_default_max_score_age_matches_api_cache_ttl() -> None:
    assert DEFAULT_MAX_SCORE_AGE_MS == 5 * 60 * 1000
