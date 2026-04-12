import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy.orm import Session

from app.models import ChartEdit, ProcessingJob, Song, Stem

DEFAULT_STEMS = ["drums", "bass", "vocals", "other"]
DEFAULT_CHART = """{
  \"sections\": [
    {\"name\": \"Verse\", \"chords\": \"| C | G | Am | F |\"}
  ],
  \"notes\": \"Placeholder generated chart. Edit freely.\"
}"""


class PlaceholderProcessingPipeline:
    """Runs Demucs stem separation and seeds initial chart data for uploaded songs."""

    def _run_demucs(self, input_path: Path, output_root: Path) -> Path:
        model_name = os.getenv("DEMUCS_MODEL", "htdemucs")
        command = [
            sys.executable,
            "-m",
            "demucs.separate",
            "-n",
            model_name,
            "-o",
            str(output_root),
            str(input_path),
        ]
        subprocess.run(command, check=True, capture_output=True, text=True)
        return output_root / model_name / input_path.stem

    def _seed_chart_if_missing(self, db: Session, song: Song) -> None:
        existing_chart = db.query(ChartEdit).filter(ChartEdit.song_id == song.id).first()
        if existing_chart:
            return

        db.add(
            ChartEdit(
                song_id=song.id,
                chart_type="chord",
                version=1,
                chart_data=DEFAULT_CHART,
            )
        )

    def enqueue_song_processing(self, db: Session, song: Song) -> ProcessingJob:
        job = ProcessingJob(song_id=song.id, job_type="stem_split_and_chart_seed", status="queued")
        db.add(job)
        db.flush()

        self._seed_chart_if_missing(db=db, song=song)

        song_path = Path(song.file_path)
        output_root = song_path.parent / "stems"
        output_root.mkdir(parents=True, exist_ok=True)

        db.query(Stem).filter(Stem.song_id == song.id).delete()
        for stem_type in DEFAULT_STEMS:
            db.add(
                Stem(
                    song_id=song.id,
                    stem_type=stem_type,
                    file_path="",
                    status="pending",
                )
            )
        db.flush()

        job.status = "running"

        try:
            separated_dir = self._run_demucs(input_path=song_path, output_root=output_root)

            for stem in db.query(Stem).filter(Stem.song_id == song.id).all():
                stem_file = separated_dir / f"{stem.stem_type}.wav"
                if stem_file.exists():
                    stem.file_path = str(stem_file)
                    stem.status = "completed"
                else:
                    stem.status = "failed"

            job.status = "completed"
        except (subprocess.CalledProcessError, OSError):
            for stem in db.query(Stem).filter(Stem.song_id == song.id).all():
                stem.status = "failed"
            job.status = "failed"
        return job
