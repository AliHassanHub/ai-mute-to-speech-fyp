"""Tests for incremental calibrated vocabulary extension."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import numpy as np
import pytest

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from runtime.robust_word_model import (  # noqa: E402
    MODEL_PATH,
    MODEL_PATH_V2,
    audit_calibration_candidates,
    extend_word_model,
    load_model,
    train_word_model,
    verify_label_regression,
)
from training.vocabulary import (  # noqa: E402
    CANDIDATE_EXTENSION_LABELS,
    ORIGINAL_SNN_WORD_LABELS,
    VERIFIED_CALIBRATED_LABELS_V1,
)


@pytest.fixture(scope="module")
def trained_model(tmp_path_factory):
    out = tmp_path_factory.mktemp("models") / "base.npz"
    if MODEL_PATH.is_file():
        shutil.copy2(MODEL_PATH, out)
    else:
        train_word_model(model_path=out)
    return out


def test_original_snn_labels_are_documented_separately():
    assert "Assistance" in ORIGINAL_SNN_WORD_LABELS
    assert "help" not in ORIGINAL_SNN_WORD_LABELS


def test_audit_reports_missing_calibration_data(trained_model):
    report = audit_calibration_candidates(
        active_labels=load_model(trained_model)["label_names"],
        candidate_labels=list(CANDIDATE_EXTENSION_LABELS) + list(VERIFIED_CALIBRATED_LABELS_V1),
    )
    by_label = {item["label"]: item for item in report}
    assert by_label["Assistance"]["status"] == "CALIBRATION_DATA_MISSING"
    assert by_label["help"]["status"] == "ALREADY_ACTIVE"


def test_snapshot_preserves_existing_labels(trained_model, tmp_path):
    out = tmp_path / "v2.npz"
    summary = extend_word_model(
        base_model_path=trained_model,
        output_path=out,
        target_labels=[],
    )
    base = load_model(trained_model)
    extended = load_model(out)
    assert extended["label_names"] == base["label_names"]
    assert np.allclose(extended["references"], base["references"])
    assert np.allclose(extended["pot_centers"], base["pot_centers"])
    assert summary["extension"]["added_labels"] == []


def test_regression_unchanged_after_snapshot(trained_model, tmp_path):
    out = tmp_path / "v2.npz"
    extend_word_model(base_model_path=trained_model, output_path=out, target_labels=[])
    before = verify_label_regression(trained_model)
    after = verify_label_regression(out)
    assert before["failures"] == []
    assert after["failures"] == []
    assert after["checked"] == before["checked"]


def test_extend_refuses_missing_label(trained_model, tmp_path):
    out = tmp_path / "v2.npz"
    with pytest.raises(ValueError, match="Calibration data missing for: Assistance"):
        extend_word_model(
            base_model_path=trained_model,
            output_path=out,
            target_labels=["Assistance"],
        )


def test_production_v2_snapshot_if_base_exists():
    if not MODEL_PATH.is_file():
        pytest.skip("production model not trained in this workspace")
    out = MODEL_PATH_V2
    summary = extend_word_model(
        base_model_path=MODEL_PATH,
        output_path=out,
        target_labels=[],
    )
    model = load_model(out)
    assert model["label_names"] == ["help", "no", "pain", "stop"]
    assert summary["pot_centers"] == pytest.approx([39.0, 27.0, 6.0, 15.0], rel=0, abs=0.1)
    payload = json.loads(model["summary_json"])
    assert payload["extension"]["mode"] == "append"
