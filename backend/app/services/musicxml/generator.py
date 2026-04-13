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
}

# MusicXML <type> values (same as duration names, mostly)
_DURATION_TYPE: dict[str, str] = {
    "whole": "whole",
    "half": "half",
    "quarter": "quarter",
    "eighth": "eighth",
    "16th": "16th",
}


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


def _build_note_element(note: ScoreNote) -> ET.Element:
    el = ET.Element("note")
    ticks = _DURATION_TICKS.get(note.duration, 4)
    note_type = _DURATION_TYPE.get(note.duration, "quarter")

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
    _sub(el, "type", note_type)
    return el


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
            _sub(clef_el, "sign", "G" if part_clef == "treble" else "F")
            _sub(clef_el, "line", "2" if part_clef == "treble" else "4")

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

    # --- Notes ---
    if measure.notes:
        for note in sorted(measure.notes, key=lambda n: n.position):
            m_el.append(_build_note_element(note))
    else:
        # Default: whole rest
        rest_el = ET.SubElement(m_el, "note")
        ET.SubElement(rest_el, "rest", measure="yes")
        _sub(rest_el, "duration", str(_DURATION_TICKS["whole"]))
        _sub(rest_el, "type", "whole")

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
