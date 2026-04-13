"""
Chord-chart transcription engine.

Replaces the placeholder with real musical analysis using librosa:

  1. TimingAnalyzer extracts tempo, beat positions, and measure count.
  2. A chromagram (chroma_cqt) is built from the audio.
  3. For each measure, the per-measure average chroma is matched against
     major and minor triad templates to select the best chord symbol.
  4. ScoreModel measures are populated with the detected chord symbols.
     Notes remain as whole-rests.

Modular design — the engine is a drop-in replacement for
PlaceholderTranscriptionEngine via the TranscriptionEngine ABC.

TODO: Add key detection (Krumhansl–Schmuckler profile or librosa.key_to_degrees)
      and use it to bias chord selection toward the detected key.
TODO: Replace whole-rest notes with real pitch transcription
      (e.g. basic-pitch for melody lines, separate engine per Demucs stem).
TODO: Use the "other" or "vocals" Demucs stem instead of the mix for cleaner
      harmonic analysis once stems are confirmed complete.
TODO: Add metre/time-sig detection for songs in 3/4, 6/8, etc.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from app.services.audio.timing import TimingAnalyzer, TimingInfo
from app.services.score.model import ScoreMeasure, ScoreModel, ScoreNote, ScorePart
from app.services.transcription.base import TranscriptionEngine

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Chord template library
# ---------------------------------------------------------------------------

# Chroma bin order used by librosa: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
_NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

# Triad interval patterns (binary chroma mask, root at index 0)
_MAJOR_INTERVALS = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]  # root, M3, P5
_MINOR_INTERVALS = [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]  # root, m3, P5


def _build_templates() -> dict[str, np.ndarray]:
    templates: dict[str, np.ndarray] = {}
    for i, root in enumerate(_NOTE_NAMES):
        templates[root] = np.roll(_MAJOR_INTERVALS, i).astype(float)
        templates[f"{root}m"] = np.roll(_MINOR_INTERVALS, i).astype(float)
    return templates


_CHORD_TEMPLATES = _build_templates()

# Fallback chord cycle used when chroma matching fails for a segment
_FALLBACK_CHORDS = ["C", "Am", "F", "G"]

# librosa default hop length (samples per chroma frame)
_HOP_LENGTH = 512


# ---------------------------------------------------------------------------
# Chord matching
# ---------------------------------------------------------------------------


def _best_chord(chroma_segment: np.ndarray) -> str:
    """
    Return the chord name that best matches a chroma segment (12 × n_frames).
    Uses cosine-like similarity (normalised dot product) against triad templates.
    Returns "C" on a silent/empty segment.
    """
    if chroma_segment.size == 0:
        return "C"

    avg = chroma_segment.mean(axis=1)
    total = avg.sum()
    if total < 1e-6:
        return "C"
    avg /= total

    best_chord, best_score = "C", -1.0
    for name, template in _CHORD_TEMPLATES.items():
        score = float(np.dot(avg, template))
        if score > best_score:
            best_score, best_chord = score, name
    return best_chord


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class ChordChartEngine(TranscriptionEngine):
    """
    Real chord-chart transcription using librosa timing analysis
    and chromagram-based chord detection.

    Audio is loaded once and reused for both beat tracking and chroma
    extraction, avoiding a double read.

    Notes within each measure are populated as whole-rests.
    Replace by a real pitch transcription engine when ready.
    """

    def __init__(self) -> None:
        self._timing = TimingAnalyzer()

    def transcribe(self, audio_path: Path, title: str = "Untitled") -> ScoreModel:
        try:
            return self._run(audio_path, title)
        except Exception as exc:
            logger.error(
                "ChordChartEngine failed for %s: %s — falling back to placeholder",
                audio_path.name,
                exc,
                exc_info=True,
            )
            return self._plain_fallback(title)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _run(self, audio_path: Path, title: str) -> ScoreModel:
        import librosa  # noqa: PLC0415 — deferred on purpose

        # Load audio once — reuse for both beat tracking and chroma
        y, sr = librosa.load(str(audio_path), sr=None, mono=True)

        # --- Timing (beat tracking) ---
        timing = self._timing_from_loaded(y, sr, audio_path)

        # --- Chroma ---
        chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=_HOP_LENGTH)

        # --- Per-measure chord detection ---
        measures = self._build_measures(chroma, timing, sr)

        part = ScorePart(name="Piano", instrument="piano", clef="treble", measures=measures)
        return ScoreModel(
            title=title,
            tempo=int(round(timing.tempo_bpm)),
            key="C",  # TODO: add key detection
            time_sig=timing.time_sig,
            parts=[part],
            source="chord_chart",
        )

    def _timing_from_loaded(self, y: np.ndarray, sr: int, audio_path: Path) -> TimingInfo:
        """Run beat tracking on an already-loaded audio array (avoids double read)."""
        import librosa  # noqa: PLC0415

        duration = float(len(y) / sr)
        try:
            tempo_raw, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
            tempo = float(np.atleast_1d(tempo_raw)[0])
            beat_times: list[float] = librosa.frames_to_time(beat_frames, sr=sr).tolist()
            bpm = 4  # 4/4
            measure_count = max(1, len(beat_times) // bpm)
            logger.info(
                "%s → %.1f BPM, %d beats, %d measures",
                audio_path.name,
                tempo,
                len(beat_times),
                measure_count,
            )
            from app.services.audio.timing import TimingInfo  # noqa: PLC0415

            return TimingInfo(
                tempo_bpm=round(tempo, 1),
                beat_times=beat_times,
                measure_count=measure_count,
                time_sig="4/4",
                beats_per_measure=bpm,
                duration_seconds=round(duration, 2),
                source="librosa",
            )
        except Exception as exc:
            logger.warning("Beat tracking failed: %s — using fallback timing", exc)
            return self._timing.analyze(audio_path)

    def _build_measures(
        self,
        chroma: np.ndarray,
        timing: TimingInfo,
        sr: int,
    ) -> list[ScoreMeasure]:
        """Build one ScoreMeasure per detected measure with a chord symbol."""
        import librosa  # noqa: PLC0415

        bpm = timing.beats_per_measure
        beat_dur = 60.0 / timing.tempo_bpm  # seconds per beat

        measures: list[ScoreMeasure] = []
        for i in range(timing.measure_count):
            # Compute time window for measure i
            beat_start_idx = i * bpm
            beat_end_idx = beat_start_idx + bpm

            if beat_start_idx < len(timing.beat_times):
                t_start = timing.beat_times[beat_start_idx]
                if beat_end_idx < len(timing.beat_times):
                    t_end = timing.beat_times[beat_end_idx]
                else:
                    # Last few measures: extrapolate from last known beat
                    extra = beat_end_idx - len(timing.beat_times)
                    t_end = timing.beat_times[-1] + extra * beat_dur
            else:
                # Beyond detected beats: extrapolate entirely
                t_start = beat_start_idx * beat_dur
                t_end = beat_end_idx * beat_dur

            # Convert to chroma frame range
            f_start = int(librosa.time_to_frames(t_start, sr=sr, hop_length=_HOP_LENGTH))
            f_end = int(librosa.time_to_frames(t_end, sr=sr, hop_length=_HOP_LENGTH))
            n_frames = chroma.shape[1]
            f_start = max(0, min(f_start, n_frames - 1))
            f_end = max(f_start + 1, min(f_end, n_frames))

            chord = _best_chord(chroma[:, f_start:f_end])

            measures.append(
                ScoreMeasure(
                    number=i + 1,
                    chord_symbol=chord,
                    # TODO: replace with real note transcription per stem type
                    notes=[ScoreNote(pitch="C4", duration="whole", is_rest=True, position=0)],
                )
            )
        return measures

    def _plain_fallback(self, title: str) -> ScoreModel:
        """Minimal fallback when everything fails — 8-measure placeholder."""
        measures = [
            ScoreMeasure(
                number=i + 1,
                chord_symbol=_FALLBACK_CHORDS[i % len(_FALLBACK_CHORDS)],
                notes=[ScoreNote(pitch="C4", duration="whole", is_rest=True, position=0)],
            )
            for i in range(8)
        ]
        part = ScorePart(name="Piano", instrument="piano", clef="treble", measures=measures)
        return ScoreModel(
            title=title,
            tempo=120,
            key="C",
            time_sig="4/4",
            parts=[part],
            source="placeholder",
        )
