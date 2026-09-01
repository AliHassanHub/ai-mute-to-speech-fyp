import argparse
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

import numpy as np

from runtime.robust_word_model import predict_capture, predict_file

TARGET_LENGTH_SENT = 768
TARGET_LENGTH_WORD = 384
DEFAULT_MIN_CONFIDENCE = 0.68


def _resolve_kind(kind):
    kind = str(kind).strip().lower().replace("_", "-")
    if "sentence" in kind:
        return "sentence"
    if "word" in kind:
        return "word"
    raise ValueError(f"unknown prediction kind: {kind}")


def predict_from_signal_array(
    kind,
    values,
    min_confidence=DEFAULT_MIN_CONFIDENCE,
    temperature=None,
    adapter=None,
    model_path=None,
    user_calibration=None,
):
    kind = _resolve_kind(kind)
    if kind != "word":
        return {
            "label": "unknown",
            "best_label": "sentence-model-disabled",
            "confidence": 0.0,
            "accepted": False,
            "kind": kind,
        }

    arr = np.asarray(values, dtype=np.float32)
    if arr.ndim == 1:
        capture = np.stack([arr, np.zeros_like(arr)], axis=1)
    elif arr.ndim == 2 and arr.shape[1] == 2:
        capture = arr
    elif arr.ndim == 2 and arr.shape[0] == 2:
        capture = arr.T
    elif arr.ndim == 3 and arr.shape[1] == 2:
        capture = arr[0].T
    else:
        raise ValueError(f"unsupported signal shape: {arr.shape}")

    predict_kwargs = {
        "min_confidence": min_confidence,
        "adapter": adapter,
        "user_calibration": user_calibration,
    }
    if model_path is not None:
        predict_kwargs["model_path"] = model_path
    result = predict_capture(capture, **predict_kwargs)
    return {
        "label": result.label,
        "best_label": result.best_label,
        "confidence": result.confidence,
        "accepted": result.accepted,
        "distance": result.distance,
        "margin": result.margin,
        "kind": kind,
    }


def dispatch_predict(kind, signal_path, min_confidence=DEFAULT_MIN_CONFIDENCE):
    kind = _resolve_kind(kind)
    if kind != "word":
        print("Sentence prediction is disabled for this calibrated hardware workflow. Use predict-word.")
        return {
            "label": "unknown",
            "best_label": "sentence-model-disabled",
            "confidence": 0.0,
            "accepted": False,
            "kind": kind,
        }

    result = predict_file(signal_path, min_confidence=min_confidence)
    if result.accepted:
        print(
            f"{result.label}  confidence={result.confidence:.2f}  "
            f"distance={result.distance:.3f}  margin={result.margin:.3f}"
        )
    else:
        print(
            f"unknown  best={result.best_label}  confidence={result.confidence:.2f}  "
            f"distance={result.distance:.3f}  margin={result.margin:.3f}"
        )
    return {
        "label": result.label,
        "best_label": result.best_label,
        "confidence": result.confidence,
        "accepted": result.accepted,
        "distance": result.distance,
        "margin": result.margin,
        "kind": kind,
    }


def main():
    parser = argparse.ArgumentParser(description="Predict a calibrated word from an EMG;POT capture file.")
    parser.add_argument("kind", help="predict-word")
    parser.add_argument("signal_path", help="Signal file to predict from")
    parser.add_argument("--min-confidence", type=float, default=DEFAULT_MIN_CONFIDENCE, help="Reject low-confidence predictions")
    args = parser.parse_args()
    dispatch_predict(args.kind, args.signal_path, min_confidence=args.min_confidence)


if __name__ == "__main__":
    main()
