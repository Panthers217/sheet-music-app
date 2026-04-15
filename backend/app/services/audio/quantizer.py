"""
NotationQuantizer — derives notation_position and notation_duration for each note.

This is a separate pass from the raw MIDI parsing step.  MidiParser sets the
*performance* timing fields (start_time_s / end_time_s) and a first-pass
symbolic snap (position / duration).  This quantizer then computes the
*notation* timing fields (notation_position / notation_duration) which are
used by MusicXML generation for cleaner score rendering.

Design decisions
----------------
- Performance timing (start_time_s, end_time_s) is NEVER modified here.
- Notation fields are derived from performance timing when available,
  otherwise they fall back to the existing position/duration values.
- Each notation_duration is clamped to fit within the remaining space in
  its measure, preventing MusicXML overflow.
- The quantizer is configurable via a grid string ("16th", "eighth", "quarter").

Usage
-----
    from app.services.audio.quantizer import NotationQuantizer
    from app.services.score.model import ScoreModel

    quantizer = NotationQuantizer()
    quantizer.quantize(score)          # modifies score in-place, returns it
    quantizer.quantize(score, grid="eighth")  # coarser grid
"""

from __future__ import annotations

import logging
from typing import Optional

from app.services.score.model import ScoreModel, ScoreNote

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Duration tables
# ---------------------------------------------------------------------------

# Symbolic duration name → length in quarter-note beats (descending)
_DURATION_BEATS: list[tuple[str, float]] = [
    ("whole", 4.0),
    ("half", 2.0),
    ("quarter", 1.0),
    ("eighth", 0.5),
    ("16th", 0.25),
]

_DURATION_BEATS_MAP: dict[str, float] = dict(_DURATION_BEATS)

# Supported grid names → number of subdivisions per beat
_GRID_SUBDIVISIONS: dict[str, int] = {
    "quarter": 1,
    "eighth": 2,
    "16th": 4,
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _snap_duration_to_grid(duration_beats: float) -> str:
    """Snap a continuous beat duration to the nearest symbolic name."""
    if duration_beats <= 0:
        return "16th"
    best = min(_DURATION_BEATS, key=lambda item: abs(item[1] - duration_beats))
    return best[0]


def _parse_time_sig_beats(time_sig: str) -> int:
    """Return the numerator (beats per measure) from e.g. '4/4'."""
    try:
        return int(time_sig.split("/")[0])
    except (ValueError, IndexError):
        return 4


def _largest_fitting_duration(remaining_beats: float) -> str:
    """Return the largest symbolic duration that fits within remaining_beats."""
    for name, beats in _DURATION_BEATS:  # ordered descending
        if beats <= remaining_beats + 1e-9:
            return name
    return "16th"


# ---------------------------------------------------------------------------
# NotationQuantizer
# ---------------------------------------------------------------------------

class NotationQuantizer:
    """
    Derive clean notation_position / notation_duration for every note in a ScoreModel.

    The quantizer works measure-by-measure and note-by-note:

    1. If start_time_s is available, compute a more accurate 16th-note grid
       position using the actual performance time and the chart tempo.
    2. If start_time_s + end_time_s are available, compute the beat duration
       from the performance delta and snap to the nearest symbolic value.
    3. Clamp the notation_duration so it cannot overflow the measure boundary
       (position + duration ≤ total 16th-note slots in measure).
    4. Fall back to existing position/duration when performance timing is absent
       (chord-only charts).
    """

    def quantize(self, score: ScoreModel, grid: str = "16th") -> ScoreModel:
        """
        Set notation_position and notation_duration on every ScoreNote.

        Modifies the score in-place and returns it for chaining.

        Parameters
        ----------
        score : ScoreModel
            The score to quantize.  Parts and measures must be pre-populated.
        grid : str
            Rhythmic grid resolution: "16th" (default), "eighth", or "quarter".
        """
        subdivisions_per_beat = _GRID_SUBDIVISIONS.get(grid, 4)

        tempo = max(score.tempo, 1)
        beats_per_measure = _parse_time_sig_beats(score.time_sig)
        seconds_per_beat = 60.0 / tempo
        seconds_per_measure = beats_per_measure * seconds_per_beat

        # Total 16th-note slots per measure (always 16 for 4/4, 12 for 3/4, etc.)
        total_slots = beats_per_measure * 4  # always in 16th-note units

        quantized_count = 0
        fallback_count = 0

        for part in score.parts:
            for measure in part.measures:
                measure_start_s = (measure.number - 1) * seconds_per_measure
                for note in measure.notes:
                    used_real_timing = self._quantize_note(
                        note=note,
                        measure_start_s=measure_start_s,
                        seconds_per_beat=seconds_per_beat,
                        subdivisions_per_beat=subdivisions_per_beat,
                        total_slots=total_slots,
                    )
                    if used_real_timing:
                        quantized_count += 1
                    else:
                        fallback_count += 1

        logger.debug(
            "NotationQuantizer: %d notes quantized from timing, %d fell back to position/duration",
            quantized_count,
            fallback_count,
        )
        return score

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _quantize_note(
        self,
        note: ScoreNote,
        measure_start_s: float,
        seconds_per_beat: float,
        subdivisions_per_beat: int,
        total_slots: int,
    ) -> bool:
        """
        Compute notation_position and notation_duration for one note.

        Returns True if real timing was used, False if fallback was applied.
        """
        if note.start_time_s is not None:
            # --- notation_position from real start time ---
            offset_s = note.start_time_s - measure_start_s
            offset_beats = offset_s / seconds_per_beat

            # Snap to the configured grid, then convert to 16th-note slots
            snapped_beats = round(offset_beats * subdivisions_per_beat) / subdivisions_per_beat
            notation_pos = round(snapped_beats * 4)  # 1 beat = 4 × 16th-note slots
            notation_pos = max(0, min(notation_pos, total_slots - 1))
            note.notation_position = notation_pos

            # --- notation_duration from real duration ---
            if note.end_time_s is not None:
                duration_s = max(0.0, note.end_time_s - note.start_time_s)
                duration_beats = duration_s / seconds_per_beat
                raw_notation_dur = _snap_duration_to_grid(duration_beats)
            else:
                # end_time_s missing — use existing duration as notation duration
                raw_notation_dur = note.duration

            # Clamp so the note cannot overflow the measure boundary
            dur_beats = _DURATION_BEATS_MAP.get(raw_notation_dur, 1.0)
            pos_in_beats = notation_pos / 4.0
            remaining_beats = (total_slots / 4.0) - pos_in_beats

            if dur_beats > remaining_beats + 1e-9:
                raw_notation_dur = _largest_fitting_duration(remaining_beats)

            note.notation_duration = raw_notation_dur
            return True

        else:
            # Chord-chart or note without timing info — copy existing fields
            note.notation_position = note.position
            note.notation_duration = note.duration
            return False
