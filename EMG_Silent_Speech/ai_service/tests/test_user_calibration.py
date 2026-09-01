"""Unit tests for per-user calibration personalization overlay."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest

from runtime.robust_word_model import load_model, predict_capture
from runtime.user_calibration import (
    UserCalibrationContext,
    UserWordCalibration,
    parse_user_calibration_payload,
)


@pytest.fixture(scope="module")
def model():
    return load_model()


def test_no_user_calibration_matches_global_path(first_usable_capture):
    capture = first_usable_capture
    global_result = predict_capture(capture, user_calibration=None)
    unchanged = predict_capture(capture, user_calibration=None)
    assert unchanged.label == global_result.label
    assert unchanged.accepted == global_result.accepted


def test_effective_pot_override_changes_gate(model):
    label_names = list(model["label_names"])
    pain_index = label_names.index("pain")
    global_pain_center = float(model["pot_centers"][pain_index])

    user_ctx = UserCalibrationContext(
        profile_version=2,
        model_sha256=None,
        profile_compatible=True,
        words={
            "pain": UserWordCalibration(
                word_label="pain",
                state="calibrated",
                pot_center=global_pain_center + 20.0,
                pot_radius=2.0,
            )
        },
    )

    pot_centers, pot_radii = user_ctx.effective_pot_arrays(model)
    assert float(pot_centers[pain_index]) == pytest.approx(global_pain_center + 20.0)
    assert float(pot_radii[pain_index]) >= 2.0


def test_null_emg_reference_keeps_global_reference_count(model):
    user_ctx = UserCalibrationContext(
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
    refs, labels = user_ctx.effective_references(model)
    assert refs.shape == model["references"].shape
    assert labels.shape == model["reference_labels"].shape


def test_profile_incompatible_skips_overlay():
    ctx = parse_user_calibration_payload(
        {
            "profileVersion": 3,
            "profileCompatible": False,
            "words": {
                "pain": {
                    "state": "calibrated",
                    "potCenter": 99.0,
                    "potRadius": 1.0,
                }
            },
        }
    )
    assert ctx is not None
    assert ctx.is_applicable() is False
    meta = ctx.personalization_meta()
    assert meta["profileFallbackRequired"] is True


def test_partial_profile_only_lists_calibrated_words():
    ctx = parse_user_calibration_payload(
        {
            "profileVersion": 2,
            "profileCompatible": True,
            "words": {
                "pain": {"state": "calibrated", "potCenter": 10.0, "potRadius": 2.0},
                "help": {"state": "calibrated", "potCenter": 20.0, "potRadius": 2.0},
                "medical": {"state": "pending"},
            },
        }
    )
    assert ctx is not None
    meta = ctx.personalization_meta()
    assert meta["calibratedWords"] == ["help", "pain"]
    assert "medical" not in meta["calibratedWords"]


def test_user_emg_reference_appends_without_replacing_global(model):
    feature_dim = int(model["references"].shape[1])
    user_vec = np.ones(feature_dim, dtype=np.float32) * 0.01
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
                emg_reference=user_vec,
            )
        },
    )
    refs, labels = ctx.effective_references(model)
    assert refs.shape[0] == model["references"].shape[0] + 1
    assert int(labels[-1]) == list(model["label_names"]).index("pain")


def test_concurrent_users_do_not_share_state(first_usable_capture):
    capture = first_usable_capture
    ctx_a = UserCalibrationContext(
        profile_version=1,
        model_sha256=None,
        profile_compatible=True,
        words={
            "pain": UserWordCalibration(
                word_label="pain",
                state="calibrated",
                pot_center=10.0,
                pot_radius=2.0,
            )
        },
    )
    ctx_b = UserCalibrationContext(
        profile_version=1,
        model_sha256=None,
        profile_compatible=True,
        words={
            "pain": UserWordCalibration(
                word_label="pain",
                state="calibrated",
                pot_center=12.0,
                pot_radius=2.0,
            )
        },
    )

    results = []

    def run(ctx):
        model = load_model()
        centers, _ = ctx.effective_pot_arrays(model)
        pain_idx = list(model["label_names"]).index("pain")
        results.append(float(centers[pain_idx]))

    with ThreadPoolExecutor(max_workers=2) as pool:
        pool.map(run, [ctx_a, ctx_b])

    assert sorted(results) == [10.0, 12.0]


def test_predict_api_backward_compatible_without_user_calibration(client, first_usable_capture):
    from conftest import rows_from_array

    rows = rows_from_array(first_usable_capture)
    r = client.post(
        "/predict",
        json={"kind": "word", "signal": {"format": "samples", "rows": rows}},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["personalization"]["applied"] is False


def test_predict_api_accepts_user_calibration(client, first_usable_capture):
    from conftest import rows_from_array

    rows = rows_from_array(first_usable_capture)
    r = client.post(
        "/predict",
        json={
            "kind": "word",
            "signal": {"format": "samples", "rows": rows},
            "userCalibration": {
                "profileVersion": 2,
                "profileCompatible": True,
                "words": {
                    "pain": {
                        "state": "calibrated",
                        "potCenter": 10.0,
                        "potRadius": 2.0,
                    }
                },
            },
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["personalization"]["applied"] is True
    assert "pain" in body["personalization"]["potPersonalizedWords"]
