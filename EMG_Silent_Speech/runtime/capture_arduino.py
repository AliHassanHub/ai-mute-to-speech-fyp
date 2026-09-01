import argparse
import re
import sys
import time
from pathlib import Path

try:
    import serial
    from serial import SerialException
    from serial.tools import list_ports
except ImportError:
    serial = None
    SerialException = Exception
    list_ports = None

LEGACY_SIG = re.compile(r"^SIG,(-?\d+(?:\.\d+)?),.*src=(EMG|POT)", re.IGNORECASE)
SENSOR_PAIR_RE = re.compile(r"\bEMG\s*:\s*(-?\d+(?:\.\d+)?)\b.*\bPOT\s*:\s*(-?\d+(?:\.\d+)?)\b", re.IGNORECASE)
PREFERRED_PORT_KEYWORDS = (
    "ESP32",
    "CH910",
    "CH340",
    "USB-Enhanced-SERIAL",
    "USB-SERIAL",
    "USB Serial",
    "wch.cn",
    "Bluetooth",
    "CP210",
    "FTDI",
    "Arduino",
)
AVOID_PORT_KEYWORDS = ("Intel(R) Active Management", " AMT", " SOL ")


def normalize_argv(argv):
    fixed = []
    for arg in argv:
        if arg.startswith("--list-portspython"):
            fixed.append("--list-ports")
        elif arg.startswith("--probepython"):
            fixed.append("--probe")
        elif arg.startswith("--helppython"):
            fixed.append("--help")
        else:
            fixed.append(arg)
    return fixed


def parse_args():
    parser = argparse.ArgumentParser(description="Capture EMG/POT serial data from an ESP32 or other serial device for the AI pipeline.")
    parser.add_argument("--port", help="Serial port, for example COM7")
    parser.add_argument("--label", default="capture", help="Word or sentence label being recorded")
    parser.add_argument("--seconds", type=float, default=3.0, help="Capture duration")
    parser.add_argument("--baud", type=int, default=115200, help="Serial baud rate. Current project default is 115200.")
    parser.add_argument("--out-dir", default="captures", help="Folder for saved txt files")
    parser.add_argument("--startup-wait", type=float, default=2.5, help="Seconds to wait after opening the port")
    parser.add_argument("--first-row-timeout", type=float, default=8.0, help="Seconds to wait for the first valid signal row before capture timing starts")
    parser.add_argument("--debug", action="store_true", help="Print limited non-data serial lines while capturing")
    parser.add_argument("--list-ports", action="store_true", help="Show available serial ports and exit")
    parser.add_argument("--probe", action="store_true", help="Read raw serial data only; useful to test the output")
    parser.add_argument("--no-reset", action="store_true", help="Do not toggle DTR reset after opening the port")
    argv = normalize_argv(sys.argv[1:])
    if "--list-ports" in argv:
        argv = ["--list-ports"]
    return parser.parse_args(argv)


def safe_name(text):
    clean = []
    for ch in text.strip():
        if ch.isalnum() or ch in ("-", "_"):
            clean.append(ch)
        elif ch.isspace():
            clean.append("_")
    return "".join(clean) or "label"


def parse_signal_line(line, sample_index):
    text = line.strip()
    parts = text.split(";")
    if len(parts) == 5:
        try:
            values = [float(value) for value in parts]
        except ValueError:
            values = None
        if values is not None:
            return ";".join(str(int(value)) if float(value).is_integer() else str(value) for value in values)

    pair = SENSOR_PAIR_RE.search(text)
    if pair:
        emg = int(float(pair.group(1)))
        pot = int(float(pair.group(2)))
        return f"{sample_index};{emg};{emg};{pot};0"

    match = LEGACY_SIG.match(text)
    if match:
        signal = int(float(match.group(1)))
        source = 0 if match.group(2).upper() == "EMG" else 1
        emg = signal if source == 0 else 0
        pot = signal if source == 1 else 0
        return f"{sample_index};{signal};{emg};{pot};{source}"

    try:
        value = int(float(text))
    except ValueError:
        return None
    return f"{sample_index};{value};{value};0;0"


def available_ports():
    if list_ports is None:
        return []
    return list(list_ports.comports())


def show_ports():
    ports = available_ports()
    if not ports:
        print("No serial ports found. Connect the board and try again.", flush=True)
        return
    print("Available serial ports:", flush=True)
    for port in ports:
        text = f"  {port.device}"
        if port.description:
            text += f"  -  {port.description}"
        print(text, flush=True)


def choose_port():
    ports = available_ports()
    if not ports:
        return None

    def description(port):
        return f" {port.device} {port.description} {port.manufacturer} {port.hwid} ".lower()

    def should_avoid(port):
        desc = description(port)
        return any(keyword.lower() in desc for keyword in AVOID_PORT_KEYWORDS)

    for keyword in PREFERRED_PORT_KEYWORDS:
        for port in ports:
            if not should_avoid(port) and keyword.lower() in description(port):
                return port.device

    for port in ports:
        if not should_avoid(port):
            return port.device

    return ports[0].device


def open_serial(port, baud):
    return serial.Serial(
        port=port,
        baudrate=baud,
        timeout=0.1,
        write_timeout=1,
        dsrdtr=False,
        rtscts=False,
    )


def reset_board(ser, wait_seconds):
    ser.setDTR(False)
    time.sleep(0.15)
    ser.reset_input_buffer()
    ser.setDTR(True)
    time.sleep(max(0.0, wait_seconds))
    ser.reset_input_buffer()


def printable_preview(data, limit=120):
    if isinstance(data, bytes):
        text = data.decode("ascii", errors="replace")
    else:
        text = str(data)
    out = []
    for ch in text[:limit]:
        if ch.isprintable() or ch in "\r\n\t":
            out.append(ch)
        else:
            out.append("?")
    return "".join(out).replace("\r", "\\r").replace("\n", "\\n")


def ensure_port(args):
    if args.port:
        return args.port
    chosen = choose_port()
    if not chosen:
        print("Missing --port and no serial ports were found.", flush=True)
        print("Run: python runtime/capture_arduino.py --list-ports", flush=True)
        raise SystemExit(1)
    print(f"Auto-selected port: {chosen}", flush=True)
    return chosen


def run_probe(args):
    args.port = ensure_port(args)
    print(f"Probing {args.port} at {args.baud} baud for {args.seconds:.1f}s...", flush=True)
    try:
        with open_serial(args.port, args.baud) as ser:
            if not args.no_reset:
                print("Resetting the board over serial DTR...", flush=True)
                reset_board(ser, args.startup_wait)
            else:
                time.sleep(args.startup_wait)
                ser.reset_input_buffer()

            started = time.time()
            total_bytes = 0
            lines = 0
            parsed = 0
            previews = []
            sample_index = 0
            while time.time() - started < args.seconds:
                chunk = ser.readline()
                if not chunk:
                    continue
                total_bytes += len(chunk)
                lines += 1
                text = chunk.decode("ascii", errors="ignore").strip()
                if parse_signal_line(text, sample_index) is not None:
                    parsed += 1
                    sample_index += 1
                if len(previews) < 12:
                    previews.append(printable_preview(chunk))
            print(f"Probe result: bytes={total_bytes}, lines={lines}, parseable_rows={parsed}", flush=True)
            for i, line in enumerate(previews, start=1):
                print(f"  [{i}] {line}", flush=True)
            if total_bytes == 0:
                print("No serial data received at all. Check upload, board, cable, and port.", flush=True)
            elif parsed == 0:
                print("Serial data arrived, but it is not in supported AI format. Try baud 9600 or upload the latest sketch.", flush=True)
    except SerialException as exc:
        print(f"Probe failed: {exc}", flush=True)
        print("Close Serial Monitor/Plotter and retry.", flush=True)
        raise SystemExit(1)


def run_capture(args):
    args.port = ensure_port(args)
    out_dir = Path(args.out_dir) / safe_name(args.label)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    out_path = out_dir / f"{safe_name(args.label)}_{stamp}.txt"

    print(f"Opening {args.port} at {args.baud} baud...", flush=True)
    try:
        ser = open_serial(args.port, args.baud)
    except SerialException as exc:
        print(f"Could not open {args.port}: {exc}", flush=True)
        print("Close Serial Monitor/Serial Plotter and any other app using this COM port.", flush=True)
        raise SystemExit(1)

    rows = []
    ignored = 0
    printed_ignored = 0
    legacy_rows = 0
    pot_locked = False
    locked_pot_value = None

    try:
        with ser:
            if not args.no_reset:
                print("Port opened. Resetting the board over serial DTR...", flush=True)
                reset_board(ser, args.startup_wait)
            else:
                print("Port opened. Waiting without reset...", flush=True)
                time.sleep(args.startup_wait)
                ser.reset_input_buffer()

            wait_started = time.time()
            next_status = wait_started + 1.0
            capture_started = None

            print("Adjust potentiometer now. Press Enter ONCE to lock POT and start timed capture.", flush=True)

            while True:
                now = time.time()

                if now >= next_status:
                    if capture_started is None:
                        if locked_pot_value is None:
                            print(f"Waiting for POT/EMG stream... locked_pot=none waited={now - wait_started:.1f}s", flush=True)
                        else:
                            print(f"Waiting for Enter... locked_pot={locked_pot_value} waited={now - wait_started:.1f}s", flush=True)
                    else:
                        remaining = max(0.0, args.seconds - (now - capture_started))
                        print(f"Reading... samples={len(rows)} remaining={remaining:.1f}s", flush=True)
                    next_status = now + 1.0

                raw_bytes = ser.readline()
                if not raw_bytes:
                    continue
                raw = raw_bytes.decode("ascii", errors="ignore").strip()
                parsed = parse_signal_line(raw, len(rows))
                if parsed is not None:
                    parts = parsed.split(";")
                    if len(parts) >= 4:
                        try:
                            current_pot = int(float(parts[3]))
                        except Exception:
                            current_pot = None
                    else:
                        current_pot = None

                    if capture_started is None:
                        if current_pot is not None:
                            locked_pot_value = current_pot

                        if not pot_locked:
                            try:
                                import msvcrt
                                if msvcrt.kbhit():
                                    ch = msvcrt.getwch()
                                    if ch == "\r":
                                        pot_locked = True
                                        ser.reset_input_buffer()
                                        time.sleep(0.15)
                                        capture_started = time.time()
                                        print(f"POT locked at {locked_pot_value}. Starting timed capture...", flush=True)
                            except Exception:
                                pass
                        continue

                    rows.append(parsed)
                    if raw.upper().startswith("SIG,"):
                        legacy_rows += 1
                    if len(rows) % 100 == 0:
                        print(f"captured {len(rows)} samples", flush=True)

                    if now - capture_started >= args.seconds:
                        break
                else:
                    ignored += 1
                    if args.debug and printed_ignored < 12:
                        print("ignored:", printable_preview(raw), flush=True)
                        printed_ignored += 1
    except SerialException as exc:
        print(f"Serial communication failed: {exc}", flush=True)
        print("Unplug/replug the board, close Serial Monitor, and retry.", flush=True)
        raise SystemExit(1)
    except KeyboardInterrupt:
        print("Capture cancelled by user.", flush=True)
        raise SystemExit(1)

    if not rows:
        print("No numeric samples captured.", flush=True)
        print(f"Ignored non-data/garbled lines: {ignored}", flush=True)
        print("Try:", flush=True)
        print(f"  python runtime/capture_arduino.py --port {args.port} --baud 9600 --probe --seconds 5 --debug", flush=True)
        raise SystemExit(1)

    out_path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(f"Saved {len(rows)} real samples to {out_path}", flush=True)
    if legacy_rows:
        print(f"Converted {legacy_rows} legacy SIG rows into AI-compatible rows.", flush=True)
    if ignored:
        print(f"Ignored {ignored} non-data/header/garbled lines.", flush=True)
    print("Use this file with runtime/predict.py or runtime/calibrate.py", flush=True)


def main():
    args = parse_args()
    if serial is None:
        print("pyserial is required. Install with: python -m pip install pyserial", flush=True)
        raise SystemExit(1)
    if args.list_ports:
        show_ports()
    elif args.probe:
        run_probe(args)
    else:
        run_capture(args)


if __name__ == "__main__":
    main()

