import argparse
import subprocess
import sys
from pathlib import Path

PY = sys.executable
PORT = "COM7"
BAUD = "115200"


def run(args):
    subprocess.run(args, check=True)


def latest_file(folder):
    files = sorted(Path(folder).glob("*.txt"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        raise SystemExit(f"no files found in {folder}")
    return files[0]


def main():
    parser = argparse.ArgumentParser(description="Short commands for the EMG silent speech demo.")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("ports")
    sub.add_parser("probe")

    add = sub.add_parser("add")
    add.add_argument("word")
    add.add_argument("--seconds", default="16")

    test = sub.add_parser("test")
    test.add_argument("word")
    test.add_argument("--seconds", default="16")

    pred = sub.add_parser("predict")
    pred.add_argument("word_or_file")
    pred.add_argument("--min-confidence", default="0.68")

    live = sub.add_parser("live")
    live.add_argument("--min-confidence", default="0.68")

    sub.add_parser("rebuild")
    sub.add_parser("train")
    sub.add_parser("counts")
    sub.add_parser("verify")

    args = parser.parse_args()

    if args.cmd == "ports":
        run([PY, "runtime/capture_arduino.py", "--list-ports"])
    elif args.cmd == "probe":
        run([PY, "runtime/capture_arduino.py", "--port", PORT, "--baud", BAUD, "--probe", "--seconds", "5", "--debug"])
    elif args.cmd == "add":
        run([PY, "runtime/project_pipeline.py", "capture", args.word, "--port", PORT, "--seconds", args.seconds])
    elif args.cmd == "test":
        run([PY, "runtime/esp32_capture.py", args.word, "--port", PORT, "--baud", BAUD, "--seconds", args.seconds, "--out-dir", "_capture_verify", "--no-train"])
        file_path = latest_file(Path("_capture_verify") / args.word)
        run([PY, "runtime/predict.py", "predict-word", str(file_path), "--min-confidence", args.min_confidence if hasattr(args, "min_confidence") else "0.62"])
    elif args.cmd == "predict":
        path = Path(args.word_or_file)
        if not path.is_file():
            path = latest_file(Path("_capture_verify") / args.word_or_file)
        run([PY, "runtime/predict.py", "predict-word", str(path), "--min-confidence", args.min_confidence])
    elif args.cmd == "live":
        run([PY, "runtime/project_pipeline.py", "live", "--port", PORT, "--kind", "word", "--min-confidence", args.min_confidence])
    elif args.cmd in ("rebuild", "train"):
        run([PY, "runtime/project_pipeline.py", "train"])
    elif args.cmd == "counts":
        run([PY, "runtime/project_pipeline.py", "counts"])
    elif args.cmd == "verify":
        run([PY, "runtime/project_pipeline.py", "verify"])


if __name__ == "__main__":
    main()



