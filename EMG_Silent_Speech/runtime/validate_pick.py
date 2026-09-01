"""Pick calibration validation for v4 model."""
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

V3 = PROJECT_DIR / "training/results/calibrated_word_model_v3.npz"
V4 = PROJECT_DIR / "training/results/calibrated_word_model_v4.npz"
EXISTING = ["help", "no", "pain", "stop", "Assistance", "Medical"]


def main() -> int:
    print("=== Baseline v3 (before Pick extension) ===")
    reg_before = verify_label_regression(V3, labels=EXISTING)
    print(json.dumps(reg_before, indent=2))

    root = Path("captures/Pick")
    files = sorted(root.glob("*.txt"))
    print(f"\nPick files: {len(files)}")
    for path in files:
        capture = read_capture(path)
        stats = capture_stats(capture)
        print(
            f"  {path.name}: samples={len(capture)} pot_mean={stats['pot_mean']:.1f} "
            f"emg_std={stats['emg_std']:.1f} quality={quality_reason(capture)}"
        )

    v4 = load_model(V4)
    labels = v4["label_names"]
    pots = v4["pot_centers"].tolist()
    radii = v4["pot_radii"].tolist()
    thresholds = v4["thresholds"].tolist()
    pick_idx = labels.index("Pick")

    print("\n=== v4 metadata ===")
    print("labels:", labels)
    print("Pick center:", pots[pick_idx], "radius:", radii[pick_idx], "threshold:", thresholds[pick_idx])
    for index, name in enumerate(labels):
        print(f"  {name}: [{pots[index]-radii[index]:.1f}, {pots[index]+radii[index]:.1f}]")

    reg6 = verify_label_regression(V4, labels=EXISTING)
    reg_all = verify_label_regression(V4)
    print("\nRegression existing six:", json.dumps(reg6))
    print("Regression all seven:", json.dumps(reg_all))

    usable_files = [p for p in files if quality_reason(read_capture(p)) == "ok"]
    held_out = usable_files[-1]
    correct = rejected = wrong = 0
    for path in usable_files:
        capture = read_capture(path)
        result = predict_capture(capture, model_path=V4)
        if path == held_out:
            print(f"\nHeld-out {path.name}: {result.label} accepted={result.accepted} conf={result.confidence:.4f}")
        if result.label == "Pick" and result.accepted:
            correct += 1
        elif not result.accepted:
            rejected += 1
        else:
            wrong += 1
    print(f"Pick validation: correct={correct} rejected={rejected} wrong={wrong}")

    false_accepts = []
    for word in EXISTING:
        for path in sorted((Path("captures") / word).glob("*.txt"))[:5]:
            capture = read_capture(path)
            if quality_reason(capture) != "ok":
                continue
            result = predict_capture(capture, model_path=V4)
            if result.label == "Pick":
                false_accepts.append((word, path.name, result.confidence))
    print("False accepts to Pick:", false_accepts or "none")

    cli = predict_file(str(held_out), min_confidence=0.5, model_path=V4)
    print(f"CLI held-out: {cli.label} accepted={cli.accepted} conf={cli.confidence:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
