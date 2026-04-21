from datetime import datetime

import json
from pydantic import BaseModel, field_validator


class ProjectCreate(BaseModel):
    name: str
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str
    description: str | None = None


class ProjectResponse(BaseModel):
    id: int
    name: str
    description: str | None
    created_at: datetime

    class Config:
        from_attributes = True


class ChartEditUpdate(BaseModel):
    chart_data: str


class ChartEditResponse(BaseModel):
    id: int
    song_id: int
    chart_type: str
    version: int
    chart_data: str

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Structured chart schemas (Chart / ChartMeasure / ChartNote)
# ---------------------------------------------------------------------------


class ChartNoteResponse(BaseModel):
    id: int
    measure_id: int
    position: int
    pitch: str
    duration: str
    is_rest: bool
    velocity: int | None = None
    # Absolute playback timings from MIDI transcription; None for chord-only charts
    start_time_s: float | None = None
    end_time_s: float | None = None
    # Quantized notation fields for score display
    notation_position: int | None = None
    notation_duration: str | None = None
    # User-overridden stem direction
    stem_direction: str | None = None
    # Notation extras
    articulation: str | None = None
    dynamic: str | None = None
    notehead_type: str | None = None
    tremolo: int | None = None
    tied_to_next: bool | None = None
    slur: str | None = None
    arpeggio: bool | None = None
    ottava: str | None = None

    class Config:
        from_attributes = True


class ChartNoteUpdate(BaseModel):
    position: int
    pitch: str = "C4"
    duration: str = "quarter"
    is_rest: bool = False
    stem_direction: str | None = None
    articulation: str | None = None
    dynamic: str | None = None
    notehead_type: str | None = None
    tremolo: int | None = None
    tied_to_next: bool | None = None
    slur: str | None = None
    arpeggio: bool | None = None
    ottava: str | None = None


class ChartMeasureResponse(BaseModel):
    id: int
    chart_id: int
    measure_number: int
    chord_symbol: str | None
    time_sig_override: str | None
    notes: list[ChartNoteResponse] = []
    # Chord analysis metadata
    chord_confidence: float | None = None
    # Stored as JSON string in DB; parsed to list of [chord, score] pairs here
    chord_alternatives: list[list] | None = None
    # Repeat barlines and navigation markers
    repeat_start: bool | None = None
    repeat_end: bool | None = None
    repeat_both: bool | None = None
    segno: bool | None = None
    coda: bool | None = None
    fine: bool | None = None
    navigation: str | None = None
    volta: str | None = None

    @field_validator("chord_alternatives", mode="before")
    @classmethod
    def parse_alternatives(cls, v: object) -> list[list] | None:
        if isinstance(v, str):
            try:
                return json.loads(v)
            except Exception:
                return None
        return v  # type: ignore[return-value]

    class Config:
        from_attributes = True


class ChartMeasureUpdate(BaseModel):
    chord_symbol: str | None = None
    time_sig_override: str | None = None
    notes: list[ChartNoteUpdate] | None = None
    # Repeat barlines and navigation markers
    repeat_start: bool | None = None
    repeat_end: bool | None = None
    repeat_both: bool | None = None
    segno: bool | None = None
    coda: bool | None = None
    fine: bool | None = None
    navigation: str | None = None
    volta: str | None = None


class ChartResponse(BaseModel):
    id: int
    song_id: int
    stem_id: int | None
    title: str
    tempo: int
    key_sig: str
    time_sig: str
    status: str
    clef: str | None = None
    measures: list[ChartMeasureResponse] = []

    class Config:
        from_attributes = True


class ChartMetadataUpdate(BaseModel):
    title: str | None = None
    tempo: int | None = None
    key_sig: str | None = None
    time_sig: str | None = None
    clef: str | None = None


# ---------------------------------------------------------------------------
# MIDI transcription schemas
# ---------------------------------------------------------------------------


class MidiTranscribeResponse(BaseModel):
    """Returned by POST /api/songs/{id}/midi after a successful transcription."""

    chart_id: int
    song_id: int
    stem_used: str
    note_count: int
    measure_count: int
    tempo_bpm: float
    midi_url: str  # e.g. /api/charts/{chart_id}/midi


class NoteDetail(BaseModel):
    """A single note as returned by GET /api/charts/{id}/notes."""

    id: int
    measure_number: int
    position: int
    pitch: str
    duration: str
    is_rest: bool
    velocity: int | None

    class Config:
        from_attributes = True
