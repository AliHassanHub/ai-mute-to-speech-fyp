"""Production feature extraction for per-user word calibration references.

Uses the same ``extract_features()`` path and global model scaler as
``predict_capture()`` / ``train_word_model()``.  The stored reference is a
scaled feature centroid compatible with ``UserCalibrationContext.effective_references()``.

Note: ``FEATURE_LENGTH`` is 96 (waveform block size).  The full feature vector
dimension is 203 (96 shape + 48 env + 48 diff + 11 stats).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np

from runtime.robust_word_model import (
    MIN_USABLE_CAPTURES_FOR_EXTENSION,
    MODEL_PATH,
    capture_stats,
    extract_features,
    load_model,
    quality_reason,
)

MIN_CALIBRATION_CAPTURES = int(MIN_USABLE_CAPTURES_FOR_EXTENSION)  # 8
PREFERRED_CALIBRATION_CAPTURES = 10
MAX_CALIBRATION_CAPTURES = 16
MIN_CALIBRATION_SAMPLES = 100  # ~2 s at 50 Hz; quality_reason hard gate is 50
EXTRACTION_VERSION = "robust_word_model.extract_features.v1"


@dataclass
class CaptureValidation:
    index: int
    accepted: bool
    reason: str
    sample_count: int = 0
    emg_std: float | None = None
    pot_std: float | None = None


@dataclass
class WordReferenceResult:
    word_label: str
    emg_reference: list[float]
    feature_dimension: int
    pot_center: float
    pot_radius: float
    quality_score: float | None
    capture_count: int
    submitted_capture_count: int
    rejected_captures: list[dict[str, Any]] = field(default_factory=list)
    capture_metadata: dict[str, Any] = field(default_factory=dict)


class CalibrationRejected(ValueError):
    """Raised when calibration input cannot produce a valid reference."""

    def __init__(self, reason: str, detail: str, *, rejected: list[dict] | None = None):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail
        self.rejected = rejected or []


def rows_to_capture(rows) -> np.ndarray:
    if not rows:
        raise CalibrationRejected("empty-signal", "At least one capture is required.")
    pairs = []
    for row in rows:
        emg = float(row.emg)
        pot = float(row.pot)
        if not np.isfinite(emg) or not np.isfinite(pot):
            raise CalibrationRejected("nan-or-inf", "Capture rows must be finite numbers.")
        pairs.append((emg, pot))
    arr = np.asarray(pairs, dtype=np.float32)
    if arr.ndim != 2 or arr.shape[1] != 2:
        raise CalibrationRejected("bad-shape", f"Expected (samples, 2), got {arr.shape}.")
    return arr


def validate_capture(capture: np.ndarray, *, index: int = 0) -> CaptureValidation:
    sample_count = int(capture.shape[0])
    if sample_count < MIN_CALIBRATION_SAMPLES:
        return CaptureValidation(
            index=index,
            accepted=False,
            reason=f"too-short:{sample_count}",
            sample_count=sample_count,
        )

    reason = quality_reason(capture)
    stats = capture_stats(capture) if reason == "ok" else {}
    return CaptureValidation(
        index=index,
        accepted=reason == "ok",
        reason=reason,
        sample_count=sample_count,
        emg_std=stats.get("emg_std"),
        pot_std=stats.get("pot_std"),
    )


def _pot_profile(pot_means: list[float]) -> tuple[float, float]:
    pots = np.asarray(pot_means, dtype=np.float32)
    center = float(np.median(pots))
    radius = float(max(1.0, np.percentile(np.abs(pots - center), 90) + 1.0))
    return center, radius


def _consistency_score(scaled_features: np.ndarray) -> float:
    if scaled_features.shape[0] < 2:
        return 1.0
    centroid = np.mean(scaled_features, axis=0)
    distances = np.sqrt(np.mean(np.square(scaled_features - centroid), axis=1))
    spread = float(np.median(distances))
    # Lower spread → higher score. Typical in-class distances are < 1.5 scaled units.
    return float(np.clip(1.0 - spread / 2.5, 0.0, 1.0))


def _quality_score(
    usable_count: int,
    submitted_count: int,
    consistency: float,
    pot_stds: list[float],
) -> float:
    completeness = usable_count / max(submitted_count, 1)
    pot_stability = 1.0
    if pot_stds:
        mean_pot_std = float(np.mean(pot_stds))
        pot_stability = float(np.clip(1.0 - max(0.0, mean_pot_std - 0.5) / 3.0, 0.0, 1.0))
    raw = 0.45 * completeness + 0.35 * consistency + 0.20 * pot_stability
    return round(float(np.clip(raw, 0.0, 1.0) * 100.0), 2)


def build_word_calibration_reference(
    word_label: str,
    captures: list[np.ndarray],
    *,
    model_path=None,
) -> WordReferenceResult:
    if not word_label or not str(word_label).strip():
        raise CalibrationRejected("missing-word", "word label is required.")

    if not captures:
        raise CalibrationRejected("empty-captures", "At least one capture is required.")

    if len(captures) > MAX_CALIBRATION_CAPTURES:
        raise CalibrationRejected(
            "too-many-captures",
            f"At most {MAX_CALIBRATION_CAPTURES} captures are accepted per request.",
        )

    validations = [validate_capture(cap, index=i) for i, cap in enumerate(captures)]
    rejected = [
        {
            "index": item.index,
            "reason": item.reason,
            "sampleCount": item.sample_count,
        }
        for item in validations
        if not item.accepted
    ]

    usable_captures = [
        captures[i] for i, item in enumerate(validations) if item.accepted
    ]
    if len(usable_captures) < MIN_CALIBRATION_CAPTURES:
        raise CalibrationRejected(
            "insufficient-usable-captures",
            f"Need at least {MIN_CALIBRATION_CAPTURES} usable captures; "
            f"received {len(usable_captures)} of {len(captures)}.",
            rejected=rejected,
        )

    model = load_model(model_path or MODEL_PATH)
    center = np.asarray(model["center"], dtype=np.float32)
    scale = np.asarray(model["scale"], dtype=np.float32)

    scaled_features = []
    pot_means = []
    pot_stds = []
    emg_stds = []
    sample_counts = []

    for capture in usable_captures:
        stats = capture_stats(capture)
        pot_means.append(stats["pot_mean"])
        pot_stds.append(stats["pot_std"])
        emg_stds.append(stats["emg_std"])
        sample_counts.append(stats["samples"])
        raw = extract_features(capture)
        scaled_features.append(((raw - center) / scale).astype(np.float32))

    stacked = np.vstack(scaled_features)
    centroid = np.median(stacked, axis=0).astype(np.float32)
    if not np.isfinite(centroid).all():
        raise CalibrationRejected(
            "invalid-reference",
            "Feature centroid contains non-finite values.",
            rejected=rejected,
        )

    pot_center, pot_radius = _pot_profile(pot_means)
    consistency = _consistency_score(stacked)
    quality = _quality_score(len(usable_captures), len(captures), consistency, pot_stds)

    total_samples = int(sum(sample_counts))
    duration_sec = round(total_samples / 50.0, 2)

    metadata = {
        "extractionVersion": EXTRACTION_VERSION,
        "featureDimension": int(centroid.size),
        "waveformBlockLength": 96,
        "submittedCaptureCount": len(captures),
        "usableCaptureCount": len(usable_captures),
        "rejectedCaptureCount": len(rejected),
        "totalSampleCount": total_samples,
        "durationSec": duration_sec,
        "emgStdMean": round(float(np.mean(emg_stds)), 4),
        "emgStdStd": round(float(np.std(emg_stds)), 4),
        "potMeanMedian": round(pot_center, 4),
        "potStdMean": round(float(np.mean(pot_stds)), 4),
        "consistencyScore": round(consistency, 4),
    }

    return WordReferenceResult(
        word_label=str(word_label).strip().lower(),
        emg_reference=[float(v) for v in centroid.tolist()],
        feature_dimension=int(centroid.size),
        pot_center=pot_center,
        pot_radius=pot_radius,
        quality_score=quality,
        capture_count=len(usable_captures),
        submitted_capture_count=len(captures),
        rejected_captures=rejected,
        capture_metadata=metadata,
    )
