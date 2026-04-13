"""
Centralised path helpers for local file storage.

Directory layout under UPLOAD_DIR (default: ./uploads/):
  uploads/
    {project_id}/
      {original_filename}           ← original audio
      stems/
        htdemucs/
          {song_stem}/              ← demucs output
            drums.wav
            bass.wav
            vocals.wav
            other.wav
      generated/
        musicxml/
          chart_{chart_id}.xml      ← generated MusicXML exports

All paths are resolved relative to UPLOAD_DIR which is read once from the
UPLOAD_DIR environment variable.
"""

import os
from pathlib import Path

_UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))


def upload_dir() -> Path:
    return _UPLOAD_DIR


def project_dir(project_id: int) -> Path:
    return _UPLOAD_DIR / str(project_id)


def audio_file_path(project_id: int, filename: str) -> Path:
    return project_dir(project_id) / filename


def stems_dir(project_id: int, model_name: str = "htdemucs") -> Path:
    return project_dir(project_id) / "stems" / model_name


def musicxml_dir(project_id: int) -> Path:
    path = project_dir(project_id) / "generated" / "musicxml"
    path.mkdir(parents=True, exist_ok=True)
    return path


def musicxml_file_path(project_id: int, chart_id: int) -> Path:
    return musicxml_dir(project_id) / f"chart_{chart_id}.xml"
