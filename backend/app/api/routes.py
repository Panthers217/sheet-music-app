import os
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import ChartEdit, Project, Song
from app.schemas import ChartEditResponse, ChartEditUpdate, ProjectCreate, ProjectResponse
from app.services.processing import PlaceholderProcessingPipeline

router = APIRouter(prefix="/api")
pipeline = PlaceholderProcessingPipeline()
UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_AUDIO_MIME_TYPES = {"audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"}
ALLOWED_AUDIO_EXTENSIONS = {".mp3", ".wav"}


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


@router.post("/projects/{project_id}/upload")
def upload_song(
    project_id: int,
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

    job = pipeline.enqueue_song_processing(db=db, song=song)

    db.commit()
    db.refresh(song)

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
