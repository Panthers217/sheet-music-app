"""
MIDI → ScoreModel parser.

Converts note events from Spotify Basic Pitch (via PrettyMIDI) into the
internal ScoreModel representation.

Key conversions:
  - MIDI pitch number → note name + octave  (e.g. 60 → "C4")
  - note start time (seconds) → measure number + 16th-note grid position
  - note duration (seconds) → symbolic duration string ("whole" / "half" / etc.)

Usage:
    from app.services.midi.parser import MidiParser
    score = MidiParser().parse(midi_data, tempo_bpm=152, title="Bass Line")
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

import pretty_midi

from app.services.score.model import ScoreMeasure, ScoreModel, ScoreNote, ScorePart

if TYPE_CHECKING:
    pass


# ---------------------------------------------------------------------------
# Duration snapping
# ---------------------------------------------------------------------------

# Duration names mapped to their length in quarter-note beats
_DURATION_BEATS: list[tuple[str, float]] = [
    ("whole", 4.0),
    ("half", 2.0),
    ("quarter", 1.0),
    ("eighth", 0.5),
    ("16th", 0.25),
]

_MIN_NOTE_BEATS = 0.2  # notes shorter than this (in beats) are discarded as noise


def _snap_duration(duration_beats: float) -> str:
    """Snap a note duration in beats to the nearest symbolic duration string."""
    if duration_beats <= 0:
        return "16th"
    best = min(_DURATION_BEATS, key=lambda item: abs(item[1] - duration_beats))
    return best[0]


def _snap_position(beat_in_measure: float) -> int:
    """
    Snap a fractional beat position within a measure to the nearest 16th-note
    grid slot.  Returns an integer 0..N where 0 = downbeat.
    """
    return max(0, round(beat_in_measure * 4))


# ---------------------------------------------------------------------------
# Pitch conversion
# ---------------------------------------------------------------------------


def _midi_pitch_to_name(midi_pitch: int) -> str:
    """
    Convert a MIDI pitch number to a note name string (e.g. 60 → "C4").

    Uses pretty_midi's conversion which follows the convention:
      MIDI 60 = C4 (middle C).
    The returned string replaces '#' with '#' (kept) and 'b' notation is
    preserved as-is from pretty_midi.
    """
    return pretty_midi.note_number_to_name(int(midi_pitch))


# ---------------------------------------------------------------------------
# MidiParser
# ---------------------------------------------------------------------------


class MidiParser:
    """
    Parse a PrettyMIDI object (as returned by Basic Pitch) into a ScoreModel.

    Parameters
    ----------
    instrument_name : str
        Name of the instrument / part (shows in score header).
    clef : str
        "bass" or "treble".  Bass clef is recommended for bass stems.
    min_confidence : float
        Minimum velocity (0–127) threshold; notes below this are discarded.
        Basic Pitch maps confidence to velocity, so this also acts as a
        confidence filter.  Defaults to 10 (very permissive).
    """

    def __init__(
        self,
        instrument_name: str = "Bass",
        clef: str = "bass",
        min_velocity: int = 10,
    ) -> None:
        self.instrument_name = instrument_name
        self.clef = clef
        self.min_velocity = min_velocity

    def parse(
        self,
        midi_data: pretty_midi.PrettyMIDI,
        tempo_bpm: float,
        time_sig: str = "4/4",
        title: str = "Untitled",
    ) -> ScoreModel:
        """
        Convert a PrettyMIDI object into a ScoreModel.

        Parameters
        ----------
        midi_data : PrettyMIDI
            The MIDI data returned by Basic Pitch's ``predict()``.
        tempo_bpm : float
            Authoritative tempo in BPM (use TimingAnalyzer on the mix,
            not Basic Pitch's estimate, for accuracy).
        time_sig : str
            "4/4", "3/4", etc.
        title : str
            Score title.

        Returns
        -------
        ScoreModel
            Populated with one ScorePart containing real notes.
        """
        beats_per_measure = _parse_time_sig_beats(time_sig)
        seconds_per_beat = 60.0 / max(tempo_bpm, 1.0)
        seconds_per_measure = beats_per_measure * seconds_per_beat

        # Collect all notes across all instruments
        all_notes: list[pretty_midi.Note] = []
        for instrument in midi_data.instruments:
            all_notes.extend(instrument.notes)

        # Filter low-confidence / inaudible notes
        all_notes = [n for n in all_notes if n.velocity >= self.min_velocity]

        if not all_notes:
            # Return empty single-measure score
            return self._empty_score(title, int(round(tempo_bpm)), time_sig)

        # Determine total number of measures from the last note's end time
        max_end_time = max(n.end for n in all_notes)
        total_measures = max(1, math.ceil(max_end_time / seconds_per_measure))

        # Build measure dictionary  measure_number (1-based) → list[ScoreNote]
        measures_dict: dict[int, list[ScoreNote]] = {
            m: [] for m in range(1, total_measures + 1)
        }

        for note in sorted(all_notes, key=lambda n: n.start):
            measure_number = int(note.start / seconds_per_measure) + 1
            measure_number = min(measure_number, total_measures)

            beat_in_measure = (note.start % seconds_per_measure) / seconds_per_beat
            position = _snap_position(beat_in_measure)

            duration_beats = (note.end - note.start) / seconds_per_beat
            if duration_beats < _MIN_NOTE_BEATS:
                continue  # discard noise / very short artefacts
            duration_str = _snap_duration(duration_beats)

            score_note = ScoreNote(
                pitch=_midi_pitch_to_name(note.pitch),
                duration=duration_str,
                is_rest=False,
                position=position,
                velocity=note.velocity,
                start_time_s=float(note.start),
                end_time_s=float(note.end),
            )
            measures_dict[measure_number].append(score_note)

        # Build ScoreMeasures — add a whole rest to empty measures
        score_measures: list[ScoreMeasure] = []
        for m_num in range(1, total_measures + 1):
            notes = measures_dict[m_num]
            if not notes:
                notes = [ScoreNote(pitch="C4", duration="whole", is_rest=True, position=0)]
            score_measures.append(ScoreMeasure(number=m_num, notes=notes))

        part = ScorePart(
            name=self.instrument_name,
            instrument=self.instrument_name.lower(),
            clef=self.clef,
            measures=score_measures,
        )

        return ScoreModel(
            title=title,
            tempo=int(round(tempo_bpm)),
            key="C",  # key detection is out-of-scope for MIDI transcription
            time_sig=time_sig,
            parts=[part],
            source="basic_pitch",
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _empty_score(self, title: str, tempo: int, time_sig: str) -> ScoreModel:
        """Return a minimal 4-measure rest score when no notes are detected."""
        measures = [
            ScoreMeasure(
                number=m,
                notes=[ScoreNote(pitch="C4", duration="whole", is_rest=True, position=0)],
            )
            for m in range(1, 5)
        ]
        part = ScorePart(
            name=self.instrument_name,
            instrument=self.instrument_name.lower(),
            clef=self.clef,
            measures=measures,
        )
        return ScoreModel(
            title=title, tempo=tempo, key="C", time_sig=time_sig, parts=[part], source="basic_pitch"
        )


def _parse_time_sig_beats(time_sig: str) -> int:
    """Return the number of beats per measure from a "4/4"-style string."""
    try:
        beats, _ = time_sig.split("/")
        return int(beats)
    except Exception:
        return 4
