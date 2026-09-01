"""Request and response models for the calibrated-word inference API.

Field names follow the agreed wire contract: snake_case on /health, camelCase on
/predict.
"""

from __future__ import annotations

import math
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# EMG is a 12-bit ADC reading; POT is the mapped knob position. Ranges come from
# runtime/signal_io.py (EMG_MAX = 4095.0, POT_MAX = 100.0) and the ESP32 sketch's
# documented "EMG:<0-4095>  POT:<0-100>" format. Values outside these ranges are
# not physically producible by the capture hardware.
EMG_MIN, EMG_MAX = -4095.0, 4095.0
POT_MIN, POT_MAX = 0.0, 4095.0  # POT_MAX is wide: signal_io rescales when >120


def _reject_non_finite(value: float, field: str) -> float:
    if not math.isfinite(value):
        raise ValueError(f"{field} must be a finite number, got {value!r}")
    return value


class SampleRow(BaseModel):
    """One EMG/POT sample pair, exactly as the ESP32 emits it."""

    model_config = ConfigDict(extra="forbid")

    emg: float
    pot: float

    @field_validator("emg")
    @classmethod
    def _check_emg(cls, v: float) -> float:
        _reject_non_finite(v, "emg")
        if not EMG_MIN <= v <= EMG_MAX:
            raise ValueError(f"emg out of hardware range [{EMG_MIN}, {EMG_MAX}]: {v}")
        return v

    @field_validator("pot")
    @classmethod
    def _check_pot(cls, v: float) -> float:
        _reject_non_finite(v, "pot")
        if not POT_MIN <= v <= POT_MAX:
            raise ValueError(f"pot out of hardware range [{POT_MIN}, {POT_MAX}]: {v}")
        return v


class SignalPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Literal["samples"]
    rows: Annotated[list[SampleRow], Field(min_length=1)]


class UserCalibrationWord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: str = "pending"
    potCenter: float | None = None
    potRadius: float | None = None
    emgReference: list[float] | None = None
    qualityScore: float | None = None
    captureCount: int = 0


class UserCalibrationNeutral(BaseModel):
    model_config = ConfigDict(extra="forbid")

    baselineAdc: float
    noiseFloor: float | None = None
    emgStd: float | None = None
    potMean: float | None = None
    sampleCount: int | None = None


class UserCalibrationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profileVersion: int = 1
    modelSha256: str | None = None
    profileCompatible: bool = True
    neutral: UserCalibrationNeutral | None = None
    words: dict[str, UserCalibrationWord] = Field(default_factory=dict)


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["word", "sentence"]
    signal: SignalPayload

    # Optional override of the predictor's own accept threshold. None means "use
    # the value baked into calibrated_word_model.npz" (currently 0.50).
    minConfidence: Annotated[float | None, Field(ge=0.0, le=1.0)] = None

    # Optional session profile id from POST /session. None means no session
    # adaptation is applied, which matches how the saved-capture predictions
    # were verified.
    sessionId: str | None = None

    # Optional per-user calibration overlay resolved server-side by Node.
    userCalibration: UserCalibrationPayload | None = None


class CalibrationCapturePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signal: SignalPayload


class WordReferenceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word: str = Field(min_length=1, max_length=50)
    captures: Annotated[list[CalibrationCapturePayload], Field(min_length=1, max_length=16)]


class WordReferenceResponse(BaseModel):
    word: str
    emgReference: list[float]
    featureDimension: int
    potCenter: float
    potRadius: float
    qualityScore: float | None
    captureCount: int
    submittedCaptureCount: int
    rejectedCaptures: list[dict[str, object]]
    captureMetadata: dict[str, object]
    modelSha256: str
    processingTimeMs: float


class SessionCreateRequest(BaseModel):
    """Neutral relaxed baseline used to build a SessionAdapter."""

    model_config = ConfigDict(extra="forbid")

    signal: SignalPayload


class SessionResponse(BaseModel):
    sessionId: str
    baselineSamples: int
    baseline: float
    noiseFloor: float
    activeScale: float
    peakScale: float
    quietGate: float


class PredictResponse(BaseModel):
    """Prediction result.

    Every numeric field is passed through from the predictor unchanged, except
    that non-finite values become null because JSON cannot represent them.
    """

    kind: str
    label: str
    bestLabel: str
    confidence: float
    accepted: bool
    distance: float | None
    margin: float | None
    processingTimeMs: float

    # --- diagnostics, additive to the required contract ---------------------
    sampleCount: int
    quality: str
    sessionAdaptation: Literal["none", "applied"]
    requiredConfidence: float

    # Explicit semantics so a consumer cannot mistake these for probabilities.
    confidenceBasis: str = (
        "weighted heuristic score, not a probability and not cosine similarity: "
        "min(0.98, 0.48*pot_conf + 0.34*distance_conf + 0.18*gap_conf)"
    )
    marginUnit: str = (
        "potentiometer counts (pot_gap) whenever only one label passes the POT "
        "gate, which is the case for the current model; otherwise scaled "
        "feature-space distance"
    )
    distanceUnit: str = "scaled feature-space RMS distance to the 3 nearest in-class references"

    # Per-request personalization diagnostics (additive).
    personalization: dict[str, object] | None = None


class HealthResponse(BaseModel):
    status: str
    model: str
    word_model_loaded: bool
    labels: list[str]
    version: str

    # --- verifiable model identity -----------------------------------------
    model_sha256: str
    model_size_bytes: int
    model_modified_utc: str
    model_path: str

    sentence_model_supported: bool
    min_predict_samples: int
    max_predict_samples: int
    hard_min_samples: int
    default_min_confidence: float


class UnsupportedResponse(BaseModel):
    """Returned for kind='sentence'. Mirrors the runtime's own refusal values."""

    kind: str
    label: str
    bestLabel: str
    confidence: float
    accepted: bool
    supported: bool
    reason: str


class ErrorResponse(BaseModel):
    error: str
    detail: str
