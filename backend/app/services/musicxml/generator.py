"""
MusicXML 3.1 generator.

Converts a ScoreModel into a valid MusicXML document string.
Supports:
  - Single part / instrument
  - Time signature, key signature (by key name), clef, tempo
  - Measures with notes and whole-rests
  - Chord symbols (<harmony> elements)

Usage:
    xml_str = MusicXMLGenerator().generate(score)
    Path("chart.xml").write_text(xml_str, encoding="utf-8")
"""

import xml.etree.ElementTree as ET
from xml.dom import minidom

from app.services.score.model import ScoreMeasure, ScoreModel, ScoreNote, ScorePart

# Circle-of-fifths value for common key names
_KEY_FIFTHS: dict[str, int] = {
    "C": 0,
    "G": 1,
    "D": 2,
    "A": 3,
    "E": 4,
    "B": 5,
    "F#": 6,
    "Gb": -6,
    "Db": -5,
    "Ab": -4,
    "Eb": -3,
    "Bb": -2,
    "F": -1,
}

# divisions = number of ticks per quarter note
_DIVISIONS = 4

_DURATION_TICKS: dict[str, int] = {
    "whole": 16,
    "half": 8,
    "quarter": 4,
    "eighth": 2,
    "16th": 1,
    # Dotted variants — 1.5× the base tick count
    "dotted-whole": 24,
    "dotted-half": 12,
    "dotted-quarter": 6,
    "dotted-eighth": 3,
}

# MusicXML <type> values (same as duration names, mostly)
_DURATION_TYPE: dict[str, str] = {
    "whole": "whole",
    "half": "half",
    "quarter": "quarter",
    "eighth": "eighth",
    "16th": "16th",
    # Dotted variants map to the base <type> (the <dot/> element signals the dot)
    "dotted-whole": "whole",
    "dotted-half": "half",
    "dotted-quarter": "quarter",
    "dotted-eighth": "eighth",
}

# Durations eligible for beaming
_BEAMABLE: frozenset[str] = frozenset({"eighth", "16th"})

# ─── Notehead mapping ─────────────────────────────────────────────────────────
# Maps notehead_type string → (MusicXML type, filled attribute or None)
_NOTEHEAD_MAP: dict[str, tuple[str, str | None]] = {
    "x":            ("x", None),
    "circle-x":     ("circle-x", None),
    "diamond":      ("diamond", "yes"),
    "diamond-open": ("diamond", None),
    "triangle":     ("triangle", None),
    "square":       ("square", None),
    "slash":        ("slash", None),
    "normal":       ("normal", None),
}

# ─── Articulation routing ─────────────────────────────────────────────────────
# Mapped as child element names inside <articulations>
_ARTIC_ARTICULATIONS: frozenset[str] = frozenset({
    "staccato", "staccatissimo", "tenuto", "accent", "strong-accent",
    "stress", "unstress", "detached-legato", "soft-accent",
    "spiccato", "scoop", "plop", "doit", "falloff", "breath-mark", "caesura",
})
# Mapped inside <technical>
_ARTIC_TECHNICAL: frozenset[str] = frozenset({
    "up-bow", "down-bow", "harmonic", "snap-pizzicato", "stopped",
    "open-string", "thumb-position",
})
# Mapped inside <ornaments>
_ARTIC_ORNAMENTS: frozenset[str] = frozenset({
    "trill-mark", "mordent", "inverted-mordent", "turn", "inverted-turn",
    "shake", "wavy-line", "tremolo",
})

# ─── Dynamics ─────────────────────────────────────────────────────────────────
# Standard dynamics that map to <dynamics> child elements
_DYNAMICS_ELEMENTS: frozenset[str] = frozenset({
    "pppp", "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "ffff",
    "sfp", "sfpp", "sfz", "sffz", "fz", "rf", "rfz", "n", "pf",
})
# Hairpins / text dynamics mapped to <words>
_DYNAMICS_WORDS: dict[str, str] = {
    "<":  "cresc.",
    ">":  "dim.",
    "fp": "fp",
}


# ─── Beaming helpers ──────────────────────────────────────────────────────────


def _get_beam_windows(time_sig: str) -> list[tuple[int, int]]:
    """
    Return [start, end) half-open intervals (16th-note slots) defining the
    rhythmic groups within which notes may be beamed.  Mirrors the TypeScript
    getBeamWindows() in frontend/src/lib/beaming.ts.
    """
    try:
        parts = time_sig.split("/")
        n, d = int(parts[0]), int(parts[1]) if len(parts) > 1 else 4
    except (ValueError, IndexError):
        n, d = 4, 4

    # Compound meters (6/8, 9/8, 12/8): groups of 3 eighth notes
    if d == 8 and n % 3 == 0:
        group_slots = 6
        count = n // 3
        return [(i * group_slots, (i + 1) * group_slots) for i in range(count)]

    if n == 4 and d == 4:
        return [(0, 8), (8, 16)]
    if n == 2 and d == 4:
        return [(0, 8)]
    if n == 3 and d == 4:
        return [(0, 4), (4, 8), (8, 12)]

    # Fallback: per-beat groups
    beat_slots = round(16 / d)
    return [(i * beat_slots, (i + 1) * beat_slots) for i in range(n)]


def _compute_beam_roles(
    notes: list[ScoreNote],
    time_sig: str,
) -> list[tuple[str, int]]:
    """
    Compute (role, group_id) for each note in *notes* (same order).
    role: "begin" | "continue" | "end" | "none".
    Mirrors the TypeScript computeBeaming() logic.
    """
    roles: list[list] = [["none", -1] for _ in notes]

    # Sort by position, keeping original indices
    indexed = sorted(
        enumerate(notes),
        key=lambda x: (
            x[1].notation_position if x[1].notation_position is not None else x[1].position
        ),
    )

    windows = _get_beam_windows(time_sig)
    next_group = 0

    for win_start, win_end in windows:
        in_window = [
            (i, n)
            for i, n in indexed
            if win_start
            <= (n.notation_position if n.notation_position is not None else n.position)
            < win_end
        ]

        run_indices: list[int] = []
        prev_end = -1

        for orig_i, n in in_window:
            pos = n.notation_position if n.notation_position is not None else n.position
            dur = n.notation_duration or n.duration
            dur_slots = _DURATION_TICKS.get(dur, 4)

            if n.is_rest or dur not in _BEAMABLE:
                if len(run_indices) >= 2:
                    _flush_beam_run(run_indices, roles, next_group)
                    next_group += 1
                run_indices = []
                prev_end = pos + dur_slots
                continue

            if run_indices and pos != prev_end:
                if len(run_indices) >= 2:
                    _flush_beam_run(run_indices, roles, next_group)
                    next_group += 1
                run_indices = []

            run_indices.append(orig_i)
            prev_end = pos + dur_slots

        if len(run_indices) >= 2:
            _flush_beam_run(run_indices, roles, next_group)
            next_group += 1

    return [tuple(r) for r in roles]  # type: ignore[return-value]


def _flush_beam_run(
    indices: list[int],
    roles: list[list],
    group_id: int,
) -> None:
    if len(indices) < 2:
        return
    roles[indices[0]][0] = "begin"
    roles[indices[0]][1] = group_id
    for k in range(1, len(indices) - 1):
        roles[indices[k]][0] = "continue"
        roles[indices[k]][1] = group_id
    roles[indices[-1]][0] = "end"
    roles[indices[-1]][1] = group_id


def _measure_capacity(time_sig: str) -> int:
    """
    Return the total 16th-note slots available in one measure of *time_sig*.
    Formula: (numerator * 16) // denominator
      4/4  → 16,  3/4 → 12,  2/4 → 8
      6/8  → 12,  9/8 → 18,  12/8 → 24
    """
    try:
        parts = time_sig.split("/")
        n, d = int(parts[0]), int(parts[1]) if len(parts) > 1 else 4
    except (ValueError, IndexError):
        n, d = 4, 4
    return (n * 16) // d


# Durations in descending order of length — used for clamping (dotted variants interleaved)
_DURATIONS_DESC = (
    "dotted-whole", "whole",
    "dotted-half", "half",
    "dotted-quarter", "quarter",
    "dotted-eighth", "eighth",
    "16th",
)


def _largest_fitting_duration(slots: int) -> str | None:
    """Return the longest standard duration whose tick count fits within *slots*."""
    for dur in _DURATIONS_DESC:
        if _DURATION_TICKS[dur] <= slots:
            return dur
    return None


def _write_fill_rests(parent: ET.Element, start: int, end: int) -> None:
    """
    Append rest <note> elements to *parent* to fill the slot range [start, end).
    Uses greedy largest-first fill so the fewest elements are written.
    """
    pos = start
    while pos < end:
        remaining = end - pos
        dur = _largest_fitting_duration(remaining)
        if dur is None:
            break
        rest_el = ET.SubElement(parent, "note")
        ET.SubElement(rest_el, "rest")
        _sub(rest_el, "duration", str(_DURATION_TICKS[dur]))
        _sub(rest_el, "type", _DURATION_TYPE[dur])
        if dur.startswith("dotted-"):
            ET.SubElement(rest_el, "dot")
        pos += _DURATION_TICKS[dur]


def _sub(parent: ET.Element, tag: str, text: str | None = None, **attrib: str) -> ET.Element:
    el = ET.SubElement(parent, tag, **attrib)
    if text is not None:
        el.text = text
    return el


def _parse_pitch(pitch_str: str) -> tuple[str, str | None, int]:
    """
    Parse a pitch string like "C4", "D#3", "Bb5".
    Returns (step, alter_str_or_None, octave).
    alter_str: "1" for sharp, "-1" for flat.
    """
    s = pitch_str.strip()
    # Step is always first char
    step = s[0].upper()
    octave_part = s[-1]
    alter_part = s[1:-1]  # everything between step and octave digit

    try:
        octave = int(octave_part)
    except ValueError:
        octave = 4  # fallback

    alter: str | None = None
    if alter_part == "#":
        alter = "1"
    elif alter_part in ("b", "♭"):
        alter = "-1"

    return step, alter, octave


def _build_note_element(
    note: ScoreNote,
    beam_role: str = "none",
    duration_override: str | None = None,
) -> ET.Element:
    el = ET.Element("note")
    # Use notation_duration when available (quantized for clean measure rendering);
    # fall back to the raw-snapped duration for backward compat.
    # duration_override takes highest precedence (used for capacity clamping).
    effective_duration = duration_override or note.notation_duration or note.duration
    ticks = _DURATION_TICKS.get(effective_duration, 4)
    note_type = _DURATION_TYPE.get(effective_duration, "quarter")

    if note.is_rest:
        ET.SubElement(el, "rest")
    else:
        pitch_el = _sub(el, "pitch")
        step, alter, octave = _parse_pitch(note.pitch)
        _sub(pitch_el, "step", step)
        if alter is not None:
            _sub(pitch_el, "alter", alter)
        _sub(pitch_el, "octave", str(octave))

    _sub(el, "duration", str(ticks))

    # Tie start (must come after <duration>, before <type>)
    if note.tied_to_next and not note.is_rest:
        ET.SubElement(el, "tie", type="start")

    _sub(el, "type", note_type)
    # Dotted durations require a <dot/> child element in MusicXML
    if effective_duration.startswith("dotted-"):
        ET.SubElement(el, "dot")

    # Stem direction override
    if note.stem_direction and not note.is_rest:
        stem_el = ET.SubElement(el, "stem")
        stem_el.text = note.stem_direction

    # Notehead (must come after <stem> in MusicXML order)
    nh_type = note.notehead_type
    if nh_type and nh_type != "normal" and not note.is_rest:
        nh_xml, filled = _NOTEHEAD_MAP.get(nh_type, (nh_type, None))
        attrib: dict[str, str] = {}
        if filled is not None:
            attrib["filled"] = filled
        nh_el = ET.SubElement(el, "notehead", **attrib)
        nh_el.text = nh_xml

    # Beam elements — only for beamable notes in a group
    if beam_role != "none" and effective_duration in _BEAMABLE:
        beam1 = ET.SubElement(el, "beam", number="1")
        beam1.text = beam_role
        # 16th notes carry a second beam level
        if effective_duration == "16th":
            beam2 = ET.SubElement(el, "beam", number="2")
            beam2.text = beam_role

    # Notations block (ties, slurs, articulations, arpeggio, tremolo)
    if not note.is_rest:
        _build_notations(note, el)

    return el


def _build_notations(note: ScoreNote, parent: ET.Element) -> None:
    """Append a <notations> block to *parent* if the note has any notation extras."""
    notations_needed = (
        note.tied_to_next
        or note.slur
        or note.articulation
        or note.arpeggio
        or note.tremolo
    )
    if not notations_needed:
        return

    notations = ET.SubElement(parent, "notations")

    if note.tied_to_next:
        ET.SubElement(notations, "tied", type="start")

    if note.slur:
        ET.SubElement(notations, "slur", type=note.slur, number="1")

    if note.arpeggio:
        ET.SubElement(notations, "arpeggiate")

    # Articulations block
    artic = note.articulation
    if artic:
        if artic == "fermata":
            ET.SubElement(notations, "fermata")
        elif artic in _ARTIC_ARTICULATIONS:
            artic_el = ET.SubElement(notations, "articulations")
            ET.SubElement(artic_el, artic)
        elif artic in _ARTIC_TECHNICAL:
            tech_el = ET.SubElement(notations, "technical")
            ET.SubElement(tech_el, artic)
        elif artic in _ARTIC_ORNAMENTS:
            if artic == "tremolo" and note.tremolo:
                orn_el = ET.SubElement(notations, "ornaments")
                tr = ET.SubElement(orn_el, "tremolo", type="single")
                tr.text = str(note.tremolo)
            else:
                orn_el = ET.SubElement(notations, "ornaments")
                ET.SubElement(orn_el, artic)
    elif note.tremolo:
        orn_el = ET.SubElement(notations, "ornaments")
        tr = ET.SubElement(orn_el, "tremolo", type="single")
        tr.text = str(note.tremolo)


def _add_dynamic_direction(parent: ET.Element, dynamic: str) -> None:
    """Append a <direction> element for the given dynamic marking."""
    direction = ET.SubElement(parent, "direction", placement="below")
    dir_type = ET.SubElement(direction, "direction-type")
    if dynamic in _DYNAMICS_ELEMENTS:
        dyn_el = ET.SubElement(dir_type, "dynamics")
        ET.SubElement(dyn_el, dynamic)
    else:
        words_text = _DYNAMICS_WORDS.get(dynamic, dynamic)
        words = ET.SubElement(dir_type, "words")
        words.text = words_text


def _add_octave_shift(parent: ET.Element, ottava: str) -> None:
    """Append an ottava (octave-shift) direction pair to *parent*."""
    _OTTAVA_MAP: dict[str, tuple[str, int]] = {
        "8va":  ("up",   8),
        "8vb":  ("down", 8),
        "15ma": ("up",  15),
        "15mb": ("down", 15),
    }
    if ottava not in _OTTAVA_MAP:
        return
    shift_type, size = _OTTAVA_MAP[ottava]
    # start
    dir_start = ET.SubElement(parent, "direction", placement="above")
    dt_start = ET.SubElement(dir_start, "direction-type")
    ET.SubElement(dt_start, "octave-shift", type=shift_type, size=str(size), number="1")
    # stop (immediately after the note in MusicXML)
    dir_stop = ET.SubElement(parent, "direction", placement="above")
    dt_stop = ET.SubElement(dir_stop, "direction-type")
    ET.SubElement(dt_stop, "octave-shift", type="stop", size=str(size), number="1")


def _add_repeat_barline(parent: ET.Element, location: str, direction: str) -> None:
    """Append a repeat barline element to a measure."""
    barline = ET.SubElement(parent, "barline", location=location)
    bar_style = ET.SubElement(barline, "bar-style")
    bar_style.text = "heavy-light" if direction == "forward" else "light-heavy"
    ET.SubElement(barline, "repeat", direction=direction)


def _add_navigation_direction(parent: ET.Element, navigation: str) -> None:
    """Append a D.C./D.S./Fine/etc. direction element."""
    _NAV_TEXT: dict[str, str] = {
        "dc":          "D.C.",
        "ds":          "D.S.",
        "dc-al-fine":  "D.C. al Fine",
        "ds-al-coda":  "D.S. al Coda",
        "dc-al-coda":  "D.C. al Coda",
    }
    _NAV_SOUND: dict[str, dict[str, str]] = {
        "dc":         {"dacapo": "yes"},
        "ds":         {"dalsegno": "yes"},
        "dc-al-fine": {"dacapo": "yes"},
        "ds-al-coda": {"dalsegno": "yes"},
        "dc-al-coda": {"dacapo": "yes"},
    }
    text = _NAV_TEXT.get(navigation)
    sound_attrs = _NAV_SOUND.get(navigation)
    if text is None:
        return
    direction = ET.SubElement(parent, "direction", placement="above")
    dir_type = ET.SubElement(direction, "direction-type")
    words = ET.SubElement(dir_type, "words")
    words.text = text
    if sound_attrs:
        ET.SubElement(direction, "sound", **sound_attrs)


def _build_harmony_element(chord_symbol: str) -> ET.Element:
    """Build a <harmony> element for a chord symbol string (e.g. "Am7")."""
    harmony = ET.Element("harmony")
    root = _sub(harmony, "root")

    # Simple chord parsing: first char is root step, optional #/b, remainder is kind
    s = chord_symbol.strip()
    if not s:
        return harmony

    root_step = s[0].upper()
    _sub(root, "root-step", root_step)

    rest = s[1:]
    if rest.startswith("#"):
        _sub(root, "root-alter", "1")
        rest = rest[1:]
    elif rest.startswith("b"):
        _sub(root, "root-alter", "-1")
        rest = rest[1:]

    # Map common chord quality tokens to MusicXML kind values
    kind_map = {
        "m7": "minor-seventh",
        "maj7": "major-seventh",
        "7": "dominant",
        "m": "minor",
        "dim": "diminished",
        "aug": "augmented",
        "sus2": "suspended-second",
        "sus4": "suspended-fourth",
        "": "major",
    }
    kind_text = kind_map.get(rest, "major")
    _sub(harmony, "kind", kind_text)
    return harmony


def _build_measure(
    measure: ScoreMeasure,
    measure_number: int,
    is_first: bool,
    chart_time_sig: str,
    chart_key: str,
    chart_tempo: int,
    part_clef: str,
) -> ET.Element:
    m_el = ET.Element("measure", number=str(measure_number))

    # --- <attributes> block (required on first measure, and on time-sig changes) ---
    time_sig = measure.time_sig_override or (chart_time_sig if is_first else None)
    need_attributes = is_first or time_sig is not None

    if need_attributes:
        attrs = _sub(m_el, "attributes")
        _sub(attrs, "divisions", str(_DIVISIONS))

        if is_first:
            key_el = _sub(attrs, "key")
            fifths = _KEY_FIFTHS.get(chart_key, 0)
            _sub(key_el, "fifths", str(fifths))

        if time_sig:
            beats, beat_type = (time_sig.split("/") + ["4"])[:2]
            time_el = _sub(attrs, "time")
            _sub(time_el, "beats", beats)
            _sub(time_el, "beat-type", beat_type)

        if is_first:
            clef_el = _sub(attrs, "clef")
            if part_clef == "treble":
                _sub(clef_el, "sign", "G")
                _sub(clef_el, "line", "2")
            elif part_clef == "bass":
                _sub(clef_el, "sign", "F")
                _sub(clef_el, "line", "4")
            elif part_clef == "alto":
                _sub(clef_el, "sign", "C")
                _sub(clef_el, "line", "3")
            elif part_clef == "tenor":
                _sub(clef_el, "sign", "C")
                _sub(clef_el, "line", "4")
            elif part_clef == "percussion":
                _sub(clef_el, "sign", "percussion")

    # --- Repeat barlines at start of measure ---
    if measure.repeat_start or measure.repeat_both:
        _add_repeat_barline(m_el, "left", "forward")

    # --- Tempo direction on first measure ---
    if is_first:
        direction = _sub(m_el, "direction", placement="above")
        dir_type = _sub(direction, "direction-type")
        metro = _sub(dir_type, "metronome", parentheses="no")
        _sub(metro, "beat-unit", "quarter")
        _sub(metro, "per-minute", str(chart_tempo))
        _sub(direction, "sound", tempo=str(chart_tempo))

    # --- Chord symbol ---
    if measure.chord_symbol:
        m_el.append(_build_harmony_element(measure.chord_symbol))

    # --- Segno / Coda markers ---
    if measure.segno:
        seg_dir = ET.SubElement(m_el, "direction", placement="above")
        seg_dt = ET.SubElement(seg_dir, "direction-type")
        ET.SubElement(seg_dt, "segno")
        ET.SubElement(seg_dir, "sound", segno="yes")

    if measure.coda:
        coda_dir = ET.SubElement(m_el, "direction", placement="above")
        coda_dt = ET.SubElement(coda_dir, "direction-type")
        ET.SubElement(coda_dt, "coda")
        ET.SubElement(coda_dir, "sound", coda="yes")

    # --- Volta (1st/2nd ending) bracket ---
    if measure.volta:
        volta_dir = ET.SubElement(m_el, "direction", placement="above")
        volta_dt = ET.SubElement(volta_dir, "direction-type")
        bracket = ET.SubElement(volta_dt, "bracket",
                                type="start",
                                number="1",
                                **{"line-end": "down"})
        ET.SubElement(volta_dir, "sound", **{"time-only": str(measure.volta)})

    # --- Notes ---
    if measure.notes:
        # Sort by notation_position when available, else raw position
        sorted_notes = sorted(
            measure.notes,
            key=lambda n: n.notation_position if n.notation_position is not None else n.position,
        )
        effective_time_sig = measure.time_sig_override or chart_time_sig
        capacity = _measure_capacity(effective_time_sig)
        beam_roles = _compute_beam_roles(sorted_notes, effective_time_sig)
        cursor = 0          # tracks the next unfilled slot
        notes_written = 0
        for note, (role, _group_id) in zip(sorted_notes, beam_roles):
            pos = note.notation_position if note.notation_position is not None else note.position
            # Skip notes that start at or beyond the measure boundary
            if pos >= capacity:
                continue
            # Fill any gap between the current cursor and this note's start
            if pos > cursor:
                _write_fill_rests(m_el, cursor, pos)
                cursor = pos
            effective_dur = note.notation_duration or note.duration
            ticks = _DURATION_TICKS.get(effective_dur, 4)
            duration_override: str | None = None
            if pos + ticks > capacity:
                # Clamp to the largest duration that fits in the remaining slots
                clamped = _largest_fitting_duration(capacity - pos)
                if clamped is None:
                    continue  # no standard duration fits; skip
                duration_override = clamped
                ticks = _DURATION_TICKS[clamped]
            m_el.append(_build_note_element(note, beam_role=role, duration_override=duration_override))
            notes_written += 1
            cursor = pos + ticks
            # Dynamics direction immediately after the note
            if note.dynamic:
                _add_dynamic_direction(m_el, note.dynamic)
            # Octave shift direction immediately after the note
            if note.ottava:
                _add_octave_shift(m_el, note.ottava)
        # Fill any remaining space after the last note
        if cursor < capacity:
            _write_fill_rests(m_el, cursor, capacity)
        if notes_written == 0:
            # All notes were out-of-bounds; _write_fill_rests already covered 0→capacity.
            # If cursor is still 0 the fill loop above ran; nothing more to do.
            pass
    else:
        # Default: whole rest for a completely empty measure
        rest_el = ET.SubElement(m_el, "note")
        ET.SubElement(rest_el, "rest", measure="yes")
        _sub(rest_el, "duration", str(_DURATION_TICKS["whole"]))
        _sub(rest_el, "type", "whole")

    # --- Fine marking ---
    if measure.fine:
        fine_dir = ET.SubElement(m_el, "direction", placement="above")
        fine_dt = ET.SubElement(fine_dir, "direction-type")
        words = ET.SubElement(fine_dt, "words")
        words.text = "Fine"
        ET.SubElement(fine_dir, "sound", fine="yes")

    # --- Navigation (D.C. / D.S. / etc.) ---
    if measure.navigation:
        _add_navigation_direction(m_el, measure.navigation)

    # --- Repeat barline at end of measure ---
    if measure.repeat_end or measure.repeat_both:
        _add_repeat_barline(m_el, "right", "backward")

    return m_el


class MusicXMLGenerator:
    """Converts a ScoreModel into a MusicXML 3.1 document string."""

    def generate(self, score: ScoreModel) -> str:
        """Return a pretty-printed MusicXML string."""
        root = ET.Element(
            "score-partwise",
            version="3.1",
        )

        # <work>
        work = _sub(root, "work")
        _sub(work, "work-title", score.title)

        # <part-list>
        part_list = _sub(root, "part-list")

        parts = score.parts if score.parts else [ScorePart()]  # type: ignore[list-item]

        for i, part in enumerate(parts):
            part_id = f"P{i + 1}"
            score_part = _sub(part_list, "score-part", id=part_id)
            _sub(score_part, "part-name", part.name)

        # <part> elements
        for i, part in enumerate(parts):
            part_id = f"P{i + 1}"
            part_el = _sub(root, "part", id=part_id)

            measures = part.measures
            # Guarantee at least one measure
            if not measures:
                from app.services.score.model import ScoreMeasure as SM

                measures = [SM(number=1)]

            for j, measure in enumerate(measures):
                m_el = _build_measure(
                    measure=measure,
                    measure_number=measure.number,
                    is_first=(j == 0),
                    chart_time_sig=score.time_sig,
                    chart_key=score.key,
                    chart_tempo=score.tempo,
                    part_clef=part.clef,
                )
                part_el.append(m_el)

        return self._pretty(root)

    @staticmethod
    def _pretty(root: ET.Element) -> str:
        raw = ET.tostring(root, encoding="unicode", xml_declaration=False)
        reparsed = minidom.parseString(raw)
        pretty = reparsed.toprettyxml(indent="  ")
        # toprettyxml adds its own <?xml?> declaration; replace with standard one
        lines = pretty.splitlines()
        if lines and lines[0].startswith("<?xml"):
            lines[0] = '<?xml version="1.0" encoding="UTF-8"?>'
        return "\n".join(lines)
