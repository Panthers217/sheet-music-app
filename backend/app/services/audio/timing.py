"""
Timing analysis for audio files.

Extracts tempo, beat positions, and measure segmentation using librosa.
Returns a TimingInfo dataclass that feeds into transcription engines.

Falls back to sensible defaults if analysis fails (e.g. unsupported format,
silent audio, or librosa unavailable).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)

_DEFAULT_TEMPO = 120.0
_DEFAULT_BEATS_PER_MEASURE = 4


@dataclass
class TimingInfo:
    """Result of timing analysis on an audio file."""

    tempo_bpm: float
    beat_times: list[float]         # beat positions in seconds
    measure_count: int              # complete measures detected
    time_sig: str                   # e.g. "4/4"
    beats_per_measure: int          # beats per measure
    duration_seconds: float         # total audio length
    source: str = "librosa"         # "librosa" | "fallback"


class TimingAnalyzer:
    """
    Analyse audio timing using librosa beat tracking.

    Defers all librosa imports to analysis time so the module can be
    imported even if librosa is not installed (e.g. in test environments
    that mock the analysis layer).
    """

    def analyze(self, audio_path: Path) -> TimingInfo:
        """
        Analyse audio_path and return timing information.
        Gracefully falls back to defaults on any error.
        """
        try:
            return self._analyze_with_librosa(audio_path)
        except Exception as exc:
            logger.warning(
                "Timing analysis failed for %s: %s — using fallback timing",
                audio_path.name,
                exc,
            )
            return self._fallback(audio_path)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _analyze_with_librosa(self, audio_path: Path) -> TimingInfo:
        import numpy as np  # always available (torch dependency)
        import librosa  # noqa: PLC0415 — deferred on purpose

        y, sr = librosa.load(str(audio_path), sr=None, mono=True)
        duration = float(len(y) / sr)

        # Beat tracking — tempo is scalar BPM, beat_frames are frame indices
        tempo_raw, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
        tempo = float(np.atleast_1d(tempo_raw)[0])
        beat_times: list[float] = librosa.frames_to_time(beat_frames, sr=sr).tolist()

        beats_per_measure = _DEFAULT_BEATS_PER_MEASURE  # 4/4 assumed for MVP
        # Count complete measures from detected beats; ensure at least 1
        measure_count = max(1, len(beat_times) // beats_per_measure)

        logger.info(
            "Timing analysis: %.1f BPM, %d beats, %d measures, %.1fs",
            tempo,
            len(beat_times),
            measure_count,
            duration,
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

    def _fallback(self, audio_path: Path) -> TimingInfo:
        """Return placeholder timing when librosa analysis fails."""
        duration = 0.0
        try:
            import soundfile as sf  # noqa: PLC0415

            info = sf.info(str(audio_path))
            duration = float(info.duration)
        except Exception:
            pass

        if duration > 0:
            beats_per_second = _DEFAULT_TEMPO / 60.0
            total_beats = duration * beats_per_second
            measure_count = max(1, int(total_beats / _DEFAULT_BEATS_PER_MEASURE))
        else:
            measure_count = 8

        return TimingInfo(
            tempo_bpm=_DEFAULT_TEMPO,
            beat_times=[],
            measure_count=measure_count,
            time_sig="4/4",
            beats_per_measure=_DEFAULT_BEATS_PER_MEASURE,
            duration_seconds=round(duration, 2),
            source="fallback",
        )
