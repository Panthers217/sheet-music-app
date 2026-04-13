"""
Internal score model.

This is the source of truth for chart data in the backend domain layer.
MusicXML (and any other export formats) are generated from this model.
DB entities (Chart / ChartMeasure / ChartNote) mirror this structure.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ScoreNote:
    """A single note or rest within a measure."""

    pitch: str = "C4"
    duration: str = "quarter"  # "whole" | "half" | "quarter" | "eighth" | "16th"
    is_rest: bool = False
    position: int = 0


@dataclass
class ScoreMeasure:
    """One measure."""

    number: int = 1
    chord_symbol: Optional[str] = None
    time_sig_override: Optional[str] = None  # overrides chart-level time_sig for this measure
    notes: list[ScoreNote] = field(default_factory=list)


@dataclass
class ScorePart:
    """One instrument/voice part."""

    name: str = "Piano"
    instrument: str = "piano"
    clef: str = "treble"  # "treble" | "bass"
    measures: list[ScoreMeasure] = field(default_factory=list)


@dataclass
class ScoreModel:
    """
    Top-level internal score model.

    This is built by the transcription/chart layer and passed to
    the MusicXML generator.  It is also persisted into the DB via
    Chart / ChartMeasure / ChartNote entities.
    """

    title: str = "Untitled"
    tempo: int = 120
    key: str = "C"  # e.g. "C", "G", "D", "F", "Bb"
    time_sig: str = "4/4"
    parts: list[ScorePart] = field(default_factory=list)
    # "placeholder" | "transcription" | "user_edit"
    source: str = "placeholder"
