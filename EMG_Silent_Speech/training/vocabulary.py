"""Vocabulary definitions for the EMG silent-speech project.

Three separate vocabularies exist. Do not conflate them:

1. **Active calibrated vocabulary** — labels stored in the current
   ``calibrated_word_model*.npz`` artefact. This is what the live predictor
   and ``GET /health`` expose. It is discovered at runtime from the model file.

2. **Original SNN word bank** — the ten single-word labels used by the legacy
   CNN/SNN training pipeline. These are NOT automatically active in the
   calibrated prototype predictor.

3. **Sentence vocabulary** — multi-word phrases in ``training/labels.py``.
   Sentence inference is disabled in the calibrated hardware workflow.
"""

from training.labels import SENTENCE_LABELS

# Legacy single-word labels from the original SNN reference bank / dataset index.
# Presence here does NOT mean the word is supported by the calibrated predictor.
ORIGINAL_SNN_WORD_LABELS = (
    "Assistance",
    "Do",
    "Here",
    "Land",
    "Medical",
    "Need",
    "Not",
    "Pick",
    "Up",
    "Us",
)

# Verified production set at the time of vocabulary-extension work (2026-07-06 captures).
VERIFIED_CALIBRATED_LABELS_V1 = (
    "help",
    "no",
    "pain",
    "stop",
)

# Candidate words that may be added incrementally once real calibration captures
# exist under ``captures/<label>/``.
CANDIDATE_EXTENSION_LABELS = ORIGINAL_SNN_WORD_LABELS

__all__ = [
    "SENTENCE_LABELS",
    "ORIGINAL_SNN_WORD_LABELS",
    "VERIFIED_CALIBRATED_LABELS_V1",
    "CANDIDATE_EXTENSION_LABELS",
]
