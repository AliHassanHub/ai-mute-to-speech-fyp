"""Batch word capture using the existing esp32_capture primitives.

Does not replace ``python ai.py add``; it reuses ``capture_window`` so the saved
file format and POT-lock semantics stay identical.
"""

from __future__ import annotations

import statistics
import sys
import time
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parents[1]
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from runtime.esp32_capture import (  # noqa: E402
    CAPTURES_DIR,
    DEFAULT_BAUD,
    DEFAULT_STARTUP_WAIT,
    capture_window,
    open_serial,
    reset_board,
)
from runtime.signal_io import parse_capture_pair  # noqa: E402


def measure_locked_pot(ser, seconds=3.0):
    pots = []
    emgs = []
    started = time.time()
    while time.time() - started < seconds:
        raw = ser.readline()
        if not raw:
            continue
        pair = parse_capture_pair(raw.decode("ascii", errors="ignore"))
        if pair is None:
            continue
        emg, pot = pair
        emgs.append(emg)
        pots.append(pot)
    if not pots:
        raise RuntimeError("no EMG/POT rows received on serial — is the ESP32 on USB and not exclusively on BLE?")
    return float(statistics.median(pots)), len(emgs)


def main():
    label = sys.argv[1] if len(sys.argv) > 1 else "Assistance"
    port = sys.argv[2] if len(sys.argv) > 2 else "COM3"
    count = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    seconds = float(sys.argv[4]) if len(sys.argv) > 4 else 16.0

    print(f"Batch capture label={label} port={port} takes={count} seconds={seconds}")
    print("Perform the silent articulation when each take starts.", flush=True)

    saved = []
    with open_serial(port, DEFAULT_BAUD) as ser:
        reset_board(ser, DEFAULT_STARTUP_WAIT)
        locked_pot, probe_rows = measure_locked_pot(ser)
        print(f"Probe rows={probe_rows} locked_pot={locked_pot:.1f}", flush=True)

        for index in range(count):
            print(f"\n=== Take {index + 1}/{count} ===", flush=True)
            path = capture_window(ser, label, seconds, CAPTURES_DIR, locked_pot)
            if path is None:
                print("Take failed (too few samples).", flush=True)
                continue
            saved.append(path)

    print(f"\nSaved {len(saved)} capture file(s) under {CAPTURES_DIR / label}")
    for path in saved:
        print(path)


if __name__ == "__main__":
    main()
