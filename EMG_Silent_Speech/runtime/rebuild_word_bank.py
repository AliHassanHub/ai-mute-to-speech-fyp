import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from runtime.robust_word_model import print_summary, train_word_model


def main():
    try:
        summary = train_word_model()
    except Exception as exc:
        print(f"rebuild failed: {exc}")
        raise SystemExit(1) from exc
    print_summary(summary)


if __name__ == "__main__":
    main()
