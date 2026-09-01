"""Assistance calibration validation for v2 model."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from runtime.robust_word_model import (  # noqa: E402
    MODEL_PATH,
    MODEL_PATH_V2,
    load_model,
    predict_capture,
    quality_reason,
    read_capture,
    verify_label_regression,
)


def main() -> int:
    v2 = load_model(MODEL_PATH_V2)
    labels = v2["label_names"]
    pots = v2["pot_centers"].tolist()
    radii = v2["pot_radii"].tolist()
    thresholds = v2["thresholds"].tolist()
    assist_idx = labels.index("Assistance")

    print("V2 labels:", labels)
    print("POT centers:", pots)
    print("POT radii:", radii)
    print("Thresholds:", thresholds)
    print(
        "Assistance learned center:",
        pots[assist_idx],
        "radius:",
        radii[assist_idx],
        "threshold:",
        thresholds[assist_idx],
    )

    print("\nPOT separation (center +/- radius):")
    for index, name in enumerate(labels):
        low = pots[index] - radii[index]
        high = pots[index] + radii[index]
        print(f"  {name}: [{low:.1f}, {high:.1f}]")

    reg_all = verify_label_regression(MODEL_PATH_V2)
    reg4 = verify_label_regression(MODEL_PATH_V2, labels=["help", "no", "pain", "stop"])
    print("\nV2 regression all labels:", json.dumps(reg_all))
    print("V2 regression original 4:", json.dumps(reg4))

    assist_dir = Path("captures/Assistance")
    files = sorted(assist_dir.glob("*.txt"))
    held_out = files[-1]
    correct = rejected = wrong = 0
    for path in files:
        capture = read_capture(path)
        if quality_reason(capture) != "ok":
            continue
        result = predict_capture(capture, model_path=MODEL_PATH_V2)
        if path == held_out:
            print(
                f"\nHeld-out {path.name}: label={result.label} "
                f"accepted={result.accepted} confidence={result.confidence:.4f}"
            )
        if result.label == "Assistance" and result.accepted:
            correct += 1
        elif not result.accepted:
            rejected += 1
        else:
            wrong += 1
    print(
        f"Assistance all-files: correct={correct} rejected={rejected} "
        f"wrong={wrong} total={len(files)}"
    )

    false_accepts = []
    for word in ["help", "no", "pain", "stop"]:
        folder = Path("captures") / word
        for path in sorted(folder.glob("*.txt"))[:5]:
            capture = read_capture(path)
            if quality_reason(capture) != "ok":
                continue
            result = predict_capture(capture, model_path=MODEL_PATH_V2)
            if result.label == "Assistance":
                false_accepts.append((word, path.name, result.confidence))

    misclassified = []
    for path in files:
        capture = read_capture(path)
        if quality_reason(capture) != "ok":
            continue
        result = predict_capture(capture, model_path=MODEL_PATH_V2)
        if result.label != "Assistance":
            misclassified.append((path.name, result.label, result.accepted, result.confidence))

    print("\nCross-class false accepts to Assistance:", false_accepts or "none")
    print("Assistance misclassified as existing:", misclassified or "none")

    print("\nCLI held-out predict:")
    subprocess.run(
        [
            sys.executable,
            "runtime/predict.py",
            "predict-word",
            str(held_out),
            "--min-confidence",
            "0.50",
        ],
        check=False,
        env={**dict(**{k: v for k, v in __import__("os").environ.items()}), "EMG_AI_MODEL_PATH": str(MODEL_PATH_V2)},
    )

    baseline = verify_label_regression(MODEL_PATH, labels=["help", "no", "pain", "stop"])
    print("\nBaseline v1 regression:", json.dumps(baseline))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
