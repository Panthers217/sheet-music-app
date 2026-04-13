import os
import shutil
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.db import SessionLocal, get_db
from app.models import Chart, ChartEdit, ChartMeasure, ChartNote, Export, ProcessingJob, Project, Song, Stem
from app.schemas import (
    ChartEditResponse,
    ChartEditUpdate,
    ChartMeasureUpdate,
    ChartMetadataUpdate,
    ChartResponse,
    ProjectCreate,
    ProjectResponse,
    ProjectUpdate,
)
from app.services.chart.builder import ChartBuilder
from app.services.musicxml.generator import MusicXMLGenerator
from app.services.processing import PlaceholderProcessingPipeline
from app.services.storage import paths as storage
from app.services.transcription.chord_chart import CHROMA_METHODS, ChordChartEngine, ChromaConfig

router = APIRouter(prefix="/api")
pipeline = PlaceholderProcessingPipeline()
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_AUDIO_MIME_TYPES = {"audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"}
ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav"}
_xml_generator = MusicXMLGenerator()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/projects", response_model=ProjectResponse)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db)) -> Project:
    project = Project(name=payload.name, description=payload.description)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects", response_model=list[ProjectResponse])
def list_projects(db: Session = Depends(get_db)) -> list[Project]:
    return db.query(Project).order_by(Project.created_at.desc()).all()


@router.put("/projects/{project_id}", response_model=ProjectResponse)
def update_project(project_id: int, payload: ProjectUpdate, db: Session = Depends(get_db)) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.name = payload.name
    project.description = payload.description
    db.commit()
    db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=204)
def delete_project(project_id: int, db: Session = Depends(get_db)) -> None:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()
    project_dir = UPLOAD_DIR / str(project_id)
    if project_dir.is_dir():
        shutil.rmtree(project_dir)


@router.get("/projects/{project_id}")
def get_project(project_id: int, db: Session = Depends(get_db)) -> dict:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    songs = []
    for song in project.songs:
        chart = db.query(ChartEdit).filter(ChartEdit.song_id == song.id).order_by(ChartEdit.id.desc()).first()
        stems = [
            {
                "id": stem.id,
                "stem_type": stem.stem_type,
                "file_path": stem.file_path,
                "status": stem.status,
            }
            for stem in sorted(song.stems, key=lambda s: s.id)
        ]
        songs.append(
            {
                "id": song.id,
                "title": song.title,
                "original_filename": song.original_filename,
                "created_at": song.created_at,
                "stems": stems,
                "chart": ChartEditResponse.model_validate(chart).model_dump() if chart else None,
            }
        )

    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "songs": songs,
        "created_at": project.created_at,
    }


def _run_processing_background(song_id: int) -> None:
    """Run the processing pipeline in a background task with its own DB session."""
    db = SessionLocal()
    try:
        song = db.query(Song).filter(Song.id == song_id).first()
        if not song:
            return
        job = db.query(ProcessingJob).filter(ProcessingJob.song_id == song_id).order_by(ProcessingJob.id.desc()).first()
        if not job:
            return
        pipeline.run_processing(db=db, song=song, job=job)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


@router.post("/projects/{project_id}/upload")
def upload_song(
    project_id: int,
    background_tasks: BackgroundTasks,
    title: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> dict:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    filename = file.filename or ""
    file_ext = Path(filename).suffix.lower()
    content_type = (file.content_type or "").lower()
    is_supported_upload = file_ext in ALLOWED_AUDIO_EXTENSIONS or content_type in ALLOWED_AUDIO_MIME_TYPES
    if not is_supported_upload:
        raise HTTPException(status_code=400, detail="Only MP3 and WAV uploads are supported")

    project_upload_dir = UPLOAD_DIR / str(project_id)
    project_upload_dir.mkdir(parents=True, exist_ok=True)
    destination = project_upload_dir / filename

    with destination.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    song = Song(
        project_id=project_id,
        title=title,
        file_path=str(destination),
        original_filename=filename,
        mime_type=file.content_type or "application/octet-stream",
    )
    db.add(song)
    db.flush()

    job = pipeline.enqueue_song_processing_async(db=db, song=song)

    db.commit()
    db.refresh(song)

    background_tasks.add_task(_run_processing_background, song.id)

    return {"song_id": song.id, "processing_job_id": job.id, "status": job.status}


@router.get("/jobs/{job_id}")
def get_job_status(job_id: int, db: Session = Depends(get_db)) -> dict:
    job = db.query(ProcessingJob).filter(ProcessingJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job.id, "status": job.status, "job_type": job.job_type}


@router.post("/songs/{song_id}/reprocess")
def reprocess_song(song_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)) -> dict:
    song = db.query(Song).filter(Song.id == song_id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if not Path(song.file_path).exists():
        raise HTTPException(status_code=400, detail="Audio file not found on disk")

    job = pipeline.enqueue_song_processing_async(db=db, song=song)
    db.commit()
    background_tasks.add_task(_run_processing_background, song.id)
    return {"song_id": song.id, "processing_job_id": job.id, "status": job.status}


@router.put("/charts/{chart_id}", response_model=ChartEditResponse)
def update_chart(chart_id: int, payload: ChartEditUpdate, db: Session = Depends(get_db)) -> ChartEdit:
    chart = db.query(ChartEdit).filter(ChartEdit.id == chart_id).first()
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")

    chart.version += 1
    chart.chart_data = payload.chart_data
    db.commit()
    db.refresh(chart)
    return chart


# ---------------------------------------------------------------------------
# Structured chart endpoints
# ---------------------------------------------------------------------------


@router.post("/songs/{song_id}/charts", response_model=ChartResponse)
def create_chart(
    song_id: int,
    harmonic_stem: str = "preferred",
    chroma_method: str = "cqt",
    db: Session = Depends(get_db),
) -> Chart:
    """
    Generate a new structured chart for a song using ChordChartEngine.

    Query parameters:
    - **harmonic_stem**: audio source for chroma extraction.
      `"preferred"` (default) tries the *other* Demucs stem, then *vocals*,
      then falls back to the full mix.  Pass `"mix"` to always use the mix,
      or a specific stem name (`"other"`, `"vocals"`, `"bass"`, `"drums"`).
    - **chroma_method**: `"cqt"` (default) | `"stft"` | `"cens"`.

    Beat tracking always runs on the original mix for reliability.
    Returns the saved Chart entity with per-measure confidence scores.
    """
    song = db.query(Song).filter(Song.id == song_id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    audio_path = Path(song.file_path)
    if not audio_path.exists():
        raise HTTPException(status_code=400, detail="Audio file not found on disk")

    if chroma_method not in CHROMA_METHODS:
        raise HTTPException(
            status_code=422,
            detail=f"chroma_method must be one of {list(CHROMA_METHODS)}",
        )

    config = ChromaConfig(method=chroma_method, harmonic_stem=harmonic_stem)
    engine = ChordChartEngine(config)
    result = engine.analyze(audio_path, title=song.title)

    builder = ChartBuilder(db)
    chart = builder.create_from_score(
        song_id=song.id,
        score=result.score,
        analyses=result.measure_analyses,
    )

    db.commit()
    db.refresh(chart)
    return chart


@router.get("/charts/{chart_id}", response_model=ChartResponse)
def get_chart(chart_id: int, db: Session = Depends(get_db)) -> Chart:
    chart = db.query(Chart).filter(Chart.id == chart_id).first()
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")
    return chart


@router.patch("/charts/{chart_id}", response_model=ChartResponse)
def update_chart_metadata(
    chart_id: int, payload: ChartMetadataUpdate, db: Session = Depends(get_db)
) -> Chart:
    """Update title, tempo, key_sig, or time_sig without touching measures."""
    chart = db.query(Chart).filter(Chart.id == chart_id).first()
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")

    if payload.title is not None:
        chart.title = payload.title
    if payload.tempo is not None:
        chart.tempo = payload.tempo
    if payload.key_sig is not None:
        chart.key_sig = payload.key_sig
    if payload.time_sig is not None:
        chart.time_sig = payload.time_sig
    chart.status = "user_edited"

    db.commit()
    db.refresh(chart)
    return chart


@router.patch("/charts/{chart_id}/measures/{measure_id}", response_model=ChartResponse)
def update_chart_measure(
    chart_id: int,
    measure_id: int,
    payload: ChartMeasureUpdate,
    db: Session = Depends(get_db),
) -> Chart:
    """Update a single measure's chord symbol, time sig override, or notes."""
    chart = db.query(Chart).filter(Chart.id == chart_id).first()
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")

    measure = db.query(ChartMeasure).filter(
        ChartMeasure.id == measure_id, ChartMeasure.chart_id == chart_id
    ).first()
    if not measure:
        raise HTTPException(status_code=404, detail="Measure not found")

    if payload.chord_symbol is not None:
        measure.chord_symbol = payload.chord_symbol
    if payload.time_sig_override is not None:
        measure.time_sig_override = payload.time_sig_override

    if payload.notes is not None:
        # Replace all notes for this measure
        db.query(ChartNote).filter(ChartNote.measure_id == measure_id).delete()
        for n in payload.notes:
            db.add(
                ChartNote(
                    measure_id=measure_id,
                    position=n.position,
                    pitch=n.pitch,
                    duration=n.duration,
                    is_rest=n.is_rest,
                )
            )

    chart.status = "user_edited"
    db.commit()
    db.refresh(chart)
    return chart


@router.get("/charts/{chart_id}/musicxml")
def get_chart_musicxml(chart_id: int, db: Session = Depends(get_db)) -> Response:
    """
    Generate (or serve cached) MusicXML for a chart.
    Returns the raw XML with content-type application/xml.
    """
    chart = db.query(Chart).filter(Chart.id == chart_id).first()
    if not chart:
        raise HTTPException(status_code=404, detail="Chart not found")

    song = db.query(Song).filter(Song.id == chart.song_id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    # Re-hydrate score model from DB and generate MusicXML
    from app.services.chart.builder import ChartBuilder as CB

    score = CB(db).score_from_chart(chart)
    xml_str = _xml_generator.generate(score)

    # Persist the file next to stems
    xml_path = storage.musicxml_file_path(song.project_id, chart_id)
    xml_path.write_text(xml_str, encoding="utf-8")

    # Track export record (upsert by chart_id + format)
    export = db.query(Export).filter(Export.chart_id == chart_id, Export.format == "musicxml").first()
    if export:
        export.file_path = str(xml_path)
    else:
        db.add(Export(chart_id=chart_id, format="musicxml", file_path=str(xml_path)))
    db.commit()

    return Response(content=xml_str, media_type="application/xml")


@router.get("/songs/{song_id}/stems")
def list_stems(song_id: int, db: Session = Depends(get_db)) -> list[dict]:
    song = db.query(Song).filter(Song.id == song_id).first()
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return [
        {
            "id": s.id,
            "stem_type": s.stem_type,
            "file_path": s.file_path,
            "status": s.status,
        }
        for s in sorted(song.stems, key=lambda x: x.id)
    ]

