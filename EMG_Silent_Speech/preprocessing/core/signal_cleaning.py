import numpy as np


def validate_signal(signal):
    signal = np.asarray(signal, dtype=np.float32)

    if signal.ndim != 1:
        raise ValueError("Expected a 1D signal")

    if signal.size == 0:
        raise ValueError("Signal is empty")

    if np.isnan(signal).any():
        raise ValueError("Signal contains NaN values")

    if np.isinf(signal).any():
        raise ValueError("Signal contains inf values")

    return signal


def remove_offset(signal):
    signal = validate_signal(signal)
    return signal - np.mean(signal)


def normalize_signal(signal, mode="zscore"):
    signal = validate_signal(signal)

    if mode == "none":
        return signal.copy()

    if mode == "zscore":
        std = float(np.std(signal))
        if std == 0:
            return np.zeros_like(signal)
        return (signal - np.mean(signal)) / std

    if mode == "minmax":
        min_value = float(np.min(signal))
        max_value = float(np.max(signal))
        value_range = max_value - min_value
        if value_range == 0:
            return np.zeros_like(signal)
        return (signal - min_value) / value_range

    raise ValueError(f"Unsupported normalization mode: {mode}")
