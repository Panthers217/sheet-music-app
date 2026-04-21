/**
 * drumNotation.ts — Standard drum set notation helpers.
 *
 * Maps staff pitch positions to notehead types used in conventional
 * published drum notation (e.g. Hal Leonard, Modern Drummer standard).
 *
 * When the score editor is in percussion clef mode, these mappings are
 * applied automatically so the correct notehead shapes appear for each
 * drum/cymbal position.
 *
 * Pitch positions use treble-staff pitch names (the same coordinate
 * system as the rest of the editor).  Staff lines for reference:
 *   Line 5 (top) = F5,  Line 4 = D5,  Line 3 = B4,
 *   Line 2       = G4,  Line 1 (bot) = E4
 */

import type { NoteheadType } from "@/components/score/NoteEditorToolbar";

// ─── Drum notehead map ────────────────────────────────────────────────────────
// Keys are base pitch + octave (no accidentals — percussion notes are unpitched).
// Cymbals / hi-hat use "x" or "circle-x"; drums / toms use "normal".

export const DRUM_NOTEHEAD_MAP: Record<string, NoteheadType> = {
  // ── Above / at top of staff (cymbals) ──────────────────────────────
  "A5": "x",          // Crash Cymbal 2   (above top line)
  "G5": "circle-x",   // Hi-Hat Open / Splash  (ledger space above F5)
  "F5": "x",          // Crash Cymbal 1 / Closed Hi-Hat  (line 5 — top)
  "E5": "x",          // Splash Cymbal / Cowbell  (space 4)
  "D5": "x",          // Ride Cymbal              (line 4)

  // ── On-staff (toms & drums — normal noteheads) ──────────────────────
  "C5": "normal",     // High Tom 1   (space 3)
  "B4": "normal",     // High Tom 2   (line 3 — middle)
  "A4": "normal",     // Snare Drum   (space 2)
  "G4": "normal",     // Low Tom      (line 2)
  "F4": "normal",     // Floor Tom    (space 1)
  "E4": "normal",     // Bass Drum    (line 1 — bottom)

  // ── Below staff ────────────────────────────────────────────────────
  "D4": "normal",     // Bass Drum 2  (first space below staff)
  "C4": "x",          // Hi-Hat Foot  (first ledger line below)
  "B3": "x",          // Hi-Hat Foot  (below first ledger line)
};

// ─── Instrument label map ─────────────────────────────────────────────────────
// Human-readable names shown as tooltips / hover labels in percussion mode.

export const DRUM_INSTRUMENT_LABELS: Record<string, string> = {
  "A5": "Crash 2",
  "G5": "Hi-Hat (open)",
  "F5": "Crash 1",
  "E5": "Splash",
  "D5": "Ride",
  "C5": "Hi Tom 1",
  "B4": "Hi Tom 2",
  "A4": "Snare",
  "G4": "Lo Tom",
  "F4": "Floor Tom",
  "E4": "Bass Drum",
  "D4": "Bass Drum 2",
  "C4": "Hi-Hat Foot",
  "B3": "Hi-Hat Foot",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the standard drum notehead shape for a given staff pitch when in
 * percussion clef.  Strips accidentals before looking up so that e.g. "C#4"
 * resolves to the same position as "C4".
 * Falls back to "normal" for pitches not in the map.
 */
export function getDrumNotehead(pitch: string): NoteheadType {
  const base = pitch.replace(/[#b]+/, "");
  return DRUM_NOTEHEAD_MAP[base] ?? "normal";
}

/**
 * Returns the human-readable instrument name for a staff position in
 * percussion clef, or an empty string if no label is defined.
 */
export function getDrumLabel(pitch: string): string {
  const base = pitch.replace(/[#b]+/, "");
  return DRUM_INSTRUMENT_LABELS[base] ?? "";
}
