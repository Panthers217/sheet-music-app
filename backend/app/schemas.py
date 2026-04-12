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
