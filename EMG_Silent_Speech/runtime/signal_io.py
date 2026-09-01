import re
from pathlib import Path

import numpy as np

SENSOR_PAIR_RE = re.compile(
    r"\bEMG\s*:\s*(-?\d+(?:\.\d+)?)\b.*\bPOT\s*:\s*(-?\d+(?:\.\d+)?)\b",
    re.IGNORECASE,
)
LEGACY_SIG_RE = re.compile(r"^SIG,(-?\d+(?:\.\d+)?),.*src=(EMG|POT)", re.IGNORECASE)

EMG_MAX = 4095.0
POT_MAX = 100.0


def safe_name(text):
    clean = []
    for ch in str(text).strip():
        if ch.isalnum() or ch in ("-", "_"):
            clean.append(ch)
        elif ch.isspace():
            clean.append("_")
    return "".join(clean) or "label"


def _num(text):
    return float(str(text).strip())


def format_number(value):
    value = float(value)
    if value.is_integer():
        return str(int(value))
    return f"{value:.6f}".rstrip("0").rstrip(".")


def parse_capture_pair(line):
    """Parse a serial/file line and return (emg, pot), or None if unsupported.

    Supported input formats:
    - New canonical format: emg;pot
    - Legacy project format: sample;signal;emg;pot;source
    - ESP32 sketch format: EMG:<value> POT:<value>
    - Old SIG format and single-column fallback for diagnostics
    """
    text = str(line).strip()
    if not text:
        return None

    pair = SENSOR_PAIR_RE.search(text)
    if pair:
        return float(pair.group(1)), float(pair.group(2))

    parts = text.split(";")
    if len(parts) == 2:
        try:
            return _num(parts[0]), _num(parts[1])
        except ValueError:
            return None

    if len(parts) == 3:
        try:
            # sample;emg;pot
            return _num(parts[1]), _num(parts[2])
        except ValueError:
            return None

    if len(parts) >= 5:
        try:
            signal = _num(parts[1])
            emg = _num(parts[2])
            pot = _num(parts[3])
            source = int(_num(parts[4]))
        except ValueError:
            return None
        if source == 0 and emg == 0 and signal != 0:
            emg = signal
        return emg, pot

    match = LEGACY_SIG_RE.match(text)
    if match:
        value = float(match.group(1))
        if match.group(2).upper() == "POT":
            return 0.0, value
        return value, 0.0

    try:
        return _num(text), 0.0
    except ValueError:
        return None


def canonical_row(emg, pot):
    return f"{format_number(emg)};{format_number(pot)}"


def read_capture(path):
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"capture file not found: {path}")

    rows = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            pair = parse_capture_pair(line)
            if pair is None:
                raise ValueError(f"bad capture row in {path} at line {line_number}: {line.strip()!r}")
            rows.append(pair)

    if not rows:
        raise ValueError(f"empty capture file: {path}")
    return np.asarray(rows, dtype=np.float32)


def write_capture(path, pairs):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    arr = np.asarray(pairs, dtype=np.float32)
    if arr.ndim != 2 or arr.shape[1] != 2:
        raise ValueError("expected capture pairs with shape (samples, 2)")
    lines = [canonical_row(row[0], row[1]) for row in arr]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def resize_1d(values, target_length):
    values = np.asarray(values, dtype=np.float32).reshape(-1)
    if values.size == 0:
        raise ValueError("cannot resize an empty signal")
    if target_length <= 0:
        raise ValueError("target_length must be positive")
    if values.size == 1:
        return np.full(target_length, values[0], dtype=np.float32)
    old_x = np.linspace(0.0, 1.0, values.size)
    new_x = np.linspace(0.0, 1.0, target_length)
    return np.interp(new_x, old_x, values).astype(np.float32)


def normalize_emg(emg):
    emg = np.asarray(emg, dtype=np.float32).reshape(-1)
    if not np.isfinite(emg).all():
        raise ValueError("EMG contains nan or inf")
    centered = emg - float(np.median(emg))
    scale = float(np.percentile(np.abs(centered), 95))
    if scale < 1e-6:
        scale = float(np.std(centered))
    if scale < 1e-6:
        return np.zeros_like(centered, dtype=np.float32)
    return np.clip(centered / scale, -5.0, 5.0).astype(np.float32)


def normalize_pot(pot):
    pot = np.asarray(pot, dtype=np.float32).reshape(-1)
    if not np.isfinite(pot).all():
        raise ValueError("POT contains nan or inf")
    max_seen = float(np.max(np.abs(pot))) if pot.size else 0.0
    denom = 4095.0 if max_seen > 120.0 else POT_MAX
    return np.clip(pot / denom, 0.0, 1.0).astype(np.float32)


def prepare_model_tensor(capture, target_length):
    arr = np.asarray(capture, dtype=np.float32)
    if arr.ndim != 2 or arr.shape[1] != 2:
        raise ValueError("expected capture array with shape (samples, 2)")
    emg = resize_1d(normalize_emg(arr[:, 0]), target_length)
    pot = resize_1d(normalize_pot(arr[:, 1]), target_length)
    return np.stack([emg, pot], axis=0).astype(np.float32)
