from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    songs: Mapped[list["Song"]] = relationship(back_populates="project", cascade="all,delete")


class Song(Base):
    __tablename__ = "songs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(1024))
    original_filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    project: Mapped["Project"] = relationship(back_populates="songs")
    stems: Mapped[list["Stem"]] = relationship(back_populates="song", cascade="all,delete")
    processing_jobs: Mapped[list["ProcessingJob"]] = relationship(back_populates="song", cascade="all,delete")
    chart_edits: Mapped[list["ChartEdit"]] = relationship(back_populates="song", cascade="all,delete")
    charts: Mapped[list["Chart"]] = relationship(back_populates="song", cascade="all,delete")


class Stem(Base):
    __tablename__ = "stems"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id"), index=True)
    stem_type: Mapped[str] = mapped_column(String(50))
    file_path: Mapped[str] = mapped_column(String(1024))
    status: Mapped[str] = mapped_column(String(50), default="pending")

    song: Mapped["Song"] = relationship(back_populates="stems")
    charts: Mapped[list["Chart"]] = relationship(back_populates="stem", cascade="all,delete")


class ProcessingJob(Base):
    __tablename__ = "processing_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id"), index=True)
    job_type: Mapped[str] = mapped_column(String(100), default="placeholder_transcription")
    status: Mapped[str] = mapped_column(String(50), default="queued")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    song: Mapped["Song"] = relationship(back_populates="processing_jobs")


class ChartEdit(Base):
    __tablename__ = "chart_edits"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id"), index=True)
    chart_type: Mapped[str] = mapped_column(String(50), default="chord")
    version: Mapped[int] = mapped_column(Integer, default=1)
    chart_data: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    song: Mapped["Song"] = relationship(back_populates="chart_edits")


class Chart(Base):
    """Structured chart model — source of truth for MusicXML generation."""

    __tablename__ = "charts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    song_id: Mapped[int] = mapped_column(ForeignKey("songs.id"), index=True)
    # Optional link to the specific stem this chart was derived from
    stem_id: Mapped[int | None] = mapped_column(ForeignKey("stems.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(255), default="Untitled Chart")
    tempo: Mapped[int] = mapped_column(Integer, default=120)
    key_sig: Mapped[str] = mapped_column(String(10), default="C")
    time_sig: Mapped[str] = mapped_column(String(10), default="4/4")
    # "pending" | "generated" | "user_edited"
    status: Mapped[str] = mapped_column(String(50), default="generated")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    song: Mapped["Song"] = relationship(back_populates="charts")
    stem: Mapped["Stem | None"] = relationship(back_populates="charts")
    measures: Mapped[list["ChartMeasure"]] = relationship(
        back_populates="chart", cascade="all,delete", order_by="ChartMeasure.measure_number"
    )
    exports: Mapped[list["Export"]] = relationship(back_populates="chart", cascade="all,delete")


class ChartMeasure(Base):
    """One measure within a chart."""

    __tablename__ = "chart_measures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    chart_id: Mapped[int] = mapped_column(ForeignKey("charts.id"), index=True)
    measure_number: Mapped[int] = mapped_column(Integer)
    chord_symbol: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Override time sig for this measure only (e.g. "3/4"); null = inherit from chart
    time_sig_override: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # Chord analysis metadata (populated by ChordChartEngine)
    chord_confidence: Mapped[float | None] = mapped_column("chord_confidence", nullable=True)
    # JSON list of [[chord, score], ...] for top alternative candidates
    chord_alternatives: Mapped[str | None] = mapped_column(Text, nullable=True)

    chart: Mapped["Chart"] = relationship(back_populates="measures")
    notes: Mapped[list["ChartNote"]] = relationship(
        back_populates="measure", cascade="all,delete", order_by="ChartNote.position"
    )


class ChartNote(Base):
    """One note or rest within a measure."""

    __tablename__ = "chart_notes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    measure_id: Mapped[int] = mapped_column(ForeignKey("chart_measures.id"), index=True)
    # position within the measure (16th-note grid offset, 0 = beat 1)
    position: Mapped[int] = mapped_column(Integer, default=0)
    # "C4", "D#3", etc. for pitched notes; ignored when is_rest=True
    pitch: Mapped[str] = mapped_column(String(10), default="C4")
    # "whole" | "half" | "quarter" | "eighth" | "16th"
    duration: Mapped[str] = mapped_column(String(20), default="quarter")
    is_rest: Mapped[bool] = mapped_column(Boolean, default=False)
    # MIDI velocity (0-127); None for chord-only charts
    velocity: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)

    measure: Mapped["ChartMeasure"] = relationship(back_populates="notes")


class Export(Base):
    """Tracks generated file exports (e.g. MusicXML) for a chart."""

    __tablename__ = "exports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    chart_id: Mapped[int] = mapped_column(ForeignKey("charts.id"), index=True)
    # "musicxml"
    format: Mapped[str] = mapped_column(String(50), default="musicxml")
    file_path: Mapped[str] = mapped_column(String(1024))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    chart: Mapped["Chart"] = relationship(back_populates="exports")
