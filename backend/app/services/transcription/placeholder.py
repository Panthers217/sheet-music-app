"""
Placeholder transcription engine.

Returns a minimal ScoreModel with empty (whole-rest) measures.
Replace this class with a real engine (e.g. basic-pitch, music21, etc.)
without changing any other layer — just swap the engine passed to ChartBuilder.

TODO: wire a real beat/chord detection library here.
"""

from pathlib import Path

from app.services.score.model import ScoreMeasure, ScoreModel, ScoreNote, ScorePart
from app.services.transcription.base import TranscriptionEngine

_DEFAULT_MEASURES = 8
_PLACEHOLDER_CHORDS = ["C", "Am", "F", "G", "C", "Am", "F", "G"]


class PlaceholderTranscriptionEngine(TranscriptionEngine):
    """
    Returns a simple 8-measure chart with whole-rests and placeholder chord symbols.
    All analysis fields (tempo, key, time_sig) use sensible defaults.
    """

    def transcribe(self, audio_path: Path, title: str = "Untitled") -> ScoreModel:
        measures: list[ScoreMeasure] = []
        for i in range(_DEFAULT_MEASURES):
            measures.append(
                ScoreMeasure(
                    number=i + 1,
                    chord_symbol=_PLACEHOLDER_CHORDS[i % len(_PLACEHOLDER_CHORDS)],
                    notes=[ScoreNote(pitch="C4", duration="whole", is_rest=True, position=0)],
                )
            )

        part = ScorePart(
            name="Piano",
            instrument="piano",
            clef="treble",
            measures=measures,
        )

        return ScoreModel(
            title=title,
            tempo=120,
            key="C",
            time_sig="4/4",
            parts=[part],
            source="placeholder",
        )
