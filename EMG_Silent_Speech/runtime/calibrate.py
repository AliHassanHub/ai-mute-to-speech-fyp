import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.robust_word_model import print_summary, train_word_model


def main():
    if len(sys.argv) < 2:
        print("usage: python runtime/calibrate.py <label> [new_file1.txt ...]")
        print("After adding captures under captures/<label>/, run:")
        print("  python ai.py train                 # full rebuild")
        print("  python runtime/extend_vocabulary.py extend <label>  # incremental append")
        raise SystemExit(1)

    # New files are already stored under captures/<label>/. We retrain only the
    # compact calibrated prototype bank, not a large neural network.
    try:
        summary = train_word_model()
    except Exception as exc:
        print(f"calibration failed: {exc}")
        raise SystemExit(1) from exc
    print_summary(summary)


if __name__ == "__main__":
    main()
