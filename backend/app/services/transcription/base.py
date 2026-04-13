"""Abstract base class for transcription engines.

A transcription engine takes an audio file path and returns a ScoreModel.
Swap implementations here without touching any other layer.
"""

from abc import ABC, abstractmethod
from pathlib import Path

from app.services.score.model import ScoreModel


class TranscriptionEngine(ABC):
    """Base interface — all transcription engines must implement this."""

    @abstractmethod
    def transcribe(self, audio_path: Path, title: str = "Untitled") -> ScoreModel:
        """
        Analyse audio_path and return a ScoreModel populated with whatever
        data the engine can extract (tempo, key, chords, notes, etc.).
        """
        ...
