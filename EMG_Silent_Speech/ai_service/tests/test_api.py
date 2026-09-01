"""API tests. Every signal is real captured EMG/POT data."""

from __future__ import annotations

import numpy as np
import pytest

from ai_service.app import config
from conftest import (
    REAL_LABELS,
    rejected_capture_paths,
    rows_from_array,
    usable_capture_paths,
)
from runtime.signal_io import read_capture


# ---------------------------------------------------------------------------
# 1. /health
# ---------------------------------------------------------------------------
REQUIRED_ACTIVE_LABELS = (
    "help",
    "no",
    "pain",
    "stop",
    "Assistance",
    "Medical",
    "Pick",
    "Land",
    "Up",
)


def test_health_reports_loaded_model(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()

    assert body["status"] == "ok"
    assert body["model"] == "calibrated_word_model"
    assert body["word_model_loaded"] is True
    assert body["labels"] == list(REQUIRED_ACTIVE_LABELS)
    assert len(body["labels"]) == 9
    assert body["version"]

    # Version is the service's own; model identity is a real hash of the file.
    assert len(body["model_sha256"]) == 64
    assert body["model_size_bytes"] > 0
    assert body["model_path"].endswith(config.ACTIVE_MODEL_PATH.name)

    assert body["sentence_model_supported"] is False
    assert body["hard_min_samples"] == 50
    assert body["max_predict_samples"] == 1800
    assert body["min_predict_samples"] == config.MIN_PREDICT_SAMPLES
    # Threshold comes from the artefact, not from this service.
    assert body["default_min_confidence"] == pytest.approx(0.50)


def test_health_sha256_matches_file_on_disk(client):
    import hashlib

    body = client.get("/health").json()
    digest = hashlib.sha256(config.ACTIVE_MODEL_PATH.read_bytes()).hexdigest()
    assert body["model_sha256"] == digest


# ---------------------------------------------------------------------------
# 2. Valid word signal
# ---------------------------------------------------------------------------
@pytest.mark.parametrize("label", REAL_LABELS)
def test_valid_word_signal_predicts_correct_label(client, label):
    path = usable_capture_paths(label)[0]
    arr = read_capture(path)

    r = client.post(
        "/predict",
        json={"kind": "word", "signal": {"format": "samples", "rows": rows_from_array(arr)}},
    )
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["kind"] == "word"
    assert body["label"] == label
    assert body["bestLabel"] == label
    assert body["accepted"] is True
    assert 0.0 < body["confidence"] <= 0.98
    assert body["distance"] is not None and body["distance"] >= 0.0
    assert body["margin"] is not None
    assert body["processingTimeMs"] > 0
    assert body["sampleCount"] == arr.shape[0]
    assert body["quality"] == "ok"
    assert body["sessionAdaptation"] == "none"


def test_response_never_emits_non_finite_json(client):
    """distance is inf for rejected captures; JSON must carry null, not Infinity."""
    path = rejected_capture_paths()[0]
    arr = read_capture(path)
    r = client.post(
        "/predict",
        json={"kind": "word", "signal": {"format": "samples", "rows": rows_from_array(arr)}},
    )
    # Over the stale-buffer limit, so the API refuses before the predictor.
    assert r.status_code == 422
    assert "Infinity" not in r.text and "NaN" not in r.text


# ---------------------------------------------------------------------------
# 3. Insufficient signal
# ---------------------------------------------------------------------------
def test_insufficient_samples_rejected(client, first_usable_capture):
    arr = first_usable_capture[: config.MIN_PREDICT_SAMPLES - 1]
    r = client.post(
        "/predict",
        json={"kind": "word", "signal": {"format": "samples", "rows": rows_from_array(arr)}},
    )
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "insufficient-samples"
    assert str(config.MIN_PREDICT_SAMPLES) in body["detail"]


def test_single_ble_packet_rejected(client, first_usable_capture):
    """One BLE packet must never produce a prediction."""
    r = client.post(
        "/predict",
        json={
            "kind": "word",
            "signal": {"format": "samples", "rows": rows_from_array(first_usable_capture[:1])},
        },
    )
    assert r.status_code == 422
    assert r.json()["error"] == "insufficient-samples"


def test_empty_signal_rejected(client):
    r = client.post(
        "/predict", json={"kind": "word", "signal": {"format": "samples", "rows": []}}
    )
    assert r.status_code == 422
    assert r.json()["error"] == "malformed-request"


def test_over_max_samples_rejected(client):
    path = rejected_capture_paths()[0]
    arr = read_capture(path)
    assert arr.shape[0] > 1800
    r = client.post(
        "/predict",
        json={"kind": "word", "signal": {"format": "samples", "rows": rows_from_array(arr)}},
    )
    assert r.status_code == 422
    assert r.json()["error"] == "too-many-samples"


# ---------------------------------------------------------------------------
# 4. Malformed signal
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "payload,note",
    [
        ({"kind": "word"}, "missing signal"),
        ({"signal": {"format": "samples", "rows": [{"emg": 1, "pot": 1}]}}, "missing kind"),
        ({"kind": "shout", "signal": {"format": "samples", "rows": []}}, "bad kind"),
        ({"kind": "word", "signal": {"format": "csv", "rows": []}}, "bad format"),
        ({"kind": "word", "signal": {"rows": [{"emg": 1, "pot": 1}]}}, "missing format"),
    ],
)
def test_malformed_requests_rejected(client, payload, note):
    r = client.post("/predict", json=payload)
    assert r.status_code == 422, f"{note}: {r.text}"
    assert r.json()["error"] == "malformed-request"


@pytest.mark.parametrize("bad", ["nan", "inf", "-inf"])
def test_non_finite_values_rejected(client, first_usable_capture, bad):
    rows = rows_from_array(first_usable_capture)
    rows[10]["emg"] = bad  # JSON has no NaN literal; a string must not coerce
    r = client.post(
        "/predict", json={"kind": "word", "signal": {"format": "samples", "rows": rows}}
    )
    assert r.status_code == 422
    assert r.json()["error"] == "malformed-request"


def test_out_of_hardware_range_rejected(client, first_usable_capture):
    rows = rows_from_array(first_usable_capture)
    rows[5]["emg"] = 999999.0
    r = client.post(
        "/predict", json={"kind": "word", "signal": {"format": "samples", "rows": rows}}
    )
    assert r.status_code == 422


def test_missing_pot_field_rejected(client, first_usable_capture):
    """POT is load-bearing: it gates the label. It cannot be optional."""
    rows = [{"emg": float(e)} for e, _p in first_usable_capture]
    r = client.post(
        "/predict", json={"kind": "word", "signal": {"format": "samples", "rows": rows}}
    )
    assert r.status_code == 422
    assert "pot" in r.json()["detail"].lower()


def test_extra_fields_rejected(client, first_usable_capture):
    rows = rows_from_array(first_usable_capture)
    rows[0]["channel3"] = 7.0
    r = client.post(
        "/predict", json={"kind": "word", "signal": {"format": "samples", "rows": rows}}
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# 5. Unknown / low-quality signal
# ---------------------------------------------------------------------------
def test_flat_emg_returns_unknown_not_closest_label(client):
    """A flat (electrodes-off) signal must be unknown, never forced to a label."""
    n = config.MIN_PREDICT_SAMPLES
    rows = [{"emg": 600.0, "pot": 39.0} for _ in range(n)]
    r = client.post(
        "/predict", json={"kind": "word", "signal": {"format": "samples", "rows": rows}}
    )
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["label"] == "unknown"
    assert body["accepted"] is False
    assert body["quality"].startswith("flat-emg")
    assert body["bestLabel"].startswith("low-quality-signal")
    assert body["confidence"] == 0.0
    # inf must be serialised as null
    assert body["distance"] is None


def test_unstable_pot_returns_unknown(client, first_usable_capture):
    """POT jitter above the gate means the knob was moving: reject, do not guess."""
    arr = first_usable_capture.copy()
    rng = np.random.default_rng(7)
    arr[:, 1] = 39.0 + rng.normal(0.0, 12.0, size=arr.shape[0]).astype(np.float32)
    arr[:, 1] = np.clip(arr[:, 1], 0.0, 100.0)

    r = client.post(
        "/predict",
        json={"kind": "word", "signal": {"format": "samples", "rows": rows_from_array(arr)}},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["label"] == "unknown"
    assert body["accepted"] is False
    assert body["quality"].startswith("unstable-pot")


def test_high_min_confidence_forces_unknown(client):
    """Raising the threshold must reject rather than relabel."""
    path = usable_capture_paths("help")[0]
    arr = read_capture(path)
    body = client.post(
        "/predict",
        json={
            "kind": "word",
            "signal": {"format": "samples", "rows": rows_from_array(arr)},
            "minConfidence": 0.999,
        },
    ).json()

    assert body["accepted"] is False
    assert body["label"] == "unknown"
    # The closest label is still reported, but not adopted.
    assert body["bestLabel"] == "help"
    assert body["requiredConfidence"] == pytest.approx(0.999)


# ---------------------------------------------------------------------------
# 6. Sentence request rejection
# ---------------------------------------------------------------------------
def test_sentence_request_returns_501(client, first_usable_capture):
    r = client.post(
        "/predict",
        json={
            "kind": "sentence",
            "signal": {"format": "samples", "rows": rows_from_array(first_usable_capture)},
        },
    )
    assert r.status_code == 501
    body = r.json()
    assert body["supported"] is False
    assert body["accepted"] is False
    assert body["label"] == "unknown"
    # Value produced by runtime/predict.py itself, not invented here.
    assert body["bestLabel"] == "sentence-model-disabled"
    assert "snn_sentence_encoder.pt" in body["reason"]


def test_sentence_encoder_file_exists_but_is_not_loaded(client):
    """Guard against the .pt being wired in just because it is present."""
    import sys

    pt = config.PROJECT_DIR / "training" / "models" / "snn_sentence_encoder.pt"
    assert pt.is_file(), "expected the unused sentence encoder to be present"
    assert client.get("/health").json()["sentence_model_supported"] is False
    # The service must not have pulled torch in on its own account.
    assert "ai_service.app.torch" not in sys.modules


# ---------------------------------------------------------------------------
# 7. Model missing
# ---------------------------------------------------------------------------
def test_missing_model_fails_clearly(tmp_path):
    from ai_service.app import service

    missing = tmp_path / "does_not_exist.npz"
    with pytest.raises(service.ModelUnavailable) as exc:
        service.load_model_state(missing)

    message = str(exc.value)
    assert "not found" in message
    assert "calibrated_word_model.npz" in message
    assert "python ai.py train" in message


def test_unreadable_model_fails_clearly(tmp_path):
    from ai_service.app import service

    junk = tmp_path / "calibrated_word_model.npz"
    junk.write_bytes(b"this is not an npz archive")
    with pytest.raises(service.ModelUnavailable) as exc:
        service.load_model_state(junk)
    assert "failed to load" in str(exc.value)


def test_health_reports_503_when_model_missing(monkeypatch, tmp_path):
    """A service started without the artefact must say so, not pretend to work."""
    from fastapi.testclient import TestClient

    from ai_service.app import main, service

    monkeypatch.setattr(service, "ACTIVE_MODEL_PATH", tmp_path / "missing.npz")
    with TestClient(main.app) as c:
        r = c.get("/health")
        assert r.status_code == 503
        body = r.json()
        assert body["word_model_loaded"] is False
        assert body["error"] == "model-unavailable"

        # And prediction must refuse too.
        p = c.post(
            "/predict",
            json={
                "kind": "word",
                "signal": {"format": "samples", "rows": [{"emg": 600.0, "pot": 39.0}] * 800},
            },
        )
        assert p.status_code == 503
        assert p.json()["error"] == "model-unavailable"


# ---------------------------------------------------------------------------
# 8. Real predictor response structure
# ---------------------------------------------------------------------------
def test_response_structure_and_semantics(client, first_usable_capture):
    body = client.post(
        "/predict",
        json={
            "kind": "word",
            "signal": {"format": "samples", "rows": rows_from_array(first_usable_capture)},
        },
    ).json()

    required = {
        "kind", "label", "bestLabel", "confidence", "accepted",
        "distance", "margin", "processingTimeMs",
    }
    assert required <= set(body)

    assert isinstance(body["label"], str)
    assert isinstance(body["accepted"], bool)
    assert isinstance(body["confidence"], float)

    # The predictor's confidence is a weighted heuristic capped at 0.98, not a
    # probability and not cosine similarity. The contract must say so.
    assert "not a probability" in body["confidenceBasis"]
    assert "cosine" in body["confidenceBasis"]
    assert body["confidence"] <= 0.98

    # margin is in potentiometer counts for this model, not feature distance.
    assert "potentiometer" in body["marginUnit"]


def test_confidence_cap_is_the_predictor_ceiling(client):
    """0.98 is the hard cap in robust_word_model.predict_capture."""
    seen = []
    for label in REAL_LABELS:
        for path in usable_capture_paths(label):
            body = client.post(
                "/predict",
                json={
                    "kind": "word",
                    "signal": {
                        "format": "samples",
                        "rows": rows_from_array(read_capture(path)),
                    },
                },
            ).json()
            seen.append(body["confidence"])
    assert max(seen) == pytest.approx(0.98)
    assert min(seen) > 0.0


def test_margin_equals_pot_gap_for_this_model(client):
    """Documents, and pins, the POT-units meaning of margin."""
    from runtime.robust_word_model import load_model

    model = load_model(config.ACTIVE_MODEL_PATH)
    centers = np.asarray(model["pot_centers"], dtype=np.float32)

    for label in REAL_LABELS:
        arr = read_capture(usable_capture_paths(label)[0])
        body = client.post(
            "/predict",
            json={"kind": "word", "signal": {"format": "samples", "rows": rows_from_array(arr)}},
        ).json()

        pot_mean = float(np.mean(arr[:, 1]))
        dists = np.sort(np.abs(centers - pot_mean))
        expected_gap = float(dists[1] - dists[0])
        assert body["margin"] == pytest.approx(expected_gap, abs=1e-4)
