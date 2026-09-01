"""Real smoke test: the API must agree with the direct predictor.

Compares label and acceptance across every usable capture in captures/help,
captures/no, captures/pain and captures/stop. Confidence is compared loosely
because float ordering can differ between call paths.
"""

from __future__ import annotations

import pytest

from ai_service.app import config, service
from conftest import REAL_LABELS, rows_from_array, usable_capture_paths
from runtime.robust_word_model import predict_file
from runtime.signal_io import read_capture


def _api_predict(client, arr, **extra):
    payload = {
        "kind": "word",
        "signal": {"format": "samples", "rows": rows_from_array(arr)},
    }
    payload.update(extra)
    r = client.post("/predict", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


@pytest.mark.parametrize("label", REAL_LABELS)
def test_api_matches_direct_predictor_per_label(client, label):
    paths = usable_capture_paths(label)
    assert paths, f"no usable captures for {label}"

    for path in paths:
        direct = predict_file(path)
        api = _api_predict(client, read_capture(path))

        assert api["label"] == direct.label, f"{path.name}: label mismatch"
        assert api["accepted"] is bool(direct.accepted), f"{path.name}: acceptance mismatch"
        assert api["bestLabel"] == direct.best_label, f"{path.name}: bestLabel mismatch"
        assert api["confidence"] == pytest.approx(float(direct.confidence), abs=1e-6)


def test_all_usable_captures_classify_correctly(client):
    """Mirrors verify_pipeline.verify_usable_captures, through HTTP."""
    failures = []
    total = 0
    for label in REAL_LABELS:
        for path in usable_capture_paths(label):
            total += 1
            api = _api_predict(client, read_capture(path))
            if api["label"] != label:
                failures.append(f"{path.name}: expected {label}, got {api['label']}")

    assert not failures, "; ".join(failures[:5])
    assert total == 41, f"expected 41 usable captures, found {total}"


def test_every_label_is_reachable_through_the_api(client):
    """Guards against a POT gate collapse that would strand a label."""
    produced = set()
    for label in REAL_LABELS:
        for path in usable_capture_paths(label):
            produced.add(_api_predict(client, read_capture(path))["label"])
    assert produced == set(REAL_LABELS)


# ---------------------------------------------------------------------------
# Session adaptation
# ---------------------------------------------------------------------------
def test_session_requires_enough_neutral_baseline(client, first_usable_capture):
    short = first_usable_capture[: config.MIN_SESSION_BASELINE_SAMPLES - 1]
    r = client.post(
        "/session", json={"signal": {"format": "samples", "rows": rows_from_array(short)}}
    )
    assert r.status_code == 422
    assert r.json()["error"] == "insufficient-baseline"


def test_session_profile_created_from_real_capture(client, first_usable_capture):
    r = client.post(
        "/session",
        json={"signal": {"format": "samples", "rows": rows_from_array(first_usable_capture)}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["sessionId"]
    assert body["baselineSamples"] == first_usable_capture.shape[0]
    assert body["noiseFloor"] >= 1.0
    assert body["activeScale"] >= body["noiseFloor"]
    assert body["peakScale"] >= body["activeScale"]


def test_unknown_session_id_rejected(client, first_usable_capture):
    r = client.post(
        "/predict",
        json={
            "kind": "word",
            "signal": {"format": "samples", "rows": rows_from_array(first_usable_capture)},
            "sessionId": "0" * 32,
        },
    )
    assert r.status_code == 422
    assert r.json()["error"] == "unknown-session"


def test_session_adaptation_reported_and_applied(client):
    """A session must be reported as applied, and must change nothing structurally."""
    arr = read_capture(usable_capture_paths("help")[0])
    rows = rows_from_array(arr)

    session_id = client.post(
        "/session", json={"signal": {"format": "samples", "rows": rows}}
    ).json()["sessionId"]

    without = _api_predict(client, arr)
    with_session = _api_predict(client, arr, sessionId=session_id)

    assert without["sessionAdaptation"] == "none"
    assert with_session["sessionAdaptation"] == "applied"
    # Both must still be real predictions, not errors.
    assert without["label"] == "help"
    assert with_session["label"] in set(REAL_LABELS) | {"unknown"}


def test_session_adaptation_recovers_an_electrode_shift(client):
    """Mirrors verify_pipeline.verify_electrode_shift_tolerance, through HTTP.

    A gain/offset shift is what electrode movement looks like. Without a session
    profile the shifted signal is expected to degrade; with a profile built from
    a matching neutral baseline the correct label must come back.
    """
    import numpy as np

    from runtime.verify_pipeline import build_shifted_neutral, shifted_capture

    arr = read_capture(usable_capture_paths("help")[0])
    offset, gain = 220.0, 0.85

    shifted = shifted_capture(arr, offset, gain)
    neutral_emg = build_shifted_neutral(arr, offset, gain)
    # POT is unaffected by electrode movement; hold it at the capture's value.
    pot = float(np.median(arr[:, 1]))
    neutral = np.stack([neutral_emg, np.full_like(neutral_emg, pot)], axis=1)

    session_id = client.post(
        "/session",
        json={"signal": {"format": "samples", "rows": rows_from_array(neutral)}},
    ).json()["sessionId"]

    adapted = _api_predict(client, shifted, sessionId=session_id)
    assert adapted["label"] == "help", f"session adaptation failed to recover: {adapted}"
    assert adapted["accepted"] is True


# ---------------------------------------------------------------------------
# Model cache equivalence
# ---------------------------------------------------------------------------
def test_model_cache_does_not_change_any_result(client):
    """Prove the load_model memoisation is behaviour-neutral on real data."""
    cached = {}
    for label in REAL_LABELS:
        for path in usable_capture_paths(label):
            cached[path.name] = _api_predict(client, read_capture(path))

    service.uninstall_model_cache()
    try:
        for label in REAL_LABELS:
            for path in usable_capture_paths(label):
                fresh = _api_predict(client, read_capture(path))
                ref = cached[path.name]
                assert fresh["label"] == ref["label"]
                assert fresh["accepted"] == ref["accepted"]
                assert fresh["confidence"] == pytest.approx(ref["confidence"], abs=1e-9)
                assert fresh["distance"] == pytest.approx(ref["distance"], abs=1e-9)
    finally:
        service.install_model_cache()
