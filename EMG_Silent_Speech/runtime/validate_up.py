"""Up calibration validation for v6 model."""
from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_DIR))

from runtime.robust_word_model import (  # noqa: E402
    capture_stats,
    load_model,
    predict_capture,
    predict_file,
    quality_reason,
    read_capture,
    verify_label_regression,
)

V5 = PROJECT_DIR / "training/results/calibrated_word_model_v5.npz"
V6 = PROJECT_DIR / "training/results/calibrated_word_model_v6.npz"
EXISTING = ["help", "no", "pain", "stop", "Assistance", "Medical", "Pick", "Land"]


def main() -> int:
    print("=== Baseline v5 (before Up extension) ===")
    print(json.dumps(verify_label_regression(V5, labels=EXISTING), indent=2))

    root = Path("captures/Up")
    files = sorted(root.glob("*.txt"))
    print(f"\nUp files: {len(files)}")
    for path in files:
        capture = read_capture(path)
        stats = capture_stats(capture)
        print(
            f"  {path.name}: samples={len(capture)} pot_mean={stats['pot_mean']:.1f} "
            f"emg_std={stats['emg_std']:.1f} quality={quality_reason(capture)}"
        )

    v6 = load_model(V6)
    labels = v6["label_names"]
    pots = v6["pot_centers"].tolist()
    radii = v6["pot_radii"].tolist()
    thresholds = v6["thresholds"].tolist()
    up_idx = labels.index("Up")

    print("\n=== v6 metadata ===")
    print("labels:", labels)
    print("Up center:", pots[up_idx], "radius:", radii[up_idx], "threshold:", thresholds[up_idx])
    for index, name in enumerate(labels):
        print(f"  {name}: [{pots[index]-radii[index]:.1f}, {pots[index]+radii[index]:.1f}]")

    reg8 = verify_label_regression(V6, labels=EXISTING)
    reg_all = verify_label_regression(V6)
    print("\nRegression existing eight:", json.dumps(reg8))
    print("Regression all nine:", json.dumps(reg_all))

    usable_files = [p for p in files if quality_reason(read_capture(p)) == "ok"]
    held_out = usable_files[-1]
    correct = rejected = wrong = 0
    for path in usable_files:
        capture = read_capture(path)
        result = predict_capture(capture, model_path=V6)
        if path == held_out:
            print(f"\nHeld-out {path.name}: {result.label} accepted={result.accepted} conf={result.confidence:.4f}")
        if result.label == "Up" and result.accepted:
            correct += 1
        elif not result.accepted:
            rejected += 1
        else:
            wrong += 1
    print(f"Up validation: correct={correct} rejected={rejected} wrong={wrong}")

    false_accepts = []
    for word in EXISTING:
        for path in sorted((Path("captures") / word).glob("*.txt"))[:5]:
            capture = read_capture(path)
            if quality_reason(capture) != "ok":
                continue
            result = predict_capture(capture, model_path=V6)
            if result.label == "Up":
                false_accepts.append((word, path.name, result.confidence))
    print("False accepts to Up:", false_accepts or "none")

    cli = predict_file(str(held_out), min_confidence=0.5, model_path=V6)
    print(f"CLI held-out: {cli.label} accepted={cli.accepted} conf={cli.confidence:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
