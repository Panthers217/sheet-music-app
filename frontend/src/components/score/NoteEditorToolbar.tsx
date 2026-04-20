"use client";

import React, { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NoteDuration = "whole" | "half" | "quarter" | "eighth" | "16th";

export type ClefType = "treble" | "bass" | "alto" | "tenor" | "percussion";

/** Shape of the notehead drawn on the staff. */
export type NoteheadType =
  | "normal"         // standard filled/hollow oval
  | "slash"          // diagonal slash (rhythmic notation)
  | "x"              // cross / ghost note
  | "circle-x"       // circle with X (open hi-hat, harmonics)
  | "diamond"        // filled diamond (harmonics, sul ponticello)
  | "diamond-open"   // open diamond (artificial harmonics)
  | "triangle"       // triangle up (special technique)
  | "square"         // square notehead
  | "back-slash";    // back-slash (clusters)

/** Number of tremolo slashes through/on the stem (0 = none). */
export type TremoloBeams = 0 | 1 | 2 | 3 | 4;

export type Articulation =
  | ""
  // Touch / pressure marks
  | "staccato"        // dot above/below note
  | "staccatissimo"   // wedge / short stroke
  | "tenuto"          // line: held for full value
  | "portato"         // tenuto + staccato combined
  // Emphasis marks
  | "accent"          // > standard accent
  | "marcato"         // ^ strong/forced accent
  | "stress"          // agogic stress (slanted wedge)
  | "strong-accent"   // marcatissimo
  // Bowing / technique marks (strings, winds)
  | "up-bow"          // V symbol
  | "down-bow"        // square symbol
  | "snap-pizzicato"  // Bartók pizzicato circle+dot
  | "left-hand-pizzicato" // + over note
  | "harmonic"        // open circle
  | "spiccato"        // dot with bow indication
  // Breath / pause
  | "fermata"         // pause arc + dot
  | "fermata-short"   // short fermata
  | "fermata-long"    // long fermata (square)
  | "breath-mark"     // ' comma above staff
  | "caesura"         // // slash
  // Classical ornaments (Bravura U+E560–)
  | "trill"           // tr~ symbol
  | "trill-wavy"      // trill + extension wavy line
  | "turn"            // turn ~ S-curve
  | "turn-inverted"   // inverted turn
  | "mordent"         // lower mordent (wavy squiggle)
  | "mordent-inverted"// upper mordent / prall-triller
  | "prall-prall"     // double prall
  | "tremblement"     // tremblement / compound trill
  | "shake"           // shake (Baroque)
  | "schleifer"       // Schleifer ascending slides
  // Jazz / pop ornaments
  | "doit"            // upward scoop after note
  | "fall"            // downward fall after note
  | "plop"            // downward approach
  | "scoop"           // upward approach
  | "glissando"       // gliss. line
  // Trills / ornament ext.
  | "arpeggio-up"     // rolled chord upward
  | "arpeggio-down"   // rolled chord downward
  | "vibrato";        // vibrato ~ wavy line

export type Dynamic =
  | ""
  | "pppp" | "ppp" | "pp" | "p"
  | "mp" | "mf"
  | "f" | "ff" | "fff" | "ffff"
  | "fp"   // forte-piano
  | "fz"   // forzando
  | "sfz"  // sforzando
  | "sff"  // sforzatissimo
  | "sffz"
  | "sf"   // subito forte
  | "rfz"  // rinforzando
  | "rf"   // rinforzando
  | "<"    // crescendo hairpin
  | ">";   // decrescendo hairpin

export interface ToolState {
  duration:     NoteDuration;
  dotted:       boolean;      // dotted modifier — 1.5× the base duration
  isRest:       boolean;
  noteName:     string;       // "C" | "D" | "E" | "F" | "G" | "A" | "B"
  accidental:   string;       // "" | "#" | "b" | "##" | "bb"
  octave:       number;       // 2–6
  articulation: Articulation; // notation mark placed on the note
  dynamic:      Dynamic;      // dynamic marking placed at note entry
  selectMode:   boolean;      // when true, clicks select notes instead of placing
  noteheadType: NoteheadType; // shape of notehead
  tremolo:      TremoloBeams; // tremolo slash count (0 = none)
  tiedToNext:   boolean;      // tie this note to the next same-pitch note
  slurStart:    boolean;      // marks start of a slur phrase
  arpeggio:     boolean;      // rolled chord (arpeggio wavy line)
  ottava:       string;       // "" | "8va" | "8vb" | "15ma" | "15mb"
}

export const DEFAULT_TOOL: ToolState = {
  duration:     "quarter",
  dotted:       false,
  isRest:       false,
  noteName:     "C",
  accidental:   "",
  octave:       4,
  articulation: "",
  dynamic:      "",
  selectMode:   false,
  noteheadType: "normal",
  tremolo:      0,
  tiedToNext:   false,
  slurStart:    false,
  arpeggio:     false,
  ottava:       "",
};

export function buildPitch(tool: ToolState): string {
  return `${tool.noteName}${tool.accidental}${tool.octave}`;
}

interface Props {
  tool:           ToolState;
  onToolChange:   (t: ToolState) => void;
  timeSig:        string;
  onTimeSigChange: (ts: string) => void;
  clef:            ClefType;
  onClefChange:    (c: ClefType) => void;
}

// ---------------------------------------------------------------------------
// SVG icon components for note and rest symbols
// ---------------------------------------------------------------------------

function NoteIcon({ type, size = 22 }: { type: string; size?: number }) {
  const s = size;
  const sh = Math.round(s * 1.35); // taller viewbox for symbols with stems

  switch (type) {
    // ── Notes ────────────────────────────────────────────────────────────────
    case "whole":
      return (
        <svg width={s} height={s} viewBox="0 0 24 22" aria-hidden>
          {/* Open oval with inner cutout to form the hollow notehead */}
          <ellipse cx="12" cy="14" rx="9" ry="6" stroke="currentColor" strokeWidth="2.2" fill="none" />
          <ellipse cx="12" cy="14" rx="4.5" ry="6" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      );

    case "half":
      return (
        <svg width={s} height={sh} viewBox="0 0 24 30" aria-hidden>
          <ellipse cx="11" cy="24" rx="8.5" ry="5.5" stroke="currentColor" strokeWidth="2" fill="none" />
          <line x1="19" y1="22" x2="19" y2="4" stroke="currentColor" strokeWidth="2" />
        </svg>
      );

    case "quarter":
      return (
        <svg width={s} height={sh} viewBox="0 0 24 30" aria-hidden>
          <ellipse cx="11" cy="24" rx="8.5" ry="5.5" fill="currentColor" />
          <line x1="19" y1="22" x2="19" y2="4" stroke="currentColor" strokeWidth="2" />
        </svg>
      );

    case "eighth":
      return (
        <svg width={s} height={sh} viewBox="0 0 26 30" aria-hidden>
          <ellipse cx="10" cy="24" rx="8.5" ry="5.5" fill="currentColor" />
          <line x1="18" y1="22" x2="18" y2="4" stroke="currentColor" strokeWidth="2" />
          {/* Single flag */}
          <path d="M18,4 C25,8 24,17 18,21" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      );

    case "16th":
      return (
        <svg width={s} height={sh} viewBox="0 0 26 30" aria-hidden>
          <ellipse cx="10" cy="24" rx="8.5" ry="5.5" fill="currentColor" />
          <line x1="18" y1="22" x2="18" y2="2" stroke="currentColor" strokeWidth="2" />
          {/* Two flags */}
          <path d="M18,2 C25,6 24,14 18,18" stroke="currentColor" strokeWidth="2" fill="none" />
          <path d="M18,9 C25,13 24,20 18,24" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      );

    // ── Rests — Bravura SMuFL glyphs ─────────────────────────────────────────
    // Each glyph is rendered in a small SVG with a fixed viewBox that maps
    // 1 staff space = 8px (so 4sp staff = 32px tall).
    // Baseline is placed so the glyph is vertically centred in the icon area.
    case "whole-rest":
      // yMin=1.168sp yMax=1.628sp — hangs below a line; centre in 22px box
      return (
        <svg width={s} height={s} viewBox="0 0 24 22" overflow="visible" aria-hidden>
          <text x="12" y="15" fontSize="32" textAnchor="middle"
            fontFamily="Bravura, serif" fill="currentColor"
            style={{ userSelect: "none" }}>{"\uE4E3"}</text>
        </svg>
      );

    case "half-rest":
      // yMin=1.592sp yMax=2.056sp — sits on a line
      return (
        <svg width={s} height={s} viewBox="0 0 24 22" overflow="visible" aria-hidden>
          <text x="12" y="18" fontSize="32" textAnchor="middle"
            fontFamily="Bravura, serif" fill="currentColor"
            style={{ userSelect: "none" }}>{"\uE4E4"}</text>
        </svg>
      );

    case "quarter-rest":
      // yMin=0.4sp yMax=2.792sp — tall glyph
      return (
        <svg width={s} height={sh} viewBox="0 0 24 30" overflow="visible" aria-hidden>
          <text x="12" y="28" fontSize="32" textAnchor="middle"
            fontFamily="Bravura, serif" fill="currentColor"
            style={{ userSelect: "none" }}>{"\uE4E5"}</text>
        </svg>
      );

    case "eighth-rest":
      // yMin=0.796sp yMax=2.156sp
      return (
        <svg width={s} height={sh} viewBox="0 0 24 30" overflow="visible" aria-hidden>
          <text x="12" y="28" fontSize="32" textAnchor="middle"
            fontFamily="Bravura, serif" fill="currentColor"
            style={{ userSelect: "none" }}>{"\uE4E6"}</text>
        </svg>
      );

    case "16th-rest":
      // yMin=0sp yMax=2.172sp
      return (
        <svg width={s} height={sh} viewBox="0 0 24 30" overflow="visible" aria-hidden>
          <text x="12" y="28" fontSize="32" textAnchor="middle"
            fontFamily="Bravura, serif" fill="currentColor"
            style={{ userSelect: "none" }}>{"\uE4E7"}</text>
        </svg>
      );

    default:
      return <span style={{ fontSize: 11 }}>{type}</span>;
  }
}

// ─── Articulation icon ────────────────────────────────────────────────────────

function ArticIcon({ type, size = 20 }: { type: string; size?: number }) {
  const s = size;
  switch (type) {
    case "staccato":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="3.5" fill="currentColor" />
        </svg>
      );
    case "accent":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M2,6 L10,14 L18,6" stroke="currentColor" strokeWidth="2.5"
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "tenuto":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="3"
            strokeLinecap="round" />
        </svg>
      );
    case "fermata":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M3,14 A7,7 0 0 1 17,14" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
          <circle cx="10" cy="9" r="2.5" fill="currentColor" />
        </svg>
      );
    case "staccatissimo":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <ellipse cx="10" cy="10" rx="2.5" ry="4.5" fill="currentColor" />
        </svg>
      );
    case "portato":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <line x1="3" y1="8" x2="17" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="10" cy="14" r="2.5" fill="currentColor" />
        </svg>
      );
    case "marcato":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M3,14 L10,4 L17,14" stroke="currentColor" strokeWidth="2.5"
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="6.5" y1="14" x2="13.5" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "stress":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M3,14 L9,6 L15,14" stroke="currentColor" strokeWidth="2.2"
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "strong-accent":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M2,6 L10,14 L18,6" stroke="currentColor" strokeWidth="2.8"
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2,4 L10,12 L18,4" stroke="currentColor" strokeWidth="1.5"
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "up-bow":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M4,14 L4,6 L10,14 L16,6 L16,14" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "down-bow":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <rect x="4" y="5" width="12" height="5" rx="1"
            stroke="currentColor" strokeWidth="2" fill="none" />
          <line x1="10" y1="10" x2="10" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "snap-pizzicato":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.8" fill="none" />
          <circle cx="10" cy="10" r="2" fill="currentColor" />
        </svg>
      );
    case "left-hand-pizzicato":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <line x1="10" y1="3" x2="10" y2="17" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="3" y1="10" x2="17" y2="10" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      );
    case "harmonic":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      );
    case "spiccato":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="13" r="2.5" fill="currentColor" />
          <path d="M10,10 C10,6 14,4 14,4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        </svg>
      );
    case "fermata":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M3,14 A7,7 0 0 1 17,14" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
          <circle cx="10" cy="9" r="2.5" fill="currentColor" />
        </svg>
      );
    case "fermata-short":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M4,15 A6,4 0 0 1 16,15" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
          <circle cx="10" cy="11" r="2" fill="currentColor" />
        </svg>
      );
    case "fermata-long":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <rect x="3" y="10" width="14" height="4" rx="1"
            stroke="currentColor" strokeWidth="1.8" fill="none" />
          <circle cx="10" cy="7" r="2" fill="currentColor" />
        </svg>
      );
    case "breath-mark":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M8,14 C11,6 14,5 16,7" stroke="currentColor" strokeWidth="2.2"
            fill="none" strokeLinecap="round" />
        </svg>
      );
    case "caesura":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <line x1="7" y1="4" x2="5" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <line x1="13" y1="4" x2="11" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "doit":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M4,14 Q10,14 16,6" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
          <path d="M13,4 L16,6 L14,9" stroke="currentColor" strokeWidth="1.8"
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "fall":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M4,6 Q10,6 16,14" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
        </svg>
      );
    case "plop":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M4,4 Q10,14 16,14" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
        </svg>
      );
    case "scoop":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M4,16 Q4,6 16,6" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
        </svg>
      );
    case "glissando":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <line x1="4" y1="15" x2="16" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <text x="8" y="17" fontSize="7" fontFamily="serif" fontStyle="italic"
            fill="currentColor" style={{ userSelect: "none" }}>gl.</text>
        </svg>
      );
    case "trill":
      return (
        <svg width={s} height={s} viewBox="0 0 24 20" aria-hidden>
          <text x="2" y="16" fontSize="15" fontFamily="serif" fontStyle="italic"
            fill="currentColor" style={{ userSelect: "none" }}>tr~</text>
        </svg>
      );
    case "trill-wavy":
      return (
        <svg width={s} height={s} viewBox="0 0 24 20" aria-hidden>
          <text x="1" y="12" fontSize="10" fontFamily="serif" fontStyle="italic"
            fill="currentColor" style={{ userSelect: "none" }}>tr</text>
          <path d="M10,10 C11,6 13,6 14,10 C15,14 17,14 18,10 C19,6 21,6 22,10"
            stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
        </svg>
      );
    case "turn":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M3,8 C5,4 9,4 10,8 C11,12 15,12 17,8" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
        </svg>
      );
    case "turn-inverted":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M3,12 C5,16 9,16 10,12 C11,8 15,8 17,12" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
        </svg>
      );
    case "mordent":
      // Lower mordent: wavy squiggle with downward stroke in middle
      return (
        <svg width={s} height={s} viewBox="0 0 22 20" aria-hidden>
          <text x="1" y="15" fontSize="16" fontFamily="Bravura, serif"
            fill="currentColor" style={{ userSelect: "none" }}>{"\uE56C"}</text>
        </svg>
      );
    case "mordent-inverted":
      // Upper mordent / prall-triller
      return (
        <svg width={s} height={s} viewBox="0 0 22 20" aria-hidden>
          <text x="1" y="15" fontSize="16" fontFamily="Bravura, serif"
            fill="currentColor" style={{ userSelect: "none" }}>{"\uE56D"}</text>
        </svg>
      );
    case "prall-prall":
      return (
        <svg width={s} height={s} viewBox="0 0 22 20" aria-hidden>
          <text x="1" y="15" fontSize="16" fontFamily="Bravura, serif"
            fill="currentColor" style={{ userSelect: "none" }}>{"\uE56B"}</text>
        </svg>
      );
    case "tremblement":
      return (
        <svg width={s} height={s} viewBox="0 0 22 20" aria-hidden>
          <text x="1" y="15" fontSize="16" fontFamily="Bravura, serif"
            fill="currentColor" style={{ userSelect: "none" }}>{"\uE56E"}</text>
        </svg>
      );
    case "shake":
      return (
        <svg width={s} height={s} viewBox="0 0 22 20" aria-hidden>
          <text x="1" y="15" fontSize="16" fontFamily="Bravura, serif"
            fill="currentColor" style={{ userSelect: "none" }}>{"\uE56F"}</text>
        </svg>
      );
    case "schleifer":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M4,16 C5,10 8,8 10,10 C12,12 14,8 16,4" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
        </svg>
      );
    case "arpeggio-up":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M10,18 C6,16 14,14 6,12 C14,10 6,8 14,6" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
          <path d="M14,4 L14,7 L11,6" stroke="currentColor" strokeWidth="1.8"
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "arpeggio-down":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M10,2 C14,4 6,6 14,8 C6,10 14,12 6,14" stroke="currentColor" strokeWidth="2"
            fill="none" strokeLinecap="round" />
          <path d="M6,16 L6,13 L9,14" stroke="currentColor" strokeWidth="1.8"
            fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "vibrato":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M2,10 C3,7 5,7 6,10 C7,13 9,13 10,10 C11,7 13,7 14,10 C15,13 17,13 18,10"
            stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </svg>
      );
    default:
      return <span style={{ fontSize: 11 }}>{type}</span>;
  }
}

// ─── Notehead icon ────────────────────────────────────────────────────────────

function NoteheadIcon({ type, size = 20 }: { type: NoteheadType; size?: number }) {
  const s = size;
  switch (type) {
    case "normal":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <ellipse cx="10" cy="12" rx="7" ry="5" fill="currentColor" />
        </svg>
      );
    case "slash":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M4,16 L16,4" stroke="currentColor" strokeWidth="4"
            strokeLinecap="square" />
        </svg>
      );
    case "x":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <line x1="4" y1="4" x2="16" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <line x1="16" y1="4" x2="4" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      );
    case "circle-x":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="2" fill="none" />
          <line x1="5" y1="5" x2="15" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <line x1="15" y1="5" x2="5" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case "diamond":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M10,3 L18,10 L10,17 L2,10 Z" fill="currentColor" />
        </svg>
      );
    case "diamond-open":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M10,3 L18,10 L10,17 L2,10 Z" stroke="currentColor" strokeWidth="2" fill="none" />
        </svg>
      );
    case "triangle":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M10,3 L18,17 L2,17 Z" fill="currentColor" />
        </svg>
      );
    case "square":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <rect x="4" y="7" width="12" height="9" fill="currentColor" />
        </svg>
      );
    case "back-slash":
      return (
        <svg width={s} height={s} viewBox="0 0 20 20" aria-hidden>
          <path d="M16,16 L4,4" stroke="currentColor" strokeWidth="4"
            strokeLinecap="square" />
        </svg>
      );
    default:
      return <span style={{ fontSize: 11 }}>{type}</span>;
  }
}

// ---------------------------------------------------------------------------
// Toolbar constants
// ---------------------------------------------------------------------------
const DURATIONS: { id: NoteDuration; label: string }[] = [
  { id: "whole",   label: "Whole"     },
  { id: "half",    label: "Half"      },
  { id: "quarter", label: "Quarter"   },
  { id: "eighth",  label: "Eighth"    },
  { id: "16th",    label: "Sixteenth" },
];

const NOTE_NAMES = ["C", "D", "E", "F", "G", "A", "B"];

const ACCIDENTALS = [
  { value: "",  label: "♮", title: "Natural" },
  { value: "#", label: "♯", title: "Sharp"   },
  { value: "b", label: "♭", title: "Flat"    },
];


const NOTEHEADS: { id: NoteheadType; title: string }[] = [
  { id: "normal",       title: "Normal"           },
  { id: "slash",        title: "Slash (rhythm)"   },
  { id: "x",            title: "X / Ghost note"   },
  { id: "circle-x",     title: "Circle X"          },
  { id: "diamond",      title: "Diamond (filled)"  },
  { id: "diamond-open", title: "Diamond (open)"    },
  { id: "triangle",     title: "Triangle"          },
  { id: "square",       title: "Square"            },
  { id: "back-slash",   title: "Back Slash"        },
];
const ARTICULATIONS: { id: Articulation; title: string; group: string }[] = [
  // Touch / pressure
  { id: "staccato",        title: "Staccato",              group: "touch" },
  { id: "staccatissimo",   title: "Staccatissimo",          group: "touch" },
  { id: "tenuto",          title: "Tenuto",                 group: "touch" },
  { id: "portato",         title: "Portato",                group: "touch" },
  // Emphasis
  { id: "accent",          title: "Accent (>)",             group: "emphasis" },
  { id: "marcato",         title: "Marcato (^)",            group: "emphasis" },
  { id: "strong-accent",   title: "Strong Accent (^^)",     group: "emphasis" },
  { id: "stress",          title: "Stress",                 group: "emphasis" },
  // Bowing / technique
  { id: "up-bow",          title: "Up Bow",                 group: "technique" },
  { id: "down-bow",        title: "Down Bow",               group: "technique" },
  { id: "snap-pizzicato",  title: "Snap Pizzicato",          group: "technique" },
  { id: "left-hand-pizzicato", title: "Left Hand Pizz",     group: "technique" },
  { id: "harmonic",        title: "Harmonic",               group: "technique" },
  { id: "spiccato",        title: "Spiccato",               group: "technique" },
  // Pause / breath
  { id: "fermata",         title: "Fermata",                group: "pause" },
  { id: "fermata-short",   title: "Fermata (short)",         group: "pause" },
  { id: "fermata-long",    title: "Fermata (long)",          group: "pause" },
  { id: "breath-mark",     title: "Breath Mark",             group: "pause" },
  { id: "caesura",         title: "Caesura",                 group: "pause" },
  // Ornaments (Bravura U+E56x)
  { id: "trill",           title: "Trill (tr~)",             group: "ornament" },
  { id: "trill-wavy",      title: "Trill + extension",       group: "ornament" },
  { id: "turn",            title: "Turn (~)",                group: "ornament" },
  { id: "turn-inverted",   title: "Inverted Turn",           group: "ornament" },
  { id: "mordent",         title: "Mordent (lower)",         group: "ornament" },
  { id: "mordent-inverted",title: "Upper Mordent / Prall",   group: "ornament" },
  { id: "prall-prall",     title: "Double Prall",            group: "ornament" },
  { id: "tremblement",     title: "Tremblement",             group: "ornament" },
  { id: "shake",           title: "Shake",                  group: "ornament" },
  { id: "schleifer",       title: "Schleifer (slides)",      group: "ornament" },
  // Jazz / expressive contours
  { id: "doit",            title: "Doit",                   group: "jazz" },
  { id: "fall",            title: "Fall",                   group: "jazz" },
  { id: "plop",            title: "Plop",                   group: "jazz" },
  { id: "scoop",           title: "Scoop",                  group: "jazz" },
  { id: "glissando",       title: "Glissando",              group: "jazz" },
  { id: "vibrato",         title: "Vibrato",                group: "jazz" },
  // Arpeggio directional marks (chord roll)
  { id: "arpeggio-up",     title: "Arpeggio Up",            group: "jazz" },
  { id: "arpeggio-down",   title: "Arpeggio Down",          group: "jazz" },
];

const DYNAMICS: { id: Dynamic; label: string; group: string }[] = [
  // Soft
  { id: "pppp", label: "pppp", group: "soft" },
  { id: "ppp",  label: "ppp",  group: "soft" },
  { id: "pp",   label: "pp",   group: "soft" },
  { id: "p",    label: "p",    group: "soft" },
  { id: "mp",   label: "mp",   group: "soft" },
  // Loud
  { id: "mf",   label: "mf",   group: "loud" },
  { id: "f",    label: "f",    group: "loud" },
  { id: "ff",   label: "ff",   group: "loud" },
  { id: "fff",  label: "fff",  group: "loud" },
  { id: "ffff", label: "ffff", group: "loud" },
  // Special / sudden
  { id: "fp",   label: "fp",   group: "special" },
  { id: "fz",   label: "fz",   group: "special" },
  { id: "sf",   label: "sf",   group: "special" },
  { id: "sfz",  label: "sfz",  group: "special" },
  { id: "sff",  label: "sff",  group: "special" },
  { id: "sffz", label: "sffz", group: "special" },
  { id: "rfz",  label: "rfz",  group: "special" },
  { id: "rf",   label: "rf",   group: "special" },
  // Hairpins
  { id: "<",    label: "cresc.",  group: "hairpin" },
  { id: ">",    label: "dim.",    group: "hairpin" },
];

const TIME_SIGNATURES: { value: string; top: string; bot: string }[] = [
  { value: "2/4",  top: "2",  bot: "4" },
  { value: "3/4",  top: "3",  bot: "4" },
  { value: "4/4",  top: "4",  bot: "4" },
  { value: "6/8",  top: "6",  bot: "8" },
  { value: "9/8",  top: "9",  bot: "8" },
  { value: "12/8", top: "12", bot: "8" },
];

const CLEFS: { id: ClefType; label: string; symbol: string }[] = [
  { id: "treble",     label: "Treble (G)",  symbol: "\uE050" },
  { id: "bass",       label: "Bass (F)",    symbol: "\uE062" },
  { id: "alto",       label: "Alto (C)",    symbol: "\uE05C" },
  { id: "tenor",      label: "Tenor (C)",   symbol: "\uE05C" },
  { id: "percussion", label: "Percussion",  symbol: "\uE069" },
];

// ---------------------------------------------------------------------------
// Styles (inline, matching the project's dark aesthetic)
// ---------------------------------------------------------------------------

const S = {
  container: {
    background:    "#1a1b2e",
    borderRadius:  8,
    padding:       "8px 12px",
    display:       "flex",
    flexDirection: "column" as const,
    gap:           6,
    fontFamily:    "system-ui, -apple-system, sans-serif",
    color:         "#c0caf5",
    fontSize:      12,
    userSelect:    "none" as const,
    boxShadow:     "0 2px 8px rgba(0,0,0,0.25)",
  },

  titleBar: {
    display:       "flex",
    alignItems:    "center",
    gap:           8,
    paddingBottom: 5,
    borderBottom:  "1px solid #2a2d4a",
  },

  titleText: {
    fontSize:      11,
    fontWeight:    700,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color:         "#565f89",
  },

  activeTool: {
    fontSize:   11,
    fontWeight: 600,
    color:      "#7aa2f7",
    marginLeft: "auto",
  },

  sectionHdr: (open: boolean) => ({
    display:      "flex",
    alignItems:   "center",
    gap:          6,
    cursor:       "pointer" as const,
    padding:      "3px 0",
    borderBottom: open ? "1px solid #2a2d4a" : "none",
    marginBottom: open ? 4 : 0,
  }),

  sectionLbl: {
    fontSize:      10,
    fontWeight:    700,
    letterSpacing: "0.09em",
    textTransform: "uppercase" as const,
    color:         "#565f89",
    flex:          1,
  },

  chevron: (open: boolean) => ({
    fontSize:  9,
    color:     "#565f89",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform 0.15s",
    display:   "inline-block",
  }),

  row: {
    display:    "flex",
    gap:        4,
    alignItems: "center",
    flexWrap:   "wrap" as const,
  },

  subLabel: {
    fontSize:      10,
    fontWeight:    700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color:         "#565f89",
    minWidth:      42,
  },

  divider: {
    width:      1,
    height:     34,
    background: "#2a2d4a",
    margin:     "0 2px",
    flexShrink: 0,
  },

  noteBtn: (active: boolean) => ({
    width:          40,
    height:         44,
    borderRadius:   5,
    border:         `1px solid ${active ? "#7aa2f7" : "#2a2d4a"}`,
    background:     active ? "#3d59a1" : "#20213a",
    color:          active ? "#e0e7ff" : "#a9b1d6",
    cursor:         "pointer" as const,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    transition:     "all 0.1s",
    padding:        0,
    flexShrink:     0,
  }),

  smallBtn: (active: boolean, disabled = false) => ({
    padding:      "4px 7px",
    borderRadius: 4,
    border:       `1px solid ${active ? "#7aa2f7" : "#2a2d4a"}`,
    background:   active ? "#3d59a1" : "#20213a",
    color:        active ? "#e0e7ff" : disabled ? "#3a3e5a" : "#a9b1d6",
    cursor:       disabled ? "not-allowed" as const : "pointer" as const,
    fontSize:     13,
    fontWeight:   active ? 700 : 400,
    lineHeight:   "1.2",
    transition:   "all 0.1s",
    flexShrink:   0,
    pointerEvents: disabled ? "none" as const : "auto" as const,
    opacity:      disabled ? 0.4 : 1,
  }),

  articBtn: (active: boolean) => ({
    width:          38,
    height:         38,
    borderRadius:   5,
    border:         `1px solid ${active ? "#bb9af7" : "#2a2d4a"}`,
    background:     active ? "#3b2d5a" : "#20213a",
    color:          active ? "#e0cfff" : "#a9b1d6",
    cursor:         "pointer" as const,
    display:        "flex",
    alignItems:     "center",
    justifyContent: "center",
    transition:     "all 0.1s",
    padding:        0,
    flexShrink:     0,
  }),

  dynBtn: (active: boolean) => ({
    padding:      "4px 9px",
    borderRadius: 4,
    border:       `1px solid ${active ? "#f7768e" : "#2a2d4a"}`,
    background:   active ? "#5a1a2a" : "#20213a",
    color:        active ? "#ffb3c0" : "#a9b1d6",
    cursor:       "pointer" as const,
    fontSize:     13,
    fontWeight:   active ? 700 : 500,
    fontStyle:    "italic",
    lineHeight:   "1.2",
    transition:   "all 0.1s",
    flexShrink:   0,
  }),

  clearBtn: {
    padding:      "3px 7px",
    borderRadius: 4,
    border:       "1px solid #2a2d4a",
    background:   "#20213a",
    color:        "#565f89",
    cursor:       "pointer" as const,
    fontSize:     10,
    lineHeight:   "1.2",
    transition:   "all 0.1s",
    flexShrink:   0,
  },

  badge: (color: string) => ({
    display:        "inline-flex",
    alignItems:     "center",
    justifyContent: "center",
    padding:        "1px 6px",
    borderRadius:   10,
    background:     color,
    color:          "white",
    fontSize:       9,
    fontWeight:     700,
    marginLeft:     2,
    letterSpacing:  "0.04em",
  }),
};

// ---------------------------------------------------------------------------
// Collapsible section wrapper
// ---------------------------------------------------------------------------

function Section({
  id, label, open, onToggle, badge, children,
}: {
  id:       string;
  label:    string;
  open:     boolean;
  onToggle: (id: string) => void;
  badge?:   React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={S.sectionHdr(open)}
        role="button"
        tabIndex={0}
        onClick={() => onToggle(id)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onToggle(id)}
        aria-expanded={open}
      >
        <span style={S.sectionLbl}>{label}</span>
        {badge}
        <span style={S.chevron(open)}>▶</span>
      </div>
      {open && <div style={{ paddingTop: 4 }}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NoteEditorToolbar({ tool, onToolChange, timeSig, onTimeSigChange, clef, onClefChange }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    clef:         true,
    timeSig:      true,
    noteRest:     true,
    pitch:        true,
    noteheads:    false,
    spanners:     false,
    articulation: false,
    dynamics:     false,
  });

  function toggle(id: string) {
    setOpen((p) => ({ ...p, [id]: !p[id] }));
  }

  const pitchDisabled = tool.isRest || tool.selectMode;
  const dotLabel      = tool.dotted ? "dotted " : "";
  const displayStr    = tool.selectMode
    ? "select mode"
    : tool.isRest
    ? `rest · ${dotLabel}${tool.duration}`
    : [
        buildPitch(tool),
        `${dotLabel}${tool.duration}`,
        tool.noteheadType !== "normal" ? tool.noteheadType : null,
        tool.tremolo > 0 ? `tremolo×${tool.tremolo}` : null,
        tool.tiedToNext  ? "tied"  : null,
        tool.slurStart   ? "slur"  : null,
        tool.ottava      || null,
        tool.articulation || null,
        tool.dynamic       || null,
      ].filter(Boolean).join(" · ");

  return (
    <div style={S.container} role="toolbar" aria-label="Note editor toolbar">

      {/* ── Title bar ────────────────────────────────────────────────── */}
      <div style={S.titleBar}>
        <span style={S.titleText}>Part Box</span>
        <div style={{ flex: 1, height: 1, background: "#2a2d4a" }} />
        <span style={S.activeTool}>{displayStr}</span>
      </div>

      {/* ── Clef ───────────────────────────────────────────────────── */}
      <Section
        id="clef"
        label="Clef"
        open={!!open.clef}
        onToggle={toggle}
        badge={<span style={S.badge("#9ece6a")}>{CLEFS.find((c) => c.id === clef)?.label ?? clef}</span>}
      >
        <div style={S.row}>
          {CLEFS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              style={{
                ...S.smallBtn(clef === c.id),
                minWidth: 80,
                display: "flex",
                alignItems: "center",
                gap: 5,
              }}
              onClick={() => onClefChange(c.id)}
            >
              <span style={{ fontFamily: "Bravura, serif", fontSize: 18, lineHeight: 1 }}>{c.symbol}</span>
              <span style={{ fontFamily: "system-ui", fontSize: 11 }}>{c.label}</span>
            </button>
          ))}
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 10, color: "#565f89" }}>
          Bass/alto clef pitch mapping — future milestone.
        </p>
      </Section>

      {/* ── Time Signature ─────────────────────────────────────────── */}
      <Section
        id="timeSig"
        label="Time Signature"
        open={!!open.timeSig}
        onToggle={toggle}
        badge={<span style={S.badge("#7dcfff")}>{timeSig}</span>}
      >
        <div style={S.row}>
          {TIME_SIGNATURES.map((ts) => {
            const active = timeSig === ts.value;
            return (
              <button
                key={ts.value}
                type="button"
                title={ts.value}
                style={{
                  ...S.smallBtn(active),
                  minWidth: 34,
                  display: "flex",
                  flexDirection: "column" as const,
                  alignItems: "center",
                  padding: "3px 6px",
                  lineHeight: "1.1",
                  gap: 0,
                  fontFamily: "serif",
                  fontSize: 14,
                }}
                onClick={() => onTimeSigChange(ts.value)}
              >
                <span style={{ borderBottom: "1px solid currentColor", paddingBottom: 1, width: "100%", textAlign: "center" }}>{ts.top}</span>
                <span style={{ textAlign: "center", width: "100%" }}>{ts.bot}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ── Notes & Rests ──────────────────────────────────────────── */}
      <Section id="noteRest" label="Notes & Rests" open={!!open.noteRest} onToggle={toggle}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>

          <div style={S.row}>
            <span style={S.subLabel}>Notes</span>
            {DURATIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                title={`${d.label} note`}
                style={S.noteBtn(!tool.isRest && tool.duration === d.id)}
                onClick={() => onToolChange({ ...tool, duration: d.id, isRest: false })}
              >
                <NoteIcon type={d.id} size={20} />
              </button>
            ))}
          </div>

          <div style={S.row}>
            <span style={S.subLabel}>Rests</span>
            {DURATIONS.map((d) => (
              <button
                key={d.id + "-rest"}
                type="button"
                title={`${d.label} rest`}
                style={S.noteBtn(tool.isRest && tool.duration === d.id)}
                onClick={() => onToolChange({ ...tool, duration: d.id, isRest: true })}
              >
                <NoteIcon type={`${d.id}-rest`} size={20} />
              </button>
            ))}
          </div>

          {/* Select mode toggle */}
          <div style={{ ...S.row, marginTop: 2 }}>
            <span style={S.subLabel}>Mode</span>
            <button
              type="button"
              title={tool.selectMode ? "Select mode active — click to switch to Note input" : "Switch to Select mode"}
              style={{
                ...S.smallBtn(tool.selectMode),
                minWidth: 64,
                display: "flex",
                alignItems: "center",
                gap: 5,
                borderColor: tool.selectMode ? "#bb9af7" : undefined,
                background:  tool.selectMode ? "#3b2d5a" : undefined,
                color:       tool.selectMode ? "#e0cfff" : undefined,
              }}
              onClick={() => onToolChange({ ...tool, selectMode: !tool.selectMode })}
            >
              <svg width={13} height={13} viewBox="0 0 13 13" fill="currentColor" aria-hidden>
                <polygon points="1,1 1,10 4,7.5 6,12 7.5,11.3 5.5,6.8 9.5,6.8" />
              </svg>
              Select
            </button>
            {tool.selectMode && (
              <span style={{ fontSize: 10, color: "#bb9af7", alignSelf: "center" }}>
                Select active
              </span>
            )}
          </div>

          {/* Dotted toggle */}
          <div style={{ ...S.row, marginTop: 2 }}>
            <span style={S.subLabel}>Modify</span>
            <button
              type="button"
              title={tool.dotted ? "Remove dot (currently dotted)" : "Add dot (1.5× duration)"}
              style={{
                ...S.smallBtn(tool.dotted),
                minWidth: 44,
                fontFamily: "serif",
                fontSize: 16,
                letterSpacing: 1,
              }}
              onClick={() => onToolChange({ ...tool, dotted: !tool.dotted })}
            >
              {tool.dotted ? "• dot" : "· dot"}
            </button>
            {tool.dotted && (
              <span style={{ fontSize: 10, color: "#7aa2f7", alignSelf: "center" }}>
                1.5× duration active
              </span>
            )}
          </div>

        </div>
      </Section>

      {/* ── Pitch / Accidentals / Octave ──────────────────────────── */}
      <Section
        id="pitch"
        label="Pitch"
        open={!!open.pitch}
        onToggle={toggle}
        badge={
          pitchDisabled
            ? <span style={S.badge("#565f89")}>rest</span>
            : undefined
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>

          <div style={S.row}>
            <span style={S.subLabel}>Note</span>
            {NOTE_NAMES.map((n) => (
              <button
                key={n}
                type="button"
                title={n}
                style={{ ...S.smallBtn(!pitchDisabled && tool.noteName === n, pitchDisabled), minWidth: 26 }}
                onClick={() => !pitchDisabled && onToolChange({ ...tool, noteName: n })}
              >
                {n}
              </button>
            ))}
          </div>

          <div style={S.row}>
            <span style={S.subLabel}>Acc</span>
            {ACCIDENTALS.map((a) => (
              <button
                key={a.value || "nat"}
                type="button"
                title={a.title}
                style={{ ...S.smallBtn(!pitchDisabled && tool.accidental === a.value, pitchDisabled), minWidth: 26 }}
                onClick={() => !pitchDisabled && onToolChange({ ...tool, accidental: a.value })}
              >
                {a.label}
              </button>
            ))}

            <div style={S.divider} />

            <span style={{ ...S.subLabel, minWidth: 28 }}>Oct</span>
            {[2, 3, 4, 5, 6].map((oct) => (
              <button
                key={oct}
                type="button"
                style={{ ...S.smallBtn(!pitchDisabled && tool.octave === oct, pitchDisabled), minWidth: 26 }}
                onClick={() => !pitchDisabled && onToolChange({ ...tool, octave: oct })}
              >
                {oct}
              </button>
            ))}
          </div>

        </div>
      </Section>

      {/* ── Notehead Types ───────────────────────────────────────── */}
      <Section
        id="noteheads"
        label="Notehead Type"
        open={!!open.noteheads}
        onToggle={toggle}
        badge={
          tool.noteheadType !== "normal"
            ? <span style={S.badge("#9ece6a")}>{tool.noteheadType}</span>
            : undefined
        }
      >
        <div style={S.row}>
          {NOTEHEADS.map((nh) => (
            <button
              key={nh.id}
              type="button"
              title={nh.title}
              style={S.articBtn(tool.noteheadType === nh.id)}
              onClick={() => onToolChange({ ...tool, noteheadType: nh.id })}
            >
              <NoteheadIcon type={nh.id} size={18} />
            </button>
          ))}
        </div>
      </Section>

      {/* ── Tremolo ──────────────────────────────────────────────── */}
      <Section
        id="tremolo"
        label="Tremolo"
        open={!!open.noteheads}
        onToggle={() => toggle("noteheads")}
        badge={
          tool.tremolo > 0
            ? <span style={S.badge("#ff9e64")}>{tool.tremolo}×</span>
            : undefined
        }
      >
        <div style={S.row}>
          {([0, 1, 2, 3, 4] as const).map((n) => (
            <button
              key={n}
              type="button"
              title={n === 0 ? "No tremolo" : `${n} slash${n > 1 ? "es" : ""}`}
              style={S.articBtn(tool.tremolo === n)}
              onClick={() => onToolChange({ ...tool, tremolo: n })}
            >
              {n === 0 ? "—" : "⁄".repeat(n)}
            </button>
          ))}
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 10, color: "#565f89" }}>
          0 = none · 1–4 = slash count through/on stem
        </p>
      </Section>

      {/* ── Spanners (Tie / Slur / Arpeggio / 8va) ───────────────── */}
      <Section
        id="spanners"
        label="Spanners &amp; Lines"
        open={!!open.spanners}
        onToggle={toggle}
        badge={
          (tool.tiedToNext || tool.slurStart || tool.arpeggio || tool.ottava)
            ? <span style={S.badge("#7dcfff")}>on</span>
            : undefined
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={S.row}>
            <button
              type="button"
              title="Tie to next note of same pitch"
              style={S.articBtn(tool.tiedToNext)}
              onClick={() => onToolChange({ ...tool, tiedToNext: !tool.tiedToNext })}
            >
              Tie
            </button>
            <button
              type="button"
              title="Start a slur from this note"
              style={S.articBtn(tool.slurStart)}
              onClick={() => onToolChange({ ...tool, slurStart: !tool.slurStart })}
            >
              Slur
            </button>
            <button
              type="button"
              title="Arpeggio (chord roll)"
              style={S.articBtn(tool.arpeggio)}
              onClick={() => onToolChange({ ...tool, arpeggio: !tool.arpeggio })}
            >
              Arp.
            </button>
          </div>
          <div style={{ ...S.row, flexWrap: "wrap" }}>
            <span style={S.subLabel}>8va</span>
            {(["", "8va", "8vb", "15ma", "15mb"] as const).map((v) => (
              <button
                key={v || "none"}
                type="button"
                title={v ? v : "None"}
                style={S.articBtn(tool.ottava === v)}
                onClick={() => onToolChange({ ...tool, ottava: v })}
              >
                {v || "—"}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Articulations ────────────────────────────────────────── */}
      <Section
        id="articulation"
        label="Articulations"
        open={!!open.articulation}
        onToggle={toggle}
        badge={
          tool.articulation
            ? <span style={S.badge("#7aa2f7")}>{tool.articulation}</span>
            : undefined
        }
      >
        {(["touch","emphasis","technique","pause","ornament","jazz"] as const).map((grp) => {
          const items = ARTICULATIONS.filter((a) => a.group === grp);
          const grpLabels: Record<string, string> = {
            touch: "Touch", emphasis: "Emphasis", technique: "Technique",
            pause: "Pause / Breath", ornament: "Ornaments", jazz: "Jazz / Expressive",
          };
          return (
            <div key={grp} style={{ marginBottom: 6 }}>
              <div style={{ ...S.subLabel, marginBottom: 3 }}>{grpLabels[grp]}</div>
              <div style={S.row}>
                {items.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    title={a.title}
                    style={S.articBtn(tool.articulation === a.id)}
                    onClick={() => onToolChange({
                      ...tool,
                      articulation: tool.articulation === a.id ? "" : a.id,
                    })}
                  >
                    <ArticIcon type={a.id} size={18} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {tool.articulation && (
          <button
            type="button"
            title="Clear articulation"
            style={S.clearBtn}
            onClick={() => onToolChange({ ...tool, articulation: "" })}
          >
            clear
          </button>
        )}
        <p style={{ margin: "4px 0 0", fontSize: 10, color: "#565f89" }}>
          Stored locally — backend persistence in a future milestone.
        </p>
      </Section>

      {/* ── Dynamics ─────────────────────────────────────────────── */}
      <Section
        id="dynamics"
        label="Dynamics"
        open={!!open.dynamics}
        onToggle={toggle}
        badge={
          tool.dynamic
            ? <span style={S.badge("#f7768e")}>{tool.dynamic}</span>
            : undefined
        }
      >
        {(["soft","loud","special","hairpin"] as const).map((grp) => {
          const items = DYNAMICS.filter((d) => d.group === grp);
          const grpLabels: Record<string, string> = {
            soft: "Soft", loud: "Loud", special: "Special", hairpin: "Hairpins",
          };
          return (
            <div key={grp} style={{ marginBottom: 5 }}>
              <div style={{ ...S.subLabel, marginBottom: 3 }}>{grpLabels[grp]}</div>
              <div style={S.row}>
                {items.map((dyn) => (
                  <button
                    key={dyn.id}
                    type="button"
                    title={dyn.label}
                    style={S.dynBtn(tool.dynamic === dyn.id)}
                    onClick={() => onToolChange({
                      ...tool,
                      dynamic: tool.dynamic === dyn.id ? "" : dyn.id,
                    })}
                  >
                    {dyn.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {tool.dynamic && (
          <button
            type="button"
            title="Clear dynamic"
            style={S.clearBtn}
            onClick={() => onToolChange({ ...tool, dynamic: "" })}
          >
            clear
          </button>
        )}
        <p style={{ margin: "4px 0 0", fontSize: 10, color: "#565f89" }}>
          Stored locally — backend persistence in a future milestone.
        </p>
      </Section>

    </div>
  );
}
