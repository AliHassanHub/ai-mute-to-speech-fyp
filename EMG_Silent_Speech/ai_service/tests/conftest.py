"""Shared fixtures. All signal data comes from real capture files."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_DIR = Path(__file__).resolve().parents[2]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from runtime.robust_word_model import MAX_SAMPLES, MIN_SAMPLES  # noqa: E402
from runtime.signal_io import read_capture  # noqa: E402

CAPTURES_DIR = PROJECT_DIR / "captures"
REAL_LABELS = ("help", "no", "pain", "stop")


def rows_from_array(arr) -> list[dict]:
    """(samples, 2) array -> the API's request row format."""
    return [{"emg": float(e), "pot": float(p)} for e, p in arr]


def capture_paths(label: str) -> list[Path]:
    return sorted((CAPTURES_DIR / label).glob("*.txt"))


def usable_capture_paths(label: str) -> list[Path]:
    """Captures the current model's quality gate actually accepts."""
    out = []
    for path in capture_paths(label):
        n = read_capture(path).shape[0]
        if MIN_SAMPLES <= n <= MAX_SAMPLES:
            out.append(path)
    return out


def rejected_capture_paths() -> list[Path]:
    """Real captures the current model rejects (over the stale-buffer limit)."""
    out = []
    for label in REAL_LABELS:
        for path in capture_paths(label):
            if read_capture(path).shape[0] > MAX_SAMPLES:
                out.append(path)
    return out


@pytest.fixture
def client():
    """TestClient with lifespan run, so the model is actually loaded.

    Function-scoped on purpose: the service keeps module-level model state, and
    the missing-model test runs its own client whose shutdown clears that state.
    A fresh lifespan per test keeps the suite order-independent. Startup is cheap
    because load_model is cached on file identity.
    """
    from fastapi.testclient import TestClient

    from ai_service.app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def first_usable_capture():
    paths = usable_capture_paths("help")
    assert paths, "no usable 'help' captures found"
    return read_capture(paths[0])
