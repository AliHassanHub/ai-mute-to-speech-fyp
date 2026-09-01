"""Service layer.

All prediction logic lives in runtime/. This module only:
  - verifies and loads the calibrated artefact through the existing loader,
  - converts validated request rows into the array shape the runtime expects,
  - holds session adapters,
  - normalises the runtime's dataclass into JSON-safe values.

It deliberately contains no feature extraction, scoring or acceptance logic.
"""

from __future__ import annotations

import math
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import config
from .config import ACTIVE_MODEL_PATH, MODEL_NAME

# The existing implementation — the single source of prediction truth.
from runtime import robust_word_model
from runtime.predict import predict_from_signal_array
from runtime.session_adaptation import SessionAdapter, estimate_session_profile
from runtime.calibration_reference import (
    CalibrationRejected,
    MAX_CALIBRATION_CAPTURES,
    MIN_CALIBRATION_CAPTURES,
    build_word_calibration_reference,
    rows_to_capture,
)
from runtime.user_calibration import parse_user_calibration_payload


class ModelUnavailable(RuntimeError):
    """The calibrated artefact is missing, unreadable or the wrong format."""


class SignalRejected(ValueError):
    """The signal cannot be sent to the predictor at all."""

    def __init__(self, reason: str, detail: str):
        super().__init__(detail)
        self.reason = reason
        self.detail = detail


# ---------------------------------------------------------------------------
# Model cache
# ---------------------------------------------------------------------------
# robust_word_model.predict_capture() calls load_model() on every invocation,
# which re-reads the .npz from disk (~1.6 ms). We memoise the *existing* loader
# rather than reimplementing it. The key includes mtime_ns and size, so
# retraining the model invalidates the cache with no restart needed.

_cache_lock = threading.Lock()
_cache: dict[tuple, dict] = {}
_original_load_model = robust_word_model.load_model
_cache_installed = False


def install_model_cache() -> None:
    """Wrap runtime.robust_word_model.load_model with a file-identity cache."""
    global _cache_installed
    if _cache_installed or not config.CACHE_MODEL:
        return

    def cached_load_model(model_path=robust_word_model.MODEL_PATH):
        path = Path(model_path)
        try:
            stat = path.stat()
        except OSError:
            # Let the original raise its own clear FileNotFoundError.
            return _original_load_model(model_path)
        key = (str(path.resolve()), stat.st_mtime_ns, stat.st_size)
        with _cache_lock:
            hit = _cache.get(key)
        if hit is not None:
            return hit
        loaded = _original_load_model(model_path)
        with _cache_lock:
            _cache[key] = loaded
        return loaded

    robust_word_model.load_model = cached_load_model
    _cache_installed = True


def uninstall_model_cache() -> None:
    """Restore the untouched loader. Used by the cache-equivalence test."""
    global _cache_installed
    robust_word_model.load_model = _original_load_model
    _cache_installed = False
    with _cache_lock:
        _cache.clear()


# ---------------------------------------------------------------------------
# Model state
# ---------------------------------------------------------------------------
@dataclass
class ModelState:
    loaded: bool
    labels: list[str]
    default_min_confidence: float
    identity: config.ModelIdentity | None
    error: str | None = None


_model_state: ModelState | None = None


def load_model_state(model_path: Path | None = None) -> ModelState:
    """Verify the artefact exists and is readable, then load it via runtime code.

    Raises ModelUnavailable with an actionable message on any failure.
    """
    target = Path(model_path) if model_path is not None else ACTIVE_MODEL_PATH

    if not target.exists():
        raise ModelUnavailable(
            f"calibrated model not found: {target}. "
            "Expected training/results/calibrated_word_model.npz. "
            "Generate it with: python ai.py train"
        )
    if not target.is_file():
        raise ModelUnavailable(f"calibrated model path is not a file: {target}")
    try:
        with target.open("rb") as handle:
            handle.read(1)
    except OSError as exc:
        raise ModelUnavailable(f"calibrated model is not readable: {target} ({exc})") from exc

    try:
        model = robust_word_model.load_model(target)
    except Exception as exc:
        raise ModelUnavailable(f"calibrated model failed to load: {target} ({exc})") from exc

    labels = list(model["label_names"])
    if len(labels) < 2:
        raise ModelUnavailable(f"calibrated model has fewer than two labels: {labels}")

    return ModelState(
        loaded=True,
        labels=labels,
        default_min_confidence=float(model["min_confidence"]),
        identity=config.model_identity(target),
    )


def init(model_path: Path | None = None) -> ModelState:
    """Startup hook. Installs the cache and loads the model."""
    global _model_state
    install_model_cache()
    _model_state = load_model_state(model_path)
    return _model_state


def get_model_state() -> ModelState:
    if _model_state is None or not _model_state.loaded:
        raise ModelUnavailable("model state not initialised")
    return _model_state


def reset_state() -> None:
    """Test hook."""
    global _model_state
    _model_state = None
    _sessions.clear()


# ---------------------------------------------------------------------------
# Session adapters
# ---------------------------------------------------------------------------
_sessions: dict[str, SessionAdapter] = {}


def create_session(rows) -> tuple[str, SessionAdapter]:
    """Build a SessionAdapter from a neutral relaxed baseline.

    Mirrors runtime/live_predict.py: collect neutral EMG, estimate a session
    profile, pair it with the training profile stored in the model.
    """
    capture = rows_to_array(rows)
    count = int(capture.shape[0])
    if count < config.MIN_SESSION_BASELINE_SAMPLES:
        raise SignalRejected(
            "insufficient-baseline",
            f"session adaptation needs at least {config.MIN_SESSION_BASELINE_SAMPLES} "
            f"neutral samples, received {count}. Keep the face relaxed and stream "
            f"~{config.MIN_SESSION_BASELINE_SAMPLES / 50.0:.1f}s before calibrating.",
        )

    model = robust_word_model.load_model(ACTIVE_MODEL_PATH)
    training_profile = model.get("training_profile")
    if training_profile is None:
        raise ModelUnavailable(
            "model is missing training session metadata, so session adaptation "
            "cannot be applied safely. Retrain with: python ai.py train"
        )

    try:
        session_profile = estimate_session_profile(capture[:, 0])
    except ValueError as exc:
        raise SignalRejected("bad-baseline", str(exc)) from exc

    adapter = SessionAdapter(training_profile, session_profile)
    session_id = uuid.uuid4().hex
    _sessions[session_id] = adapter
    return session_id, adapter


def get_session(session_id: str) -> SessionAdapter:
    adapter = _sessions.get(session_id)
    if adapter is None:
        raise SignalRejected(
            "unknown-session",
            f"session {session_id!r} not found. Create one with POST /session, "
            "or omit sessionId to predict without session adaptation.",
        )
    return adapter


def session_count() -> int:
    return len(_sessions)


# ---------------------------------------------------------------------------
# Signal conversion and gating
# ---------------------------------------------------------------------------
def rows_to_array(rows) -> np.ndarray:
    """Validated rows -> (samples, 2) float32 array of [emg, pot]."""
    if not rows:
        raise SignalRejected("empty-signal", "signal.rows must contain at least one sample")
    pairs = [(float(r.emg), float(r.pot)) for r in rows]
    arr = np.asarray(pairs, dtype=np.float32)
    if arr.ndim != 2 or arr.shape[1] != 2:
        raise SignalRejected("bad-shape", f"expected (samples, 2), built {arr.shape}")
    if not np.isfinite(arr).all():
        raise SignalRejected("nan-or-inf", "signal contains non-finite values after conversion")
    return arr


def check_window(arr: np.ndarray) -> None:
    """Enforce the API's calibrated-window policy before touching the predictor.

    This is stricter than the predictor's own gate on the lower bound. See
    config.MIN_PREDICT_SAMPLES for the measurement that justifies it.
    """
    count = int(arr.shape[0])
    if count < config.MIN_PREDICT_SAMPLES:
        raise SignalRejected(
            "insufficient-samples",
            f"need at least {config.MIN_PREDICT_SAMPLES} samples for a calibrated "
            f"prediction, received {count}. The predictor's hard gate is "
            f"{config.HARD_MIN_SAMPLES}, but windows below "
            f"{config.MIN_PREDICT_SAMPLES} do not reproduce verified results: "
            f"measured agreement with ground truth is 41.5% at 50 samples, "
            f"87.8% at 384 and 100% at 768. "
            f"Buffer ~{config.MIN_PREDICT_SAMPLES / 50.0:.1f}s at 50 Hz.",
        )
    if count > config.HARD_MAX_SAMPLES:
        raise SignalRejected(
            "too-many-samples",
            f"received {count} samples, above the predictor's stale-buffer limit "
            f"of {config.HARD_MAX_SAMPLES}. The predictor treats this as a stale "
            f"buffer and rejects it. Send only the current utterance window.",
        )


def _json_safe(value) -> float | None:
    """JSON has no inf/nan. Rejected predictions report distance = inf."""
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


# ---------------------------------------------------------------------------
# Prediction
# ---------------------------------------------------------------------------
def build_word_reference(word: str, capture_rows_list: list) -> dict:
    """Build a scaled feature centroid from multiple real calibration captures."""
    get_model_state()

    captures = []
    for rows in capture_rows_list:
        captures.append(rows_to_capture(rows))

    started = time.perf_counter()
    try:
        result = build_word_calibration_reference(
            word,
            captures,
            model_path=ACTIVE_MODEL_PATH,
        )
    except CalibrationRejected as exc:
        raise SignalRejected(exc.reason, exc.detail) from exc

    identity = get_model_state().identity
    elapsed_ms = (time.perf_counter() - started) * 1000.0

    return {
        "word": result.word_label,
        "emgReference": result.emg_reference,
        "featureDimension": result.feature_dimension,
        "potCenter": result.pot_center,
        "potRadius": result.pot_radius,
        "qualityScore": result.quality_score,
        "captureCount": result.capture_count,
        "submittedCaptureCount": result.submitted_capture_count,
        "rejectedCaptures": result.rejected_captures,
        "captureMetadata": result.capture_metadata,
        "modelSha256": identity.sha256 if identity else "",
        "processingTimeMs": round(elapsed_ms, 3),
    }


def predict_word(
    rows,
    min_confidence: float | None = None,
    session_id: str | None = None,
    user_calibration_payload: dict | None = None,
) -> dict:
    """Run the existing calibrated predictor over a validated signal."""
    get_model_state()  # raises ModelUnavailable if not ready

    arr = rows_to_array(rows)
    check_window(arr)

    adapter = get_session(session_id) if session_id else None
    user_calibration = parse_user_calibration_payload(user_calibration_payload)

    # quality_reason is the predictor's own gate; report it for transparency.
    quality = robust_word_model.quality_reason(
        adapter.adapt_capture(arr) if adapter is not None else arr
    )

    started = time.perf_counter()
    result = predict_from_signal_array(
        "word",
        arr,
        min_confidence=min_confidence if min_confidence is not None else _default_confidence(),
        adapter=adapter,
        model_path=ACTIVE_MODEL_PATH,
        user_calibration=user_calibration,
    )
    elapsed_ms = (time.perf_counter() - started) * 1000.0

    required = min_confidence if min_confidence is not None else _default_confidence()

    personalization = (
        user_calibration.personalization_meta()
        if user_calibration is not None
        else {
            "applied": False,
            "profileVersion": None,
            "modelSha256Match": True,
            "profileFallbackRequired": False,
            "calibratedWords": [],
            "potPersonalizedWords": [],
            "emgReferenceWords": [],
        }
    )

    return {
        "kind": result["kind"],
        "label": result["label"],
        "bestLabel": result["best_label"],
        "confidence": float(result["confidence"]),
        "accepted": bool(result["accepted"]),
        "distance": _json_safe(result.get("distance")),
        "margin": _json_safe(result.get("margin")),
        "processingTimeMs": round(elapsed_ms, 3),
        "sampleCount": int(arr.shape[0]),
        "quality": quality,
        "sessionAdaptation": "applied" if adapter is not None else "none",
        "requiredConfidence": float(required),
        "personalization": personalization,
    }


def _default_confidence() -> float:
    """The threshold stored in the artefact, not a value chosen here."""
    return get_model_state().default_min_confidence


def sentence_unsupported() -> dict:
    """Ask the runtime itself for its sentence refusal, rather than inventing one."""
    # A tiny placeholder array: the runtime short-circuits on kind before it ever
    # inspects the signal, so this never reaches feature extraction.
    result = predict_from_signal_array("sentence", np.zeros((4, 2), dtype=np.float32))
    return {
        "kind": result["kind"],
        "label": result["label"],
        "bestLabel": result["best_label"],
        "confidence": float(result["confidence"]),
        "accepted": bool(result["accepted"]),
        "supported": False,
        "reason": (
            "Sentence prediction is disabled in the calibrated hardware workflow "
            "(runtime/predict.py returns 'sentence-model-disabled'). "
            "training/models/snn_sentence_encoder.pt exists but is not part of the "
            "active calibrated path and is deliberately not loaded."
        ),
    }


def health() -> dict:
    state = get_model_state()
    identity = state.identity
    assert identity is not None
    from . import __version__

    return {
        "status": "ok",
        "model": MODEL_NAME,
        "word_model_loaded": state.loaded,
        "labels": state.labels,
        "version": __version__,
        "model_sha256": identity.sha256,
        "model_size_bytes": identity.size_bytes,
        "model_modified_utc": identity.modified_utc,
        "model_path": identity.path,
        "sentence_model_supported": False,
        "min_predict_samples": config.MIN_PREDICT_SAMPLES,
        "max_predict_samples": config.HARD_MAX_SAMPLES,
        "hard_min_samples": config.HARD_MIN_SAMPLES,
        "default_min_confidence": state.default_min_confidence,
    }
