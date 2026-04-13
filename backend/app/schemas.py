from datetime import datetime

from pydantic import BaseModel


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

    class Config:
        from_attributes = True


class ChartNoteUpdate(BaseModel):
    position: int
    pitch: str = "C4"
    duration: str = "quarter"
    is_rest: bool = False


class ChartMeasureResponse(BaseModel):
    id: int
    chart_id: int
    measure_number: int
    chord_symbol: str | None
    time_sig_override: str | None
    notes: list[ChartNoteResponse] = []

    class Config:
        from_attributes = True


class ChartMeasureUpdate(BaseModel):
    chord_symbol: str | None = None
    time_sig_override: str | None = None
    notes: list[ChartNoteUpdate] | None = None


class ChartResponse(BaseModel):
    id: int
    song_id: int
    stem_id: int | None
    title: str
    tempo: int
    key_sig: str
    time_sig: str
    status: str
    measures: list[ChartMeasureResponse] = []

    class Config:
        from_attributes = True


class ChartMetadataUpdate(BaseModel):
    title: str | None = None
    tempo: int | None = None
    key_sig: str | None = None
    time_sig: str | None = None
