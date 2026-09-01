"""Medical calibration validation for v3 model."""
from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from runtime.robust_word_model import (  # noqa: E402
    MODEL_PATH_V2,
    capture_stats,
    load_model,
    predict_capture,
    predict_file,
    quality_reason,
    read_capture,
    verify_label_regression,
)

V3 = PROJECT_DIR / "training/results/calibrated_word_model_v3.npz"
EXISTING = ["help", "no", "pain", "stop", "Assistance"]


def main() -> int:
    print("=== Baseline v2 (before Medical extension) ===")
    reg_before = verify_label_regression(MODEL_PATH_V2, labels=EXISTING)
    print(json.dumps(reg_before, indent=2))

    root = Path("captures/Medical")
    files = sorted(root.glob("*.txt"))
    print(f"\nMedical files: {len(files)}")
    for path in files:
        capture = read_capture(path)
        stats = capture_stats(capture)
        print(
            f"  {path.name}: samples={len(capture)} pot_mean={stats['pot_mean']:.1f} "
            f"pot_std={stats['pot_std']:.2f} emg_std={stats['emg_std']:.1f} "
            f"quality={quality_reason(capture)}"
        )

    v3 = load_model(V3)
    labels = v3["label_names"]
    pots = v3["pot_centers"].tolist()
    radii = v3["pot_radii"].tolist()
    thresholds = v3["thresholds"].tolist()
    med_idx = labels.index("Medical")

    print("\n=== v3 model metadata ===")
    print("labels:", labels)
    print("POT centers:", pots)
    print("POT radii:", radii)
    print("Medical threshold:", thresholds[med_idx])

    print("\nPOT intervals:")
    for index, name in enumerate(labels):
        print(f"  {name}: [{pots[index]-radii[index]:.1f}, {pots[index]+radii[index]:.1f}]")

    reg_after = verify_label_regression(V3, labels=EXISTING)
    reg_all = verify_label_regression(V3)
    print("\n=== Regression after Medical ===")
    print("existing five:", json.dumps(reg_after))
    print("all six:", json.dumps(reg_all))

    held_out = files[-1]
    correct = rejected = wrong = 0
    for path in files:
        capture = read_capture(path)
        if quality_reason(capture) != "ok":
            continue
        result = predict_capture(capture, model_path=V3)
        if path == held_out:
            print(
                f"\nHeld-out {path.name}: label={result.label} accepted={result.accepted} "
                f"confidence={result.confidence:.4f}"
            )
        if result.label == "Medical" and result.accepted:
            correct += 1
        elif not result.accepted:
            rejected += 1
        else:
            wrong += 1
    print(f"Medical validation: correct={correct} rejected={rejected} wrong={wrong}")

    false_accepts = []
    for word in EXISTING:
        folder = Path("captures") / word
        for path in sorted(folder.glob("*.txt"))[:5]:
            capture = read_capture(path)
            if quality_reason(capture) != "ok":
                continue
            result = predict_capture(capture, model_path=V3)
            if result.label == "Medical":
                false_accepts.append((word, path.name, result.confidence))
    print("Cross-class false accepts to Medical:", false_accepts or "none")

    mis = []
    for path in files:
        capture = read_capture(path)
        if quality_reason(capture) != "ok":
            continue
        result = predict_capture(capture, model_path=V3)
        if result.label != "Medical":
            mis.append((path.name, result.label, result.accepted, result.confidence))
    print("Medical misclassified:", mis or "none")

    cli = predict_file(str(held_out), min_confidence=0.5, model_path=V3)
    print(f"\nCLI held-out: {cli.label} accepted={cli.accepted} confidence={cli.confidence:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
