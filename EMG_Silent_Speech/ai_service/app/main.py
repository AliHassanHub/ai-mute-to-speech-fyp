"""FastAPI application exposing the calibrated EMG word predictor.

Endpoints
    GET  /health    service and artefact status
    POST /session   build a session profile from a neutral relaxed baseline
    POST /predict   calibrated word prediction (kind='sentence' -> 501)
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from . import __version__, config, service
from .schemas import (
    HealthResponse,
    PredictRequest,
    PredictResponse,
    SessionCreateRequest,
    SessionResponse,
    UnsupportedResponse,
    WordReferenceRequest,
    WordReferenceResponse,
)

logger = logging.getLogger("emg.ai")

# Starlette renamed HTTP_422_UNPROCESSABLE_ENTITY; use the literal to stay
# compatible across versions without emitting a deprecation warning.
HTTP_422 = 422

_startup_error: str | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Verify the calibrated artefact at startup and fail loudly if missing."""
    global _startup_error
    _startup_error = None
    try:
        state = service.init()
        logger.info(
            "calibrated model ready: labels=%s sha256=%s min_confidence=%.2f",
            state.labels,
            state.identity.short_sha if state.identity else "?",
            state.default_min_confidence,
        )
    except service.ModelUnavailable as exc:
        # Keep the process up so /health can report the fault precisely, rather
        # than crashing with a traceback that a caller never sees.
        _startup_error = str(exc)
        logger.error("MODEL UNAVAILABLE: %s", exc)
    yield
    service.reset_state()


app = FastAPI(
    title="EMG Calibrated Word Inference API",
    description=(
        "Thin HTTP wrapper around the existing calibrated word predictor "
        "(runtime/predict.py -> runtime/robust_word_model.py, backed by "
        "training/results/calibrated_word_model.npz). Sentence inference is not "
        "supported."
    ),
    version=__version__,
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------
@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    """Malformed request -> 422 with a readable reason."""
    problems = [
        f"{'.'.join(str(p) for p in err.get('loc', ()))}: {err.get('msg', 'invalid')}"
        for err in exc.errors()
    ]
    return JSONResponse(
        status_code=HTTP_422,
        content={"error": "malformed-request", "detail": "; ".join(problems[:8])},
    )


@app.exception_handler(service.SignalRejected)
async def signal_rejected_handler(request: Request, exc: service.SignalRejected):
    return JSONResponse(
        status_code=HTTP_422,
        content={"error": exc.reason, "detail": exc.detail},
    )


@app.exception_handler(service.ModelUnavailable)
async def model_unavailable_handler(request: Request, exc: service.ModelUnavailable):
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"error": "model-unavailable", "detail": str(exc)},
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get(
    "/health",
    response_model=HealthResponse,
    responses={503: {"description": "Calibrated model missing or unreadable"}},
)
def get_health():
    if _startup_error is not None:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={
                "status": "error",
                "model": config.MODEL_NAME,
                "word_model_loaded": False,
                "labels": [],
                "version": __version__,
                "error": "model-unavailable",
                "detail": _startup_error,
            },
        )
    return service.health()


@app.post(
    "/session",
    response_model=SessionResponse,
    responses={
        422: {"description": "Baseline too short or invalid"},
        503: {"description": "Model missing training profile"},
    },
)
def post_session(payload: SessionCreateRequest):
    """Create a session profile from a neutral relaxed EMG baseline.

    Required for electrode-shift tolerance during live inference. Not required
    for saved-capture prediction.
    """
    session_id, adapter = service.create_session(payload.signal.rows)
    return SessionResponse(
        sessionId=session_id,
        baselineSamples=len(payload.signal.rows),
        baseline=float(adapter.baseline),
        noiseFloor=float(adapter.noise_floor),
        activeScale=float(adapter.active_scale),
        peakScale=float(adapter.peak_scale),
        quietGate=float(adapter.quiet_gate),
    )


@app.post(
    "/predict",
    response_model=PredictResponse,
    responses={
        422: {"description": "Malformed, empty, or insufficient signal"},
        501: {"description": "kind='sentence' is not supported"},
        503: {"description": "Calibrated model missing or unreadable"},
    },
)
def post_predict(payload: PredictRequest):
    if payload.kind == "sentence":
        return JSONResponse(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            content=UnsupportedResponse(**service.sentence_unsupported()).model_dump(),
        )

    result = service.predict_word(
        payload.signal.rows,
        min_confidence=payload.minConfidence,
        session_id=payload.sessionId,
        user_calibration_payload=(
            payload.userCalibration.model_dump() if payload.userCalibration else None
        ),
    )
    return PredictResponse(**result)


@app.post(
    "/calibration/word-reference",
    response_model=WordReferenceResponse,
    responses={
        422: {"description": "Insufficient or invalid calibration captures"},
        503: {"description": "Calibrated model missing or unreadable"},
    },
)
def post_word_reference(payload: WordReferenceRequest):
    """Extract a production-compatible scaled feature reference from real captures."""
    capture_rows = [item.signal.rows for item in payload.captures]
    result = service.build_word_reference(payload.word, capture_rows)
    return WordReferenceResponse(**result)
