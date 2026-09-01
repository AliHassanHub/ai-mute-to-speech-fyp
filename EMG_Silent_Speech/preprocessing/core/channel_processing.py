import numpy as np


def extract_emg_signal(signal, emg_column_index=1):
    """Return a 1D EMG signal from a 2D capture array."""
    signal = np.asarray(signal, dtype=np.float32)

    if signal.ndim != 2:
        raise ValueError("Expected a 2D signal array")

    if signal.shape[1] <= emg_column_index:
        raise ValueError("EMG column index is outside the available signal columns")

    return signal[:, emg_column_index].copy()


def extract_emg_and_pot(signal, emg_column_index=1, pot_column_index=3):
    """Return a (T, 2) array: [EMG, POT] using capture columns."""
    signal = np.asarray(signal, dtype=np.float32)
    if signal.ndim != 2:
        raise ValueError("Expected a 2D signal array")
    if signal.shape[1] <= max(emg_column_index, pot_column_index):
        raise ValueError("Column index is outside the available signal columns")

    emg = signal[:, emg_column_index].copy()
    pot = signal[:, pot_column_index].copy()
    return np.stack([emg, pot], axis=1).astype(np.float32)

