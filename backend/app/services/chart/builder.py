"""
Chart builder — converts a ScoreModel into DB entities (Chart / ChartMeasure / ChartNote).

Usage:
    builder = ChartBuilder(db)
    chart = builder.create_from_score(song=song, score=score_model)
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy.orm import Session

from app.models import Chart, ChartMeasure, ChartNote
from app.services.score.model import ScoreModel
from app.services.transcription.base import TranscriptionEngine
from app.services.transcription.chord_chart import ChordChartEngine

if TYPE_CHECKING:
    from app.services.transcription.chord_chart import MeasureAnalysis


class ChartBuilder:
    def __init__(self, db: Session, engine: TranscriptionEngine | None = None) -> None:
        self._db = db
        # Default to ChordChartEngine (real tempo + chroma chord detection).
        # Pass an explicit engine to override (e.g. PlaceholderTranscriptionEngine for tests).
        self._engine: TranscriptionEngine = engine or ChordChartEngine()

    def build_score_from_song(self, audio_path: Path, title: str) -> ScoreModel:
        """Run the transcription engine on an audio file and return a ScoreModel."""
        return self._engine.transcribe(audio_path=audio_path, title=title)

    def create_from_score(
        self,
        song_id: int,
        score: ScoreModel,
        stem_id: int | None = None,
        analyses: list[MeasureAnalysis] | None = None,
    ) -> Chart:
        """
        Persist a ScoreModel into Chart / ChartMeasure / ChartNote rows.
        Optionally accept per-measure analysis metadata (confidence, alternatives).
        Returns the newly created Chart (not yet committed — caller commits).
        """
        chart = Chart(
            song_id=song_id,
            stem_id=stem_id,
            title=score.title,
            tempo=score.tempo,
            key_sig=score.key,
            time_sig=score.time_sig,
            status="generated",
        )
        self._db.add(chart)
        self._db.flush()  # get chart.id

        # Build analysis lookup by measure number for O(1) access
        analysis_by_number: dict[int, MeasureAnalysis] = {}
        if analyses:
            analysis_by_number = {a.measure_number: a for a in analyses}

        # Use first part only for now (single-part MVP)
        part = score.parts[0] if score.parts else None
        if part:
            for sm in part.measures:
                analysis = analysis_by_number.get(sm.number)
                measure = ChartMeasure(
                    chart_id=chart.id,
                    measure_number=sm.number,
                    chord_symbol=sm.chord_symbol,
                    time_sig_override=sm.time_sig_override,
                    chord_confidence=analysis.confidence if analysis else None,
                    chord_alternatives=(
                        json.dumps(analysis.alternatives) if analysis and analysis.alternatives else None
                    ),
                )
                self._db.add(measure)
                self._db.flush()

                for sn in sm.notes:
                    self._db.add(
                        ChartNote(
                            measure_id=measure.id,
                            position=sn.position,
                            pitch=sn.pitch,
                            duration=sn.duration,
                            is_rest=sn.is_rest,
                            velocity=sn.velocity,
                            start_time_s=sn.start_time_s,
                            end_time_s=sn.end_time_s,
                        )
                    )

        return chart

    def score_from_chart(self, chart: Chart) -> ScoreModel:
        """
        Re-hydrate a ScoreModel from Chart DB entities.
        Used before MusicXML regeneration after edits.
        """
        from app.services.score.model import ScoreMeasure, ScoreNote, ScorePart

        measures: list[ScoreMeasure] = []
        for cm in chart.measures:
            notes = [
                ScoreNote(
                    pitch=cn.pitch,
                    duration=cn.duration,
                    is_rest=cn.is_rest,
                    position=cn.position,
                )
                for cn in cm.notes
            ]
            measures.append(
                ScoreMeasure(
                    number=cm.measure_number,
                    chord_symbol=cm.chord_symbol,
                    time_sig_override=cm.time_sig_override,
                    notes=notes,
                )
            )

        part = ScorePart(name="Piano", instrument="piano", clef="treble", measures=measures)
        return ScoreModel(
            title=chart.title,
            tempo=chart.tempo,
            key=chart.key_sig,
            time_sig=chart.time_sig,
            parts=[part],
            source="user_edit",
        )
