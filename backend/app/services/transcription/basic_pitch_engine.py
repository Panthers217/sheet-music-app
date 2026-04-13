"""
Spotify Basic Pitch transcription engine.

Uses the Basic Pitch ONNX model (no TensorFlow required) to convert an audio
stem into MIDI note events, then maps those events into the internal ScoreModel.

Architecture:
  Demucs stem (WAV) → BasicPitchEngine → PrettyMIDI → MidiParser → ScoreModel
                                        ↓
                                  MIDI file saved to disk

The engine implements TranscriptionEngine so it can be swapped with any other
engine in the pipeline.

Future TODOs:
  - multi-instrument merging (combine several stems into one ScoreModel)
  - quantization improvements (swing / triplet handling)
  - velocity dynamics post-processing
  - instrument detection from stem type
  - alignment with chord engine output
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from app.services.midi.parser import MidiParser
from app.services.score.model import ScoreModel
from app.services.transcription.base import TranscriptionEngine

logger = logging.getLogger(__name__)

# Stem type → preferred clef and instrument label
_STEM_CLEF: dict[str, tuple[str, str]] = {
    "bass": ("bass", "Bass"),
    "vocals": ("treble", "Vocals"),
    "other": ("treble", "Melody"),
    "drums": ("treble", "Drums"),
}


@dataclass
class BasicPitchResult:
    """Rich result from BasicPitchEngine.analyze() — includes both the score and MIDI path."""

    score: ScoreModel
    midi_path: Path
    note_count: int
    stem_label: str
    tempo_bpm: float


class BasicPitchEngine(TranscriptionEngine):
    """
    Transcription engine that uses Spotify Basic Pitch (ONNX) to detect notes.

    Parameters
    ----------
    project_id : int | None
        Used to resolve the MIDI output directory.  Required by ``analyze()``;
        optional for plain ``transcribe()`` (MIDI is not saved in that case).
    onset_threshold : float
        Basic Pitch onset detection threshold (0–1).  Lower = more notes.
    frame_threshold : float
        Basic Pitch frame-level detection threshold (0–1).
    minimum_note_length_ms : float
        Minimum note duration in milliseconds.  Basic Pitch default is ~127 ms.
    """

    def __init__(
        self,
        project_id: int | None = None,
        onset_threshold: float = 0.5,
        frame_threshold: float = 0.3,
        minimum_note_length_ms: float = 127.7,
    ) -> None:
        self.project_id = project_id
        self.onset_threshold = onset_threshold
        self.frame_threshold = frame_threshold
        self.minimum_note_length_ms = minimum_note_length_ms

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(
        self,
        audio_path: Path,
        title: str = "Untitled",
        tempo_bpm: float | None = None,
        time_sig: str = "4/4",
        chart_id: int | None = None,
    ) -> BasicPitchResult:
        """
        Run Basic Pitch inference on *audio_path* and return a rich result.

        The MIDI file is written to::

            uploads/{project_id}/generated/midi/chart_{chart_id}.mid

        If *chart_id* is None a temporary filename based on the stem name is used.

        Parameters
        ----------
        audio_path : Path
            Path to the audio file (preferably a Demucs stem WAV).
        title : str
            Score title embedded in the ScoreModel.
        tempo_bpm : float | None
            If provided, use this tempo for measure alignment.  If None, Basic
            Pitch's own tempo estimate is used (less accurate on stems).
        time_sig : str
            Time signature string, e.g. ``"4/4"``.
        chart_id : int | None
            Used to name the MIDI output file.

        Returns
        -------
        BasicPitchResult
        """
        import pretty_midi as pm

        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import predict

        logger.info("BasicPitchEngine: running inference on %s", audio_path)

        _model_output, midi_data, _note_events = predict(
            audio_path=audio_path,
            model_or_model_path=ICASSP_2022_MODEL_PATH,
            onset_threshold=self.onset_threshold,
            frame_threshold=self.frame_threshold,
            minimum_note_length=self.minimum_note_length_ms,
        )

        # Count detected notes across all instruments
        note_count = sum(len(inst.notes) for inst in midi_data.instruments)
        logger.info("BasicPitchEngine: detected %d notes", note_count)

        # Determine authoritative tempo
        effective_tempo = tempo_bpm if tempo_bpm is not None else float(midi_data.estimate_tempo())
        logger.info("BasicPitchEngine: using tempo %.1f BPM", effective_tempo)

        # Infer instrument metadata from stem file name
        stem_label = _infer_stem_label(audio_path)
        clef, instrument_name = _STEM_CLEF.get(stem_label, ("treble", "Instrument"))

        # Parse MIDI → ScoreModel
        parser = MidiParser(instrument_name=instrument_name, clef=clef)
        score = parser.parse(
            midi_data=midi_data,
            tempo_bpm=effective_tempo,
            time_sig=time_sig,
            title=title,
        )

        # Persist MIDI file
        midi_path = self._write_midi(midi_data, audio_path, chart_id)
        logger.info("BasicPitchEngine: MIDI written to %s", midi_path)

        return BasicPitchResult(
            score=score,
            midi_path=midi_path,
            note_count=note_count,
            stem_label=stem_label,
            tempo_bpm=effective_tempo,
        )

    def transcribe(self, audio_path: Path, title: str = "Untitled") -> ScoreModel:
        """
        Implements TranscriptionEngine ABC.
        Runs Basic Pitch and returns the ScoreModel only (MIDI file is still saved
        if *project_id* was supplied at construction time).
        """
        result = self.analyze(audio_path=audio_path, title=title)
        return result.score

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _write_midi(
        self,
        midi_data: object,  # pretty_midi.PrettyMIDI
        audio_path: Path,
        chart_id: int | None,
    ) -> Path:
        """Write the PrettyMIDI object to disk and return the path."""
        from app.services.storage import paths as storage

        if self.project_id is not None:
            if chart_id is not None:
                midi_path = storage.midi_file_path(self.project_id, chart_id)
            else:
                midi_dir = storage.midi_dir(self.project_id)
                midi_path = midi_dir / f"{audio_path.stem}.mid"
        else:
            # Fallback: write next to the audio file
            midi_path = audio_path.with_suffix(".mid")

        midi_data.write(str(midi_path))  # type: ignore[union-attr]
        return midi_path


def _infer_stem_label(audio_path: Path) -> str:
    """
    Guess the stem type from the audio file path.

    Demucs writes files as:
      uploads/{project_id}/stems/htdemucs/{song_stem}/{stem_type}.wav
    The stem type is the file *stem* (e.g. "bass", "vocals").
    """
    name = audio_path.stem.lower()
    for label in ("bass", "vocals", "drums", "other"):
        if label in name:
            return label
    return "other"
