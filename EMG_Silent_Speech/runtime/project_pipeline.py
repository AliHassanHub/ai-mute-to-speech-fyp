import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent
PYTHON = sys.executable


def usage():
    print("Usage:")
    print("  python runtime/project_pipeline.py train")
    print('  python runtime/project_pipeline.py capture <label> [extra args]')
    print('  python runtime/project_pipeline.py live [extra args]')
    print('  python runtime/project_pipeline.py predict-word "<signal_file>" [--min-confidence 0.68]')
    print('  python runtime/project_pipeline.py counts')
    print('  python runtime/project_pipeline.py verify')


def run_stage(cmd):
    try:
        subprocess.run(cmd, check=True)
    except KeyboardInterrupt:
        print("Stopped.")
        raise SystemExit(0)


def show_counts():
    root = PROJECT_DIR / "captures"
    if not root.is_dir():
        print("no captures folder found")
        return
    for folder in sorted(root.iterdir()):
        if folder.is_dir():
            print(f"{folder.name}: {len(list(folder.glob('*.txt')))}")


if len(sys.argv) < 2:
    usage()
    raise SystemExit(1)

sys.path.insert(0, str(BASE_DIR))
from predict import dispatch_predict

stage = sys.argv[1].strip().lower()

if stage == "train":
    run_stage([PYTHON, str(PROJECT_DIR / "runtime" / "rebuild_word_bank.py"), *sys.argv[2:]])
elif stage == "capture":
    if len(sys.argv) < 3:
        print('usage: python runtime/project_pipeline.py capture <label>')
        raise SystemExit(1)
    run_stage([PYTHON, str(PROJECT_DIR / "runtime" / "esp32_capture.py"), *sys.argv[2:]])
elif stage == "live":
    run_stage([PYTHON, str(PROJECT_DIR / "runtime" / "live_predict.py"), *sys.argv[2:]])
elif stage == "predict-word":
    if len(sys.argv) < 3:
        print('usage: python runtime/project_pipeline.py predict-word "<signal_file>"')
        raise SystemExit(1)
    min_confidence = 0.68
    if "--min-confidence" in sys.argv:
        i = sys.argv.index("--min-confidence")
        min_confidence = float(sys.argv[i + 1])
    dispatch_predict("word", sys.argv[2], min_confidence=min_confidence)
elif stage == "predict-sentence":
    print("Sentence prediction is disabled in the calibrated hardware workflow. Use predict-word.")
elif stage == "counts":
    show_counts()
elif stage == "verify":
    run_stage([PYTHON, str(PROJECT_DIR / "runtime" / "verify_pipeline.py")])
else:
    print("Unknown stage:", stage)
    usage()
    raise SystemExit(1)



