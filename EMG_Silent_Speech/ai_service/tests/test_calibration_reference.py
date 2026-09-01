"""Tests for production calibration reference extraction."""

from __future__ import annotations

import numpy as np
import pytest

from runtime.calibration_reference import (
    MIN_CALIBRATION_CAPTURES,
    CalibrationRejected,
    build_word_calibration_reference,
    validate_capture,
)
from runtime.robust_word_model import extract_features, load_model
from runtime.signal_io import read_capture
from conftest import usable_capture_paths, rows_from_array


@pytest.fixture(scope="module")
def model():
    return load_model()


def _load_usable_captures(label: str, count: int = MIN_CALIBRATION_CAPTURES):
    paths = usable_capture_paths(label)[:count]
    if len(paths) < count:
        pytest.skip(f"need at least {count} usable captures for {label}")
    return [read_capture(path) for path in paths]


def test_feature_dimension_is_production_size(model):
    captures = _load_usable_captures("pain", MIN_CALIBRATION_CAPTURES)
    result = build_word_calibration_reference("pain", captures)
    assert result.feature_dimension == int(model["references"].shape[1])
    assert len(result.emg_reference) == result.feature_dimension


def test_scaled_reference_matches_model_scaler(model):
    captures = _load_usable_captures("help", MIN_CALIBRATION_CAPTURES)
    result = build_word_calibration_reference("help", captures)
    center = np.asarray(model["center"], dtype=np.float32)
    scale = np.asarray(model["scale"], dtype=np.float32)
    raw = extract_features(captures[0])
    scaled_one = (raw - center) / scale
    assert scaled_one.shape[0] == result.feature_dimension


def test_rejects_insufficient_usable_captures():
    captures = _load_usable_captures("pain", 2)
    with pytest.raises(CalibrationRejected) as exc:
        build_word_calibration_reference("pain", captures)
    assert exc.value.reason == "insufficient-usable-captures"


def test_rejects_flat_capture():
    flat = np.zeros((200, 2), dtype=np.float32)
    flat[:, 1] = 10.0
    with pytest.raises(CalibrationRejected):
        build_word_calibration_reference("pain", [flat] * MIN_CALIBRATION_CAPTURES)


def test_pot_center_uses_training_formula():
    captures = _load_usable_captures("stop", MIN_CALIBRATION_CAPTURES)
    result = build_word_calibration_reference("stop", captures)
    assert result.pot_center > 0
    assert result.pot_radius >= 1.0


def test_quality_score_is_measurable():
    captures = _load_usable_captures("no", MIN_CALIBRATION_CAPTURES)
    result = build_word_calibration_reference("no", captures)
    assert result.quality_score is not None
    assert 0.0 <= result.quality_score <= 100.0


def test_api_word_reference_endpoint(client):
    captures = _load_usable_captures("pain", MIN_CALIBRATION_CAPTURES)
    payload = {
        "word": "pain",
        "captures": [
            {"signal": {"format": "samples", "rows": rows_from_array(cap)}}
            for cap in captures
        ],
    }
    response = client.post("/calibration/word-reference", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["word"] == "pain"
    assert body["featureDimension"] == len(body["emgReference"])
    assert body["captureCount"] >= MIN_CALIBRATION_CAPTURES
    assert body["modelSha256"]


def test_personalized_reference_appends_in_effective_references(model):
    from runtime.user_calibration import UserCalibrationContext, UserWordCalibration

    captures = _load_usable_captures("pain", MIN_CALIBRATION_CAPTURES)
    built = build_word_calibration_reference("pain", captures)
    ctx = UserCalibrationContext(
        profile_version=1,
        model_sha256=None,
        profile_compatible=True,
        words={
            "pain": UserWordCalibration(
                word_label="pain",
                state="calibrated",
                pot_center=built.pot_center,
                pot_radius=built.pot_radius,
                emg_reference=np.asarray(built.emg_reference, dtype=np.float32),
            )
        },
    )
    refs, labels = ctx.effective_references(model)
    assert refs.shape[0] == model["references"].shape[0] + 1


def test_null_emg_reference_keeps_global_only(model):
    from runtime.user_calibration import UserCalibrationContext, UserWordCalibration

    ctx = UserCalibrationContext(
        profile_version=1,
        model_sha256=None,
        profile_compatible=True,
        words={
            "pain": UserWordCalibration(
                word_label="pain",
                state="calibrated",
                pot_center=10.0,
                pot_radius=2.0,
                emg_reference=None,
            )
        },
    )
    refs, labels = ctx.effective_references(model)
    assert refs.shape == model["references"].shape


def test_validate_capture_rejects_short_window():
    short = np.ones((80, 2), dtype=np.float32)
    result = validate_capture(short, index=0)
    assert result.accepted is False
    assert result.reason.startswith("too-short")
