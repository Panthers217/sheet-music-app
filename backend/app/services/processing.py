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
    """Modular placeholder pipeline for MVP. Replace internals later with real models."""

    def enqueue_song_processing(self, db: Session, song: Song) -> ProcessingJob:
        job = ProcessingJob(song_id=song.id, job_type="stem_split_and_chart_seed", status="queued")
        db.add(job)
        db.flush()

        for stem_type in DEFAULT_STEMS:
            db.add(
                Stem(
                    song_id=song.id,
                    stem_type=stem_type,
                    file_path=f"placeholder://{song.id}/{stem_type}",
                    status="pending",
                )
            )

        db.add(
            ChartEdit(
                song_id=song.id,
                chart_type="chord",
                version=1,
                chart_data=DEFAULT_CHART,
            )
        )

        job.status = "completed"
        return job
