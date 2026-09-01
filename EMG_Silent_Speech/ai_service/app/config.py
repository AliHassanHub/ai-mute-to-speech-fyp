"""Configuration for the EMG calibrated-word inference API.

Every value that describes model behaviour is read from the existing runtime
implementation rather than restated here, so this service cannot drift away from
the predictor it wraps.
"""

from __future__ import annotations

import hashlib
import os
import sys
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------------------
# Project root discovery
# ---------------------------------------------------------------------------
# ai_service/app/config.py -> ai_service/app -> ai_service -> EMG_Silent_Speech
PROJECT_DIR = Path(__file__).resolve().parents[2]

if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

# Imported after the path fix so the existing runtime package resolves.
from runtime.robust_word_model import (  # noqa: E402
    MAX_SAMPLES,
    MIN_SAMPLES,
    MODEL_PATH,
)

# ---------------------------------------------------------------------------
# Sample-count policy
# ---------------------------------------------------------------------------
# HARD_MIN/HARD_MAX are the predictor's own quality gate (robust_word_model.py
# MIN_SAMPLES / MAX_SAMPLES). A capture outside this range is rejected by
# quality_reason() before any feature extraction happens.
HARD_MIN_SAMPLES = int(MIN_SAMPLES)  # 50
HARD_MAX_SAMPLES = int(MAX_SAMPLES)  # 1800

# API minimum exceeds the predictor hard gate. On real captures, 768 is the
# smallest trailing window that matches full-capture ground truth; training
# captures are typically 801..1682 samples.
MIN_PREDICT_SAMPLES = int(os.getenv("EMG_AI_MIN_PREDICT_SAMPLES", "768"))

# Neutral-baseline requirement for building a session profile. Matches
# runtime/live_predict.py, which raises below 80 collected neutral samples.
MIN_SESSION_BASELINE_SAMPLES = int(os.getenv("EMG_AI_MIN_SESSION_SAMPLES", "80"))

# ---------------------------------------------------------------------------
# Model artefact
# ---------------------------------------------------------------------------
# Overridable so tests can point at a missing file and assert the failure path.
# Load ai_service/.env before reading EMG_AI_MODEL_PATH so local deployments pick up
# calibrated_word_model_v6.npz without requiring a shell export.
def _load_service_env() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and (key == "EMG_AI_MODEL_PATH" or key not in os.environ):
            os.environ[key] = value


_load_service_env()
_model_path_override = os.getenv("EMG_AI_MODEL_PATH")
ACTIVE_MODEL_PATH = Path(_model_path_override) if _model_path_override else Path(MODEL_PATH)

MODEL_NAME = "calibrated_word_model"

# Reloading the 175 KB .npz inside every predict_capture() call costs ~1.6 ms.
# Caching is keyed on file identity (see service.install_model_cache) so a
# retrain invalidates it automatically. Set to "0" to disable.
CACHE_MODEL = os.getenv("EMG_AI_CACHE_MODEL", "1") not in ("0", "false", "False")

SERVICE_NAME = "emg-calibrated-word-api"


@dataclass(frozen=True)
class ModelIdentity:
    """Verifiable identity of the loaded artefact — not a hand-written version."""

    path: str
    sha256: str
    size_bytes: int
    modified_utc: str

    @property
    def short_sha(self) -> str:
        return self.sha256[:12]


def model_identity(path: Path | None = None) -> ModelIdentity:
    """Hash and stat the model file so callers can pin an exact artefact."""
    target = Path(path) if path is not None else ACTIVE_MODEL_PATH
    digest = hashlib.sha256()
    with target.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 256), b""):
            digest.update(chunk)
    stat = target.stat()
    import datetime as _dt

    modified = _dt.datetime.fromtimestamp(stat.st_mtime, _dt.timezone.utc)
    return ModelIdentity(
        path=str(target),
        sha256=digest.hexdigest(),
        size_bytes=stat.st_size,
        modified_utc=modified.isoformat().replace("+00:00", "Z"),
    )
