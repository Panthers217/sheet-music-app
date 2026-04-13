"""
Chord-chart transcription engine.

Analysis pipeline:
  1. Resolve the best harmonic audio source (full mix, or a Demucs stem).
  2. Load audio once; run librosa beat tracking for tempo + measure segmentation.
  3. Compute a chromagram using a configurable strategy (cqt / stft / cens).
  4. For each measure: score all 24 major/minor triad templates against the
     per-measure average chroma; store the best chord, its confidence, and
     the top alternative candidates.
  5. Return a ChordChartResult containing both the ScoreModel and per-measure
     analysis metadata, which can be persisted to the DB for frontend display.

Configurable via ChromaConfig.  Backward-compatible transcribe() API preserved.

TODO: Add key detection (Krumhansl–Schmuckler profile).
TODO: Replace whole-rest notes with real pitch transcription.
TODO: Add metre/time-sig detection for songs in 3/4, 6/8 etc.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from app.services.audio.timing import TimingAnalyzer, TimingInfo
from app.services.score.model import ScoreMeasure, ScoreModel, ScoreNote, ScorePart
from app.services.transcription.base import TranscriptionEngine

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CHROMA_METHODS = ("cqt", "stft", "cens")


@dataclass
class ChromaConfig:
    """Configures how harmonic analysis is performed."""

    # Chroma extraction strategy: "cqt" (default) | "stft" | "cens"
    method: str = "cqt"
    # librosa hop length in samples
    hop_length: int = 512
    # Harmonic source selection:
    #   "preferred" — tries "other" stem → "vocals" stem → full mix
    #   "mix"       — always use the original mix
    #   "other" | "vocals" | "bass" | "drums" — specific Demucs stem
    harmonic_stem: str = "preferred"
    # Number of alternative chord labels to store per measure (0 = disabled)
    n_alternatives: int = 3


# ---------------------------------------------------------------------------
# Per-measure analysis result
# ---------------------------------------------------------------------------


@dataclass
class MeasureAnalysis:
    """Chord detection result for a single measure."""

    measure_number: int
    chord: str
    # Confidence in [0, 1]: dot product of L1-normalised average chroma against
    # the best-matching binary triad template.  Typical range 0.2 – 0.6.
    confidence: float
    # Top alternative candidates (chord_name, score), excluding the best match.
    # Empty when n_alternatives=0.
    alternatives: list[tuple[str, float]] = field(default_factory=list)


@dataclass
class ChordChartResult:
    """Full output of ChordChartEngine.analyze()."""

    score: ScoreModel
    measure_analyses: list[MeasureAnalysis]
    chroma_method: str   # which chroma strategy was used
    audio_source: str    # e.g. "mix", "stem:other", "stem:vocals"


# ---------------------------------------------------------------------------
# Chord template library
# ---------------------------------------------------------------------------

# Chroma bin order used by librosa: C, C#, D, D#, E, F, F#, G, G#, A, A#, B
_NOTE_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

_MAJOR_INTERVALS = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]  # root, M3, P5
_MINOR_INTERVALS = [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]  # root, m3, P5

_FALLBACK_CHORDS = ["C", "Am", "F", "G"]


def _build_templates() -> dict[str, np.ndarray]:
    templates: dict[str, np.ndarray] = {}
    for i, root in enumerate(_NOTE_NAMES):
        templates[root] = np.roll(_MAJOR_INTERVALS, i).astype(float)
        templates[f"{root}m"] = np.roll(_MINOR_INTERVALS, i).astype(float)
    return templates


_CHORD_TEMPLATES = _build_templates()

# ---------------------------------------------------------------------------
# Chord matching helpers
# ---------------------------------------------------------------------------


def _score_chords(
    chroma_segment: np.ndarray,
    n_top: int = 0,
) -> list[tuple[str, float]]:
    """
    Score all 24 chord templates against a chroma segment (12 × n_frames).

    Returns a list of (chord_name, score) sorted descending by score.
    Score is the dot product of the L1-normalised average chroma vector against
    a binary triad template; range ≈ [0, 1].

    If n_top > 0 the list is truncated to n_top entries.
    Returns [("C", 0.0)] on a silent or empty segment.
    """
    if chroma_segment.size == 0:
        return [("C", 0.0)]

    avg = chroma_segment.mean(axis=1)
    total = avg.sum()
    if total < 1e-6:
        return [("C", 0.0)]
    avg = avg / total

    scores = [
        (name, float(np.dot(avg, template)))
        for name, template in _CHORD_TEMPLATES.items()
    ]
    scores.sort(key=lambda x: x[1], reverse=True)
    return scores[:n_top] if n_top > 0 else scores


def _compute_chroma(y: np.ndarray, sr: int, config: ChromaConfig) -> np.ndarray:
    """Dispatch to the configured librosa chroma extraction function."""
    import librosa  # noqa: PLC0415

    if config.method == "stft":
        return librosa.feature.chroma_stft(y=y, sr=sr, hop_length=config.hop_length)
    if config.method == "cens":
        return librosa.feature.chroma_cens(y=y, sr=sr, hop_length=config.hop_length)
    # default: "cqt"
    return librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=config.hop_length)


# ---------------------------------------------------------------------------
# Harmonic source resolution
# ---------------------------------------------------------------------------

# Demucs stem preference order for harmonic analysis
_HARMONIC_STEM_PREFERENCE = ("other", "vocals")


def resolve_harmonic_source(song_path: Path, preferred_stem: str = "preferred") -> tuple[Path, str]:
    """
    Select the audio file to use for harmonic analysis.

    Args:
        song_path:      Original uploaded audio file (the mix).
        preferred_stem: "preferred" tries "other" → "vocals" → mix.
                        "mix" always uses the mix.
                        Any other value names a specific Demucs stem type.

    Returns:
        (audio_path, source_label) where source_label is e.g.
        "mix", "stem:other", "stem:vocals".
    """
    from app.services.audio.stems import completed_stems  # noqa: PLC0415

    if preferred_stem == "mix":
        return song_path, "mix"

    stems = completed_stems(song_path)

    if preferred_stem == "preferred":
        for stem_type in _HARMONIC_STEM_PREFERENCE:
            if stem_type in stems:
                logger.info("Using harmonic source: stem:%s", stem_type)
                return stems[stem_type], f"stem:{stem_type}"
        logger.info("No harmonic stem available — using mix")
        return song_path, "mix"

    # Caller requested a specific stem
    if preferred_stem in stems:
        return stems[preferred_stem], f"stem:{preferred_stem}"

    logger.warning("Stem %r not available for %s — falling back to mix", preferred_stem, song_path.name)
    return song_path, "mix"


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class ChordChartEngine(TranscriptionEngine):
    """
    Chord-chart transcription using configurable harmonic source selection
    and chromagram-based chord detection.

    Primary interface:
        result = engine.analyze(song_path, title)  -> ChordChartResult

    Backward-compatible interface (TranscriptionEngine ABC):
        score  = engine.transcribe(audio_path, title) -> ScoreModel
    """

    def __init__(self, config: ChromaConfig | None = None) -> None:
        self._config = config or ChromaConfig()
        self._timing = TimingAnalyzer()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def analyze(self, song_path: Path, title: str = "Untitled") -> ChordChartResult:
        """
        Full analysis with configurable harmonic source.

        Beat tracking always runs on the original mix (most reliable — percussive
        transients).  Chroma extraction uses the configured harmonic source (which
        may be a Demucs stem for cleaner harmonic content).
        """
        harmonic_path, source_label = resolve_harmonic_source(
            song_path, self._config.harmonic_stem
        )
        try:
            return self._run(mix_path=song_path, harmonic_path=harmonic_path, source_label=source_label, title=title)
        except Exception as exc:
            logger.error(
                "ChordChartEngine failed for %s: %s — falling back to placeholder",
                song_path.name,
                exc,
                exc_info=True,
            )
            return self._plain_fallback_result(title)

    def transcribe(self, audio_path: Path, title: str = "Untitled") -> ScoreModel:
        """
        Backward-compatible TranscriptionEngine interface.

        Treats audio_path as both the timing source and the harmonic source
        (no stem resolution).  Use analyze() for the richer result with
        automatic stem selection and per-measure debug info.
        """
        try:
            result = self._run(mix_path=audio_path, harmonic_path=audio_path, source_label="mix", title=title)
        except Exception as exc:
            logger.error(
                "ChordChartEngine failed for %s: %s — falling back to placeholder",
                audio_path.name,
                exc,
                exc_info=True,
            )
            result = self._plain_fallback_result(title)
        return result.score

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _run(self, mix_path: Path, harmonic_path: Path, source_label: str, title: str) -> ChordChartResult:
        import librosa  # noqa: PLC0415

        # Beat tracking always uses the mix (reliable percussive transients)
        y_mix, sr_mix = librosa.load(str(mix_path), sr=None, mono=True)
        timing = self._timing_from_loaded(y_mix, sr_mix, mix_path)

        # Chroma extraction uses the (possibly different) harmonic source
        if harmonic_path == mix_path:
            y_harm, sr_harm = y_mix, sr_mix  # reuse — no second load
        else:
            y_harm, sr_harm = librosa.load(str(harmonic_path), sr=None, mono=True)

        chroma = _compute_chroma(y_harm, sr_harm, self._config)

        measure_scores, analyses = self._build_measures_with_analysis(chroma, timing, sr_harm)

        part = ScorePart(name="Piano", instrument="piano", clef="treble", measures=measure_scores)
        score = ScoreModel(
            title=title,
            tempo=int(round(timing.tempo_bpm)),
            key="C",  # TODO: key detection (Krumhansl–Schmuckler)
            time_sig=timing.time_sig,
            parts=[part],
            source="chord_chart",
        )
        return ChordChartResult(
            score=score,
            measure_analyses=analyses,
            chroma_method=self._config.method,
            audio_source=source_label,
        )

    def _timing_from_loaded(self, y: np.ndarray, sr: int, audio_path: Path) -> TimingInfo:
        """Beat tracking on an already-loaded array (avoids double read)."""
        import librosa  # noqa: PLC0415

        duration = float(len(y) / sr)
        try:
            tempo_raw, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
            tempo = float(np.atleast_1d(tempo_raw)[0])
            beat_times: list[float] = librosa.frames_to_time(beat_frames, sr=sr).tolist()
            beats_per_measure = 4  # 4/4 TODO: time-sig detection
            measure_count = max(1, len(beat_times) // beats_per_measure)
            logger.info(
                "%s → %.1f BPM, %d beats, %d measures (method=%s)",
                audio_path.name, tempo, len(beat_times), measure_count, self._config.method,
            )
            return TimingInfo(
                tempo_bpm=round(tempo, 1),
                beat_times=beat_times,
                measure_count=measure_count,
                time_sig="4/4",
                beats_per_measure=beats_per_measure,
                duration_seconds=round(duration, 2),
                source="librosa",
            )
        except Exception as exc:
            logger.warning("Beat tracking failed: %s — using fallback timing", exc)
            return self._timing.analyze(audio_path)

    def _build_measures_with_analysis(
        self,
        chroma: np.ndarray,
        timing: TimingInfo,
        sr: int,
    ) -> tuple[list[ScoreMeasure], list[MeasureAnalysis]]:
        """Build ScoreMeasure list and parallel MeasureAnalysis list."""
        import librosa  # noqa: PLC0415

        bpm = timing.beats_per_measure
        beat_dur = 60.0 / timing.tempo_bpm
        n_keep = 1 + self._config.n_alternatives  # best + alternatives

        score_measures: list[ScoreMeasure] = []
        analyses: list[MeasureAnalysis] = []

        for i in range(timing.measure_count):
            beat_start_idx = i * bpm
            beat_end_idx = beat_start_idx + bpm

            if beat_start_idx < len(timing.beat_times):
                t_start = timing.beat_times[beat_start_idx]
                if beat_end_idx < len(timing.beat_times):
                    t_end = timing.beat_times[beat_end_idx]
                else:
                    extra = beat_end_idx - len(timing.beat_times)
                    t_end = timing.beat_times[-1] + extra * beat_dur
            else:
                t_start = beat_start_idx * beat_dur
                t_end = beat_end_idx * beat_dur

            f_start = int(librosa.time_to_frames(t_start, sr=sr, hop_length=self._config.hop_length))
            f_end = int(librosa.time_to_frames(t_end, sr=sr, hop_length=self._config.hop_length))
            n_frames = chroma.shape[1]
            f_start = max(0, min(f_start, n_frames - 1))
            f_end = max(f_start + 1, min(f_end, n_frames))

            ranked = _score_chords(chroma[:, f_start:f_end], n_top=n_keep)
            best_chord, best_score = ranked[0]
            alternatives = ranked[1:]  # may be empty if n_alternatives=0

            score_measures.append(
                ScoreMeasure(
                    number=i + 1,
                    chord_symbol=best_chord,
                    # TODO: replace with real note transcription per stem
                    notes=[ScoreNote(pitch="C4", duration="whole", is_rest=True, position=0)],
                )
            )
            analyses.append(
                MeasureAnalysis(
                    measure_number=i + 1,
                    chord=best_chord,
                    confidence=round(best_score, 4),
                    alternatives=[(c, round(s, 4)) for c, s in alternatives],
                )
            )

        return score_measures, analyses

    def _plain_fallback_result(self, title: str) -> ChordChartResult:
        """Fallback when analysis fails completely."""
        measures = [
            ScoreMeasure(
                number=i + 1,
                chord_symbol=_FALLBACK_CHORDS[i % len(_FALLBACK_CHORDS)],
                notes=[ScoreNote(pitch="C4", duration="whole", is_rest=True, position=0)],
            )
            for i in range(8)
        ]
        analyses = [
            MeasureAnalysis(
                measure_number=m.number,
                chord=m.chord_symbol or "C",
                confidence=0.0,
                alternatives=[],
            )
            for m in measures
        ]
        part = ScorePart(name="Piano", instrument="piano", clef="treble", measures=measures)
        score = ScoreModel(title=title, tempo=120, key="C", time_sig="4/4", parts=[part], source="placeholder")
        return ChordChartResult(score=score, measure_analyses=analyses, chroma_method=self._config.method, audio_source="mix")
