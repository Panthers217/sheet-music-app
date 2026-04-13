"""Utilities for working with stem files produced by Demucs."""

from pathlib import Path


STEM_TYPES = ["drums", "bass", "vocals", "other"]


def stem_output_dir(song_file_path: Path, model_name: str = "htdemucs") -> Path:
    """Return the directory where Demucs writes stems for a given song file."""
    return song_file_path.parent / "stems" / model_name / song_file_path.stem


def stem_file_path(song_file_path: Path, stem_type: str, model_name: str = "htdemucs") -> Path:
    """Return the expected .wav path for a specific stem."""
    return stem_output_dir(song_file_path, model_name) / f"{stem_type}.wav"


def completed_stems(song_file_path: Path, model_name: str = "htdemucs") -> dict[str, Path]:
    """
    Return a mapping of stem_type -> Path for stems that exist on disk.
    Only includes stems whose file is actually present.
    """
    result: dict[str, Path] = {}
    for stem_type in STEM_TYPES:
        p = stem_file_path(song_file_path, stem_type, model_name)
        if p.exists():
            result[stem_type] = p
    return result
