import re
from pathlib import Path

import numpy as np


ID_PATTERN = re.compile(r"\((\d+)-(\d+)\)")


def parse_ids(file_name):
    match = ID_PATTERN.search(file_name)
    if not match:
        return None, None
    return int(match.group(1)), int(match.group(2))


def read_signal(path):
    path = Path(path)

    if not path.exists():
        raise FileNotFoundError(f"File not found: {path}")

    if path.suffix.lower() != ".txt":
        raise ValueError(f"Expected a txt file: {path}")

    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            parts = line.split(";")
            try:
                rows.append([float(value) for value in parts])
            except ValueError as exc:
                raise ValueError(f"Bad numeric value in {path} at line {line_number}") from exc

    if not rows:
        raise ValueError(f"Empty signal file: {path}")

    signal = np.asarray(rows, dtype=np.float32)

    if signal.ndim != 2:
        raise ValueError(f"Expected 2D signal array in {path}")

    return signal
