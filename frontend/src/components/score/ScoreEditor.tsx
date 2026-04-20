"use client";

/**
 * ScoreEditor — treble staff grid, multiple measures per system row.
 *
 * Architecture:
 *  - ScoreSettings panel (collapsible) imported from ./ScoreSettings
 *  - Each system row = ClefPanel SVG + N × MeasurePanel SVG in a flex row
 *  - MeasurePanel zooms up (CSS scale) when hovered or has a selected note
 *  - Score viewport zoomed via CSS zoom (affects layout / scroll correctly)
 *  - Measure width controlled by measureZoom setting
 *  - Whole-measure rests always centered within each measure
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

import { apiFetch } from "@/components/api";
import { computeBeaming } from "@/lib/beaming";
import { useHistory } from "@/lib/useHistory";
import type { Chart, ChartMeasure, ChartNote } from "./ChartEditor";
import NoteEditorToolbar, {
  DEFAULT_TOOL,
  type ClefType,
  type ToolState,
} from "./NoteEditorToolbar";
import ScoreSettings, {
  DEFAULT_SCORE_SETTINGS,
  type ScoreSettingsValues,
} from "./ScoreSettings";

// ─── Duration helpers ─────────────────────────────────────────────────────────

const DURATION_SLOTS: Record<string, number> = {
  whole: 16, half: 8, quarter: 4, eighth: 2, "16th": 1,
  // Dotted variants — 1.5× the base slot count
  "dotted-whole": 24, "dotted-half": 12, "dotted-quarter": 6, "dotted-eighth": 3,
};

function timeSigSlots(ts: string): number {
  const [t, b] = ts.split("/").map((n) => parseInt(n, 10) || 4);
  return Math.round(t * (16 / b));
}

/** Returns true when a note of `duration` placed at `slot` would exceed the measure capacity. */
function wouldOverflow(slot: number, duration: string, capacity: number): boolean {
  const slots = DURATION_SLOTS[duration] ?? 4;
  return slot >= capacity || slot + slots > capacity;
}

/** Snap a raw 16th-note slot to the nearest valid beat start for the given duration. */
function snapSlot(rawSlot: number, duration: string): number {
  const dur = DURATION_SLOTS[duration] ?? 4;
  return Math.floor(rawSlot / dur) * dur;
}

/** Combine base duration with optional dotted flag into the stored duration string. */
function effectiveDur(tool: ToolState): string {
  return tool.dotted ? `dotted-${tool.duration}` : tool.duration;
}

// ─── Auto-rest gap filling ─────────────────────────────────────────────────

type AutoRest = { slot: number; duration: string };

/**
 * A "placeholder" whole-measure rest is a rest note whose duration fills the
 * entire measure (inserted automatically by the backend for empty measures).
 * We exclude these from occupancy so auto-fill always works correctly.
 */
function isPlaceholderRest(note: ChartNote, totalSlots: number): boolean {
  if (!note.is_rest) return false;
  const dur = note.notation_duration ?? note.duration;
  return (DURATION_SLOTS[dur] ?? 4) >= totalSlots;
}

/**
 * Return fill rests for every unoccupied slot in a measure.
 * Uses a greedy largest-first algorithm so the fewest rests are drawn.
 * Placeholder whole-measure rests are ignored so auto-fill works on
 * both empty measures and measures that already have real content.
 */
function computeAutoRests(notes: ChartNote[], totalSlots: number): AutoRest[] {
  // Filter out placeholder whole-measure rests — they don’t occupy real beats
  const realNotes = notes.filter((n) => !isPlaceholderRest(n, totalSlots));

  // Mark occupied slots from real notes only
  const occ = new Uint8Array(totalSlots);
  for (const note of realNotes) {
    const s = note.notation_position ?? note.position;
    const d = DURATION_SLOTS[note.notation_duration ?? note.duration] ?? 4;
    for (let i = s; i < Math.min(s + d, totalSlots); i++) occ[i] = 1;
  }

  // All durations sorted largest → smallest for greedy fill
  const fillDurs = (Object.entries(DURATION_SLOTS) as [string, number][])
    .sort(([, a], [, b]) => b - a);

  const rests: AutoRest[] = [];
  let cursor = 0;
  while (cursor < totalSlots) {
    if (occ[cursor]) { cursor++; continue; }
    // Find end of this contiguous free run
    let freeEnd = cursor;
    while (freeEnd < totalSlots && !occ[freeEnd]) freeEnd++;
    // Greedily fill the run
    let pos = cursor;
    while (pos < freeEnd) {
      const remaining = freeEnd - pos;
      let placed = false;
      for (const [dur, slots] of fillDurs) {
        if (slots <= remaining) {
          rests.push({ slot: pos, duration: dur });
          pos += slots;
          placed = true;
          break;
        }
      }
      if (!placed) break; // smallest slot is 1 — shouldn't happen
    }
    cursor = freeEnd;
  }
  return rests;
}

// ─── Pitch model ──────────────────────────────────────────────────────────────

interface StepDef { pitch: string; isLine: boolean }

const TREBLE_LINES = new Set(["F5", "D5", "B4", "G4", "E4"]);
const STEP_NAMES   = ["B","A","G","F","E","D","C"] as const;

function buildAllRows(): StepDef[] {
  const rows: StepDef[] = [];
  for (let oct = 6; oct >= 2; oct--) {
    for (const n of STEP_NAMES) {
      const p = `${n}${oct}`;
      rows.push({ pitch: p, isLine: TREBLE_LINES.has(p) });
    }
  }
  return rows;
}
const ALL_ROWS = buildAllRows();
const ALL_IDX: Record<string, number> = {};
ALL_ROWS.forEach((r, i) => { ALL_IDX[r.pitch] = i; });

// Display range: D6 (4 above top line F5) → A3 (4 below bottom line E4) = 18 rows
// Extra rows above and below give stem clearance without relying on SVG overflow alone.
const D_TOP   = "D6";
const D_BOT   = "A3";
const D_START = ALL_IDX[D_TOP] ?? 0;
const D_END   = ALL_IDX[D_BOT] ?? ALL_ROWS.length - 1;
const D_ROWS  = ALL_ROWS.slice(D_START, D_END + 1);
const D_TOTAL = D_ROWS.length;

const D_IDX: Record<string, number> = {};
D_ROWS.forEach((r, i) => { D_IDX[r.pitch] = i; });

const LINE_DIDXS = D_ROWS
  .map((r, i) => ({ r, i }))
  .filter(({ r }) => TREBLE_LINES.has(r.pitch))
  .map(({ i }) => i);                        // indices with extended range

// ─── Fixed layout constants (staff geometry, not affected by zoom) ────────────

const ROW_H          = 16;    // px per pitch row  (staff space = 2 × ROW_H = 32 px)
const MEASURE_W_BASE = 240;   // base measure content width — scaled by measureZoom
const CLEF_W1        = 98;    // clef panel width for first system (clef + time sig)
const CLEF_W2        = 48;    // clef panel width for other systems (clef only)
const M_PER_ROW      = 4;     // measures per system row
const STEM_LEN       = ROW_H * 3.5;

// Derived staff geometry (pixel Y centres of staff lines)
const LINE_YS   = LINE_DIDXS.map((i) => i * ROW_H + ROW_H / 2);
const STAFF_TOP = LINE_YS[0]  ?? 0;
const STAFF_BOT = LINE_YS[LINE_YS.length - 1] ?? ROW_H;
const SVG_H     = D_TOTAL * ROW_H;          // total SVG height
// Vertical padding added around each measure/clef SVG so stems on extreme notes
// paint within the wrapper div bounds rather than overflowing the layout.
const SVG_PAD   = STEM_LEN;

// Second staff line from top (D5) — where whole/half rests hang
const REST_LINE_Y = LINE_YS[1] ?? 0;

// ─── Pitch helpers ────────────────────────────────────────────────────────────

function pitchToDRow(pitch: string): number {
  const m = pitch.match(/^([A-G])(#|b)?(\d+)$/);
  if (!m) return Math.floor(D_TOTAL / 2);
  const allIdx = ALL_IDX[`${m[1]}${m[3]}`];
  if (allIdx == null) return Math.floor(D_TOTAL / 2);
  return Math.max(0, Math.min(D_TOTAL - 1, allIdx - D_START));
}

function accSign(pitch: string): "♯" | "♭" | "𝄪" | "𝄫" | "" {
  if (pitch.includes("##")) return "𝄪";
  if (/[A-G]bb\d/.test(pitch)) return "𝄫";
  if (pitch.includes("#")) return "♯";
  if (/[A-G]b\d/.test(pitch)) return "♭";
  return "";
}

function withAcc(rowPitch: string, acc: string): string {
  return acc ? rowPitch.replace(/^([A-G])(\d)/, `$1${acc}$2`) : rowPitch;
}

// ─── Engraving helpers ────────────────────────────────────────────────────────

const NOTE_BLACK = "#1a1a1a";
const SEL_BLUE   = "#1d4ed8";

// Below or on B4 → stem UP; above B4 → stem DOWN
const B4_DROW = D_IDX["B4"] ?? 9;
function noteStemDir(di: number): "up" | "down" {
  return di >= B4_DROW ? "up" : "down";
}

// ─── Ledger lines ─────────────────────────────────────────────────────────────

function ledgerYs(di: number): number[] {
  const top = LINE_DIDXS[0]!;
  const bot = LINE_DIDXS[LINE_DIDXS.length - 1]!;
  const c4  = D_IDX["C4"];
  const res: number[] = [];
  if (di < top) {
    for (let r = top - 2; r >= di; r -= 2) res.push(r * ROW_H + ROW_H / 2);
  } else if (di > bot) {
    if (c4 != null && di === c4) res.push(c4 * ROW_H + ROW_H / 2);
    else for (let r = bot + 2; r <= di; r += 2) res.push(r * ROW_H + ROW_H / 2);
  }
  return res;
}

// ─── NoteHead SVG component ───────────────────────────────────────────────────

interface NHProps {
  cx: number; cy: number;
  duration: string; isRest: boolean;
  selected: boolean; acc: string;
  dir: "up" | "down"; slots: number; slotW: number;
  beamed?: boolean;          // when true, flags are suppressed (beam drawn by parent)
  suppressStem?: boolean;    // when true, stem + flags omitted (chord stem drawn by parent)
  stemEndOverride?: number;  // when set, stem is drawn to this Y instead of cy ± STEM_LEN
  noteheadType?: string;     // alternate notehead shape: "slash"|"x"|"circle-x"|"diamond"|"diamond-open"|"triangle"|"square"
  tremolo?: number;          // 0-4 slash marks through/on stem
}

function NoteHead({ cx, cy, duration, isRest, selected, acc, dir, slots, slotW, beamed = false, suppressStem = false, stemEndOverride, noteheadType = "normal", tremolo = 0 }: NHProps) {
  const isDotted = duration.startsWith("dotted-");
  const baseDur  = isDotted ? duration.slice(7) : duration; // "dotted-quarter" → "quarter"
  const rx     = ROW_H * 0.68;
  const ry     = ROW_H * 0.40;
  const filled = baseDur !== "whole" && baseDur !== "half";
  const stemUp = dir === "up";
  const stemX  = stemUp ? cx + rx - 1 : cx - rx + 1;
  const stemEnd = stemEndOverride ?? (stemUp ? cy - STEM_LEN : cy + STEM_LEN);
  const s = selected ? SEL_BLUE : NOTE_BLACK;

  if (isRest) {
    // ── Bravura SMuFL rest glyphs ─────────────────────────────────────────
    // Font metrics (in 1000-UPM, sp = 250 units = 1 staff space):
    //   whole  U+E4E3: yMin=1.168sp yMax=1.628sp  — hangs below LINE_YS[1] (D5 line)
    //   half   U+E4E4: yMin=1.592sp yMax=2.056sp  — sits on  LINE_YS[2] (B4 line)
    //   quarter U+E4E5: yMin=0.400sp yMax=2.792sp — tall glyph, baseline at LINE_YS[4] (E4)
    //   eighth  U+E4E6: yMin=0.796sp yMax=2.156sp — baseline at LINE_YS[4]
    //   16th    U+E4E7: yMin=0.000sp yMax=2.172sp — baseline at LINE_YS[4]
    // staffSpace = ROW_H * 2 (two row-heights per staff space)
    // fontSize = ROW_H * 4  (= staffH, 1em = 4 staff spaces)
    const staffSpace = ROW_H * 2;
    const restFz     = ROW_H * 4;  // = staffH

    // Bravura rest glyph codepoints
    const REST_GLYPHS: Record<string, string> = {
      whole:   "\uE4E3",
      half:    "\uE4E4",
      quarter: "\uE4E5",
      eighth:  "\uE4E6",
      "16th":  "\uE4E7",
    };
    const glyph = REST_GLYPHS[baseDur] ?? "\uE4E5";

    // Baseline y: Bravura rests use "bottom of staff" as y=0 (upward = positive)
    // In our SVG y increases downward, so: svgY = STAFF_BOT - (baseline_sp * staffSpace)
    // whole: hang from 2nd line (LINE_YS[1]) — place baseline so yMax lands on that line
    //   baseline_sp = 2.0 sp above bottom line → svgY = STAFF_BOT - 2 * staffSpace = LINE_YS[2]
    //   but the glyph hangs with yMin=1.168sp so nudge: baseline = LINE_YS[1] + 0.4*staffSpace
    // half: sit on 3rd line (LINE_YS[2]) — yMin=1.592sp means glyph top is 2.056sp
    //   baseline at STAFF_BOT - 1.592sp * staffSpace ≈ LINE_YS[3]
    // quarter/eighth/16th: all centered on the 3rd space (between D5 and B4, center y=77)
    //   baseline = space3CenterY + (yMin+yMax)/2 * staffSpace
    //     quarter E4E5: (0.400+2.792)/2 = 1.596sp → baseline = 77 + 44.7 ≈ 122
    //     eighth  E4E6: (0.796+2.156)/2 = 1.476sp → baseline = 77 + 41.3 ≈ 118
    //     16th    E4E7: (0.000+2.172)/2 = 1.086sp → baseline = 77 + 30.4 ≈ 107
    const space3CenterY = Math.round((LINE_YS[1]! + LINE_YS[2]!) / 2);
    const restBaselineY =
      baseDur === "whole"   ? LINE_YS[1]! + Math.round(0.40 * staffSpace)
    : baseDur === "half"    ? LINE_YS[3]! - Math.round(0.08 * staffSpace)
    : baseDur === "quarter" ? space3CenterY + Math.round(1.596 * staffSpace)
    : baseDur === "eighth"  ? space3CenterY + Math.round(1.476 * staffSpace)
    :                         space3CenterY + Math.round(1.086 * staffSpace); // 16th

    // Augmentation dot: Bravura U+E1E7 (dotFz = restFz*0.55).
    // At dotFz, 1sp = 0.55*staffSpace. Dot bBox yMax=0.348sp → center = 0.174sp above baseline.
    // For quarter/eighth/16th: place dot in 3rd space; baseline = space3CenterY + 0.174*0.55*staffSpace ≈ +3px
    // For whole/half: use the 4th space (conventional dotted-rest position in treble)
    const dotFz  = Math.round(restFz * 0.55);
    const dotX   = cx + Math.round(0.55 * staffSpace);
    const dotDotOffset = Math.round(0.174 * 0.55 * staffSpace); // ≈ 3px
    const dotY   = (baseDur === "quarter" || baseDur === "eighth" || baseDur === "16th")
      ? space3CenterY + dotDotOffset
      : LINE_YS[2]! + Math.round(0.50 * staffSpace);

    // Selection box: approximate glyph bounds in px for the hit rect
    const selH   = Math.round(2.4 * staffSpace);
    const selY   = restBaselineY - selH;
    const selW   = Math.round(0.95 * staffSpace);

    return (
      <g style={{ pointerEvents: "none" }}>
        <text
          x={cx} y={restBaselineY}
          fontSize={restFz} fill={s}
          fontFamily="Bravura, serif"
          textAnchor="middle"
          style={{ userSelect: "none" }}>
          {glyph}
        </text>
        {isDotted && (
          <text
            x={dotX} y={dotY}
            fontSize={dotFz} fill={s}
            fontFamily="Bravura, serif"
            textAnchor="middle"
            style={{ userSelect: "none" }}>
            {"\uE1E7"}
          </text>
        )}
        {selected && (
          <rect x={cx - selW / 2 - 3} y={selY - 2} width={selW + 6} height={selH + 4}
            fill="none" stroke={SEL_BLUE} strokeWidth={1.3} rx={2} />
        )}
      </g>
    );
  }

  return (
    <g>
      {acc && (
        <text x={cx - rx - 2} y={cy + 4} fontSize={ROW_H * 0.9} fill={NOTE_BLACK}
          textAnchor="end"
          style={{ fontFamily: "serif", userSelect: "none", pointerEvents: "none" }}>
          {acc}
        </text>
      )}
      {/* ── Notehead shape ──────────────────────────────────────── */}
      {noteheadType === "slash" ? (
        <path d={`M${cx - rx * 0.7},${cy + ry * 1.2} L${cx + rx * 0.7},${cy - ry * 1.2}`}
          stroke={s} strokeWidth={4} strokeLinecap="square" style={{ pointerEvents: "none" }} />
      ) : noteheadType === "back-slash" ? (
        <path d={`M${cx + rx * 0.7},${cy + ry * 1.2} L${cx - rx * 0.7},${cy - ry * 1.2}`}
          stroke={s} strokeWidth={4} strokeLinecap="square" style={{ pointerEvents: "none" }} />
      ) : noteheadType === "x" ? (
        <g style={{ pointerEvents: "none" }}>
          <line x1={cx - rx * 0.7} y1={cy - ry * 0.9} x2={cx + rx * 0.7} y2={cy + ry * 0.9}
            stroke={s} strokeWidth={2.5} strokeLinecap="round" />
          <line x1={cx + rx * 0.7} y1={cy - ry * 0.9} x2={cx - rx * 0.7} y2={cy + ry * 0.9}
            stroke={s} strokeWidth={2.5} strokeLinecap="round" />
        </g>
      ) : noteheadType === "circle-x" ? (
        <g style={{ pointerEvents: "none" }}>
          <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={s} strokeWidth={1.5} />
          <line x1={cx - rx * 0.7} y1={cy - ry * 0.7} x2={cx + rx * 0.7} y2={cy + ry * 0.7}
            stroke={s} strokeWidth={1.5} strokeLinecap="round" />
          <line x1={cx + rx * 0.7} y1={cy - ry * 0.7} x2={cx - rx * 0.7} y2={cy + ry * 0.7}
            stroke={s} strokeWidth={1.5} strokeLinecap="round" />
        </g>
      ) : noteheadType === "diamond" ? (
        <path d={`M${cx},${cy - ry * 1.5} L${cx + rx * 1.2},${cy} L${cx},${cy + ry * 1.5} L${cx - rx * 1.2},${cy} Z`}
          fill={s} style={{ pointerEvents: "none" }} />
      ) : noteheadType === "diamond-open" ? (
        <path d={`M${cx},${cy - ry * 1.5} L${cx + rx * 1.2},${cy} L${cx},${cy + ry * 1.5} L${cx - rx * 1.2},${cy} Z`}
          fill="white" stroke={s} strokeWidth={1.5} style={{ pointerEvents: "none" }} />
      ) : noteheadType === "triangle" ? (
        <path d={`M${cx},${cy - ry * 1.6} L${cx + rx * 1.1},${cy + ry * 1.0} L${cx - rx * 1.1},${cy + ry * 1.0} Z`}
          fill={s} style={{ pointerEvents: "none" }} />
      ) : noteheadType === "square" ? (
        <rect x={cx - rx} y={cy - ry * 1.1} width={rx * 2} height={ry * 2.2}
          fill={s} style={{ pointerEvents: "none" }} />
      ) : filled ? (
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={s} />
      ) : (
        <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="white" stroke={s} strokeWidth={1.7} />
      )}
      {/* Augmentation dot: to the upper-right of the notehead */}
      {isDotted && (
        <circle cx={cx + rx + 5} cy={cy - ry * 0.35} r={ROW_H * 0.12}
          fill={s} style={{ pointerEvents: "none" }} />
      )}
      {selected && (
        <rect x={cx - rx - 3} y={cy - ry - 3} width={(rx + 3) * 2} height={(ry + 3) * 2}
          fill="none" stroke={SEL_BLUE} strokeWidth={1.5} rx={3} />
      )}
      {baseDur !== "whole" && !suppressStem && (
        <line x1={stemX} y1={cy} x2={stemX} y2={stemEnd}
          stroke={NOTE_BLACK} strokeWidth={1.4} />
      )}
      {/* Tremolo slashes through/on the stem */}
      {tremolo > 0 && baseDur !== "whole" && !suppressStem && (() => {
        const slashW = rx * 1.6;
        const spacing = ROW_H * 0.7;
        const midY = (cy + stemEnd) / 2;
        const startY = midY - (tremolo - 1) * spacing * 0.5;
        return Array.from({ length: tremolo }, (_, i) => {
          const sy = startY + i * spacing;
          return (
            <line key={i}
              x1={stemX - slashW / 2} y1={sy - spacing * 0.35}
              x2={stemX + slashW / 2} y2={sy + spacing * 0.35}
              stroke={NOTE_BLACK} strokeWidth={1.8} strokeLinecap="round"
              style={{ pointerEvents: "none" }} />
          );
        });
      })()}
      {!beamed && !suppressStem && baseDur === "eighth" && (
        <path
          d={stemUp
            ? `M${stemX},${stemEnd} C${stemX+10},${stemEnd+6} ${stemX+9},${stemEnd+14} ${stemX+1},${stemEnd+18}`
            : `M${stemX},${stemEnd} C${stemX+10},${stemEnd-6} ${stemX+9},${stemEnd-14} ${stemX+1},${stemEnd-18}`}
          stroke={NOTE_BLACK} strokeWidth={1.5} fill="none" />
      )}
      {!beamed && !suppressStem && baseDur === "16th" && (
        <>
          <path
            d={stemUp
              ? `M${stemX},${stemEnd} C${stemX+9},${stemEnd+5} ${stemX+8},${stemEnd+11} ${stemX+1},${stemEnd+15}`
              : `M${stemX},${stemEnd} C${stemX+9},${stemEnd-5} ${stemX+8},${stemEnd-11} ${stemX+1},${stemEnd-15}`}
            stroke={NOTE_BLACK} strokeWidth={1.5} fill="none" />
          <path
            d={stemUp
              ? `M${stemX},${stemEnd+9} C${stemX+9},${stemEnd+14} ${stemX+8},${stemEnd+21} ${stemX+1},${stemEnd+24}`
              : `M${stemX},${stemEnd-9} C${stemX+9},${stemEnd-14} ${stemX+8},${stemEnd-21} ${stemX+1},${stemEnd-24}`}
            stroke={NOTE_BLACK} strokeWidth={1.5} fill="none" />
        </>
      )}
    </g>
  );
}

// ─── ArticMark ────────────────────────────────────────────────────────────────
// Renders an articulation symbol above (or below) a notehead in the score SVG.
// cx/cy = notehead centre. dir = stem direction (articulation is opposite stem).

function ArticMark({ type, cx, cy, dir }: { type: string; cx: number; cy: number; dir: "up" | "down" }) {
  // Place mark on the side opposite the stem (same side as notehead open space)
  const above    = dir === "up";   // stem up → mark below; stem down → mark above
  const offsetY  = above ? cy + ROW_H * 1.6 : cy - ROW_H * 1.6;
  const textY    = above ? cy + ROW_H * 2.2 : cy - ROW_H * 1.0;
  const s = ROW_H * 1.1;   // icon size

  // Symbols rendered as SMuFL glyphs or simple SVG shapes
  const GLYPH_MAP: Record<string, string> = {
    staccato:     "\uE4A0",  // SMuFL articStaccatoAbove
    tenuto:       "\uE4A4",  // SMuFL articTenutoAbove
    accent:       "\uE4A0",  // fallback — we draw custom below
    marcato:      "\uE4AC",  // SMuFL articMarcatoAbove
    fermata:      "\uE4C0",  // SMuFL fermataAbove
    "fermata-short": "\uE4C4",
    "fermata-long":  "\uE4C6",
    "breath-mark":   "\uE4CE",
    "up-bow":        "\uE612",
    "down-bow":      "\uE610",
    "snap-pizzicato":"\uE631",
    "harmonic":      "\uE614",
    trill:           "\uE566",
    "trill-wavy":    "\uE566",  // trill + wavy extension line (TODO extension)
    turn:            "\uE567",
    "turn-inverted": "\uE568",
    mordent:         "\uE56C",  // SMuFL ornamentMordent
    "mordent-inverted": "\uE56D",  // SMuFL ornamentMordentInverted
    "prall-prall":   "\uE56B",  // SMuFL ornamentTremblement
    tremblement:     "\uE56E",  // SMuFL ornamentHaydn
    shake:           "\uE56F",  // SMuFL ornamentShake
  };

  const fz = ROW_H * 2.2; // render at 2 staff spaces for clarity

  // For glyphed articulations use Bravura text
  if (GLYPH_MAP[type]) {
    // accent / marcato / staccato etc use SMuFL "above" variants when above is true
    // and "below" (offset +1) when below — e.g. E4A0→E4A1
    const baseGlyph = GLYPH_MAP[type]!;
    const glyph = (baseGlyph.codePointAt(0) !== undefined && !above &&
                   (type === "staccato" || type === "accent" || type === "tenuto" || type === "marcato"))
      ? String.fromCodePoint(baseGlyph.codePointAt(0)! + 1)
      : baseGlyph;

    return (
      <text
        x={cx} y={above ? offsetY + s : offsetY}
        fontSize={fz} fill="#1a1a2e"
        fontFamily="Bravura, serif"
        textAnchor="middle"
        style={{ userSelect: "none", pointerEvents: "none" }}>
        {glyph}
      </text>
    );
  }

  // Fallback: simple hand-drawn SVG shapes for articulations without a glyph mapping
  const r = s / 2;
  switch (type) {
    case "staccatissimo":
      return <ellipse cx={cx} cy={offsetY} rx={r * 0.3} ry={r * 0.6}
        fill="#1a1a2e" style={{ pointerEvents: "none" }} />;
    case "portato":
      return (
        <g style={{ pointerEvents: "none" }}>
          <line x1={cx - r * 0.7} y1={offsetY - r * 0.6} x2={cx + r * 0.7} y2={offsetY - r * 0.6}
            stroke="#1a1a2e" strokeWidth={1.5} strokeLinecap="round" />
          <circle cx={cx} cy={offsetY + r * 0.1} r={r * 0.28} fill="#1a1a2e" />
        </g>
      );
    case "stress":
      return <path d={above
          ? `M${cx - r},${offsetY + r * 0.5} L${cx},${offsetY - r * 0.5} L${cx + r},${offsetY + r * 0.5}`
          : `M${cx - r},${offsetY - r * 0.5} L${cx},${offsetY + r * 0.5} L${cx + r},${offsetY - r * 0.5}`}
        stroke="#1a1a2e" strokeWidth={1.8} fill="none" strokeLinecap="round" strokeLinejoin="round"
        style={{ pointerEvents: "none" }} />;
    case "strong-accent":
      return (
        <g style={{ pointerEvents: "none" }}>
          <path d={`M${cx - r},${offsetY + r * 0.4} L${cx},${offsetY - r * 0.6} L${cx + r},${offsetY + r * 0.4}`}
            stroke="#1a1a2e" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <line x1={cx - r * 0.7} y1={offsetY + r * 0.4} x2={cx + r * 0.7} y2={offsetY + r * 0.4}
            stroke="#1a1a2e" strokeWidth={1.8} strokeLinecap="round" />
        </g>
      );
    case "left-hand-pizzicato":
      return (
        <g style={{ pointerEvents: "none" }}>
          <line x1={cx} y1={offsetY - r * 0.8} x2={cx} y2={offsetY + r * 0.8}
            stroke="#1a1a2e" strokeWidth={2} strokeLinecap="round" />
          <line x1={cx - r * 0.8} y1={offsetY} x2={cx + r * 0.8} y2={offsetY}
            stroke="#1a1a2e" strokeWidth={2} strokeLinecap="round" />
        </g>
      );
    case "spiccato":
      return <circle cx={cx} cy={offsetY} r={r * 0.3}
        fill="#1a1a2e" style={{ pointerEvents: "none" }} />;
    case "caesura":
      return (
        <g style={{ pointerEvents: "none" }}>
          <line x1={cx - r * 0.4} y1={textY - r * 0.6} x2={cx - r * 0.7} y2={textY + r * 0.6}
            stroke="#1a1a2e" strokeWidth={2} strokeLinecap="round" />
          <line x1={cx + r * 0.4} y1={textY - r * 0.6} x2={cx + r * 0.1} y2={textY + r * 0.6}
            stroke="#1a1a2e" strokeWidth={2} strokeLinecap="round" />
        </g>
      );
    case "doit":
      return <path d={`M${cx - r * 0.5},${offsetY + r * 0.3} Q${cx},${offsetY + r * 0.3} ${cx + r},${offsetY - r * 0.7}`}
        stroke="#1a1a2e" strokeWidth={1.8} fill="none" strokeLinecap="round"
        style={{ pointerEvents: "none" }} />;
    case "fall":
      return <path d={`M${cx - r * 0.5},${offsetY - r * 0.3} Q${cx},${offsetY - r * 0.3} ${cx + r},${offsetY + r * 0.7}`}
        stroke="#1a1a2e" strokeWidth={1.8} fill="none" strokeLinecap="round"
        style={{ pointerEvents: "none" }} />;
    case "plop":
      return <path d={`M${cx - r},${offsetY - r * 0.7} Q${cx},${offsetY} ${cx + r * 0.5},${offsetY}`}
        stroke="#1a1a2e" strokeWidth={1.8} fill="none" strokeLinecap="round"
        style={{ pointerEvents: "none" }} />;
    case "scoop":
      return <path d={`M${cx - r},${offsetY + r * 0.4} Q${cx - r},${offsetY - r * 0.4} ${cx + r * 0.5},${offsetY - r * 0.4}`}
        stroke="#1a1a2e" strokeWidth={1.8} fill="none" strokeLinecap="round"
        style={{ pointerEvents: "none" }} />;
    case "glissando":
      return <line x1={cx - r * 0.8} y1={offsetY + r * 0.6} x2={cx + r * 0.8} y2={offsetY - r * 0.6}
        stroke="#1a1a2e" strokeWidth={2} strokeLinecap="round" style={{ pointerEvents: "none" }} />;
    case "vibrato":
      return <path d={`M${cx - r * 1.2},${offsetY} C${cx - r * 0.6},${offsetY - r * 0.8} ${cx - r * 0.2},${offsetY - r * 0.8} ${cx},${offsetY} C${cx + r * 0.2},${offsetY + r * 0.8} ${cx + r * 0.6},${offsetY + r * 0.8} ${cx + r * 1.2},${offsetY}`}
        stroke="#1a1a2e" strokeWidth={1.5} fill="none" strokeLinecap="round"
        style={{ pointerEvents: "none" }} />;
    case "schleifer":
      return <path d={`M${cx - r * 0.8},${offsetY + r * 0.8} Q${cx - r * 0.3},${offsetY} ${cx},${offsetY} Q${cx + r * 0.3},${offsetY} ${cx + r * 0.8},${offsetY - r * 0.8}`}
        stroke="#1a1a2e" strokeWidth={1.5} fill="none" strokeLinecap="round"
        style={{ pointerEvents: "none" }} />;
    case "arpeggio-up":
      return (
        <g style={{ pointerEvents: "none" }}>
          <path d={`M${cx},${offsetY + r * 1.2} C${cx - r * 0.8},${offsetY + r * 0.7} ${cx + r * 0.8},${offsetY + r * 0.3} ${cx},${offsetY - r * 0.2} C${cx - r * 0.8},${offsetY - r * 0.7} ${cx + r * 0.8},${offsetY - r * 1.1} ${cx},${offsetY - r * 1.6}`}
            stroke="#1a1a2e" strokeWidth={1.8} fill="none" strokeLinecap="round" />
          <path d={`M${cx - r * 0.4},${offsetY - r * 1.8} L${cx},${offsetY - r * 1.6} L${cx - r * 0.3},${offsetY - r * 1.2}`}
            stroke="#1a1a2e" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case "arpeggio-down":
      return (
        <g style={{ pointerEvents: "none" }}>
          <path d={`M${cx},${offsetY - r * 1.2} C${cx + r * 0.8},${offsetY - r * 0.7} ${cx - r * 0.8},${offsetY - r * 0.3} ${cx},${offsetY + r * 0.2} C${cx + r * 0.8},${offsetY + r * 0.7} ${cx - r * 0.8},${offsetY + r * 1.1} ${cx},${offsetY + r * 1.6}`}
            stroke="#1a1a2e" strokeWidth={1.8} fill="none" strokeLinecap="round" />
          <path d={`M${cx + r * 0.4},${offsetY + r * 1.8} L${cx},${offsetY + r * 1.6} L${cx + r * 0.3},${offsetY + r * 1.2}`}
            stroke="#1a1a2e" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    default:
      return (
        <text x={cx} y={textY} fontSize={ROW_H * 0.8} fill="#1a1a2e"
          textAnchor="middle" fontFamily="serif"
          style={{ userSelect: "none", pointerEvents: "none" }}>
          {type}
        </text>
      );
  }
}

function GhostHead({ cx, cy }: { cx: number; cy: number }) {  return (
    <ellipse cx={cx} cy={cy} rx={ROW_H * 0.68} ry={ROW_H * 0.40}
      fill="rgba(0,0,0,0.07)" stroke="#888" strokeWidth={0.9}
      style={{ pointerEvents: "none" }} />
  );
}

/** Whole-measure rest: solid rectangle centered in the measure, hanging from REST_LINE_Y */
function WholeMeasureRest({ cx }: { cx: number }) {
  return (
    <rect x={cx - 10} y={REST_LINE_Y} width={20} height={ROW_H * 0.5}
      fill="#1e1e1e" rx={1} style={{ pointerEvents: "none" }} />
  );
}

// ─── Clef support ─────────────────────────────────────────────────────────────
// Bravura (SMuFL) codepoints for each clef type.
// NOTE: switching clef also requires a matching pitch-model update (future work).

const CLEF_GLYPHS: Record<ClefType, string> = {
  treble: "\uE050",  // SMuFL gClef
  bass:   "\uE062",  // SMuFL fClef
  alto:   "\uE05C",  // SMuFL cClef
  tenor:  "\uE05C",  // same C clef glyph, placed on 4th line
  percussion: "\uE069", // SMuFL unpitchedPercussionClef1
};

// ─── ClefPanel ────────────────────────────────────────────────────────────────
// Left-side SVG per system: staff lines, Bravura clef glyph, optional time sig.
//
// Bravura sizing: fontSize = staffH makes 1 em = 4 staff spaces (the staff height).
// Each clef's glyph y=0 (baseline) maps to a specific staff line:
//   treble → G4 line (LINE_YS[3], 4th from top)
//   bass   → F  line (LINE_YS[1], 2nd from top — where the two dots straddle)
//   alto   → B4 middle line (LINE_YS[2])

function ClefPanel({ isFirst, timeSig, clef = "treble" }: {
  isFirst: boolean;
  timeSig: string;
  clef?: ClefType;
}) {
  const clefW  = CLEF_W1; // same width on every row so clef position is identical throughout
  const [tsTop, tsBot] = timeSig.split("/");
  // fontSize = staff height → 1em = 4 staff spaces in Bravura
  const staffH = STAFF_BOT - STAFF_TOP;
  // Bravura font metrics for each clef glyph (in 1000-unit UPM):
  //   treble \uE050: yMin=-329, yMax=1078  — origin IS at the G4 line (normal baseline)
  //   bass   \uE062: yMin=92,   yMax=810   — entire glyph ABOVE font baseline; shift y down
  //     → place y so glyph-top (yMax) lands on the F-line (LINE_YS[1])
  //   alto   \uE05C: yMin=-5,   yMax=805   — same; center glyph mid-point on middle line
  //     → place y so glyph-center ((yMax+yMin)/2 ≈ 400/1000) aligns with LINE_YS[2]
  const clefBaselineY =
    clef === "treble"
      ? (LINE_YS[3] ?? STAFF_BOT)
      : clef === "bass"
      ? (LINE_YS[1] ?? STAFF_TOP) + Math.round(0.81 * staffH)   // ≈ 63 + 91 = 154
      : clef === "alto"
      ?                             (LINE_YS[2] ?? (STAFF_TOP + STAFF_BOT) / 2) + Math.round(0.40 * staffH)
      : clef === "tenor"
      ?                             (LINE_YS[1] ?? STAFF_TOP) + Math.round(0.40 * staffH)   // C clef on 4th line
      :                             STAFF_TOP; // percussion — we draw rectangles inline below
  const glyph  = CLEF_GLYPHS[clef];
  // Time sig: each digit centred in its staff half
  const halfH  = staffH / 2;
  const tsFz   = Math.round(halfH * 0.88);
  const tsX    = 78;  // centred in right portion of the 98px panel
  const tsTopY = STAFF_TOP + halfH * 0.5;
  const tsBotY = STAFF_TOP + halfH * 1.5;

  return (
    <div style={{ display: "block", flexShrink: 0,
                  paddingTop: SVG_PAD, paddingBottom: SVG_PAD }}>
    <svg width={clefW} height={SVG_H}
      overflow="visible"
      style={{ display: "block", background: "white" }}>
      {/* Staff lines */}
      {LINE_YS.map((y, li) => (
        <line key={li} x1={0} y1={y} x2={clefW} y2={y}
          stroke="#000" strokeWidth={1.0} />
      ))}
      {/* Opening barline (right edge) */}
      <line x1={clefW - 0.5} y1={STAFF_TOP} x2={clefW - 0.5} y2={STAFF_BOT + ROW_H / 2}
        stroke="#000" strokeWidth={1.4} />
      {/* Clef glyph — Bravura SMuFL font, precisely sized to the staff */}
      {clef === "percussion" ? (
        // Percussion / neutral clef: two solid vertical rectangles spanning the staff
        <>
          <rect x={8}  y={STAFF_TOP} width={Math.round(staffH * 0.12)} height={staffH}
            fill="#1a1a1a" />
          <rect x={18} y={STAFF_TOP} width={Math.round(staffH * 0.12)} height={staffH}
            fill="#1a1a1a" />
        </>
      ) : (
        <text x={2} y={clefBaselineY} fontSize={clef === "treble" ? staffH : clef === "bass" ? 100 : 90} fill="#1a1a1a"
          fontFamily="Bravura, serif"
          style={{ userSelect: "none", pointerEvents: "none" }}>
          {glyph}
        </text>
      )}
      {/* Time signature — first system only */}
      {isFirst && (
        <>
          <text x={tsX} y={tsTopY}
            fontSize={tsFz} fill="#1a1a1a" textAnchor="middle"
            dominantBaseline="central" fontFamily="serif"
            style={{ userSelect: "none", pointerEvents: "none" }}>
            {tsTop}
          </text>
          <text x={tsX} y={tsBotY}

            fontSize={tsFz} fill="#1a1a1a" textAnchor="middle"
            dominantBaseline="central" fontFamily="serif"
            style={{ userSelect: "none", pointerEvents: "none" }}>
            {tsBot}
          </text>
        </>
      )}
    </svg>
    </div>
  );
}

// ─── MeasurePanel ─────────────────────────────────────────────────────────────
// One SVG per measure. Scales up via CSS transform when focused (hovered/selected).
// getBoundingClientRect() on a CSS-transformed element returns the VISUAL rect,
// so we divide mouse coords by the current scale for correct SVG hit-testing.

interface SysMeasure {
  measure: ChartMeasure;
  notes:   ChartNote[];
  dirty:   boolean;
  saving:  boolean;
}

// ─── Context menu ─────────────────────────────────────────────────────────────

interface CtxMenu {
  x:       number;
  y:       number;
  mid:     number;
  noteIdx: number | null; // null = lasso/multi selection context
}

// ─── Lasso state ──────────────────────────────────────────────────────────────

interface LassoState {
  mid:  number;
  x0:   number; y0: number; // SVG-space anchor
  x1:   number; y1: number; // SVG-space current corner
}

// ─── Drag-to-move state ──────────────────────────────────────────────────────

interface DragState {
  ni:         number;   // index of primary dragged note
  startX:     number;   // SVG-space X where drag started
  startY:     number;   // SVG-space Y where drag started
  isDragging: boolean;  // true once movement threshold exceeded (4 px)
  curSlot:    number;   // current snapped target slot (primary note)
  curRow:     number;   // current snapped target row (primary note)
}

interface MeasurePanelProps {
  sm:             SysMeasure;
  tool:           ToolState;
  totalSlots:     number;
  measureW:       number;
  timeSig:        string;
  isFocused:      boolean;
  hoverZoom:      number;
  selMeasure:     number | null;
  selNote:        number | null;
  // Multi-select: set of note indices selected in THIS measure
  multiSel:       Set<number>;
  // Lasso rect for this measure (SVG-space coords), or null
  lasso:          { x: number; y: number; w: number; h: number } | null;
  hoverSlot:      number | null;
  hoverRow:       number | null;
  onHoverChange:  (slot: number | null, row: number | null) => void;
  onNoteClick:    (ni: number) => void;
  onNoteDouble:   (ni: number) => void;
  onNoteCtxMenu:  (ni: number, cx: number, cy: number) => void;
  onBgCtxMenu:    (cx: number, cy: number) => void;
  onPlace:        (slot: number, row: number) => void;
  onLassoStart:   (x: number, y: number) => void;
  onLassoMove:    (x: number, y: number) => void;
  onLassoEnd:     () => void;
  onDragCommit:   (ni: number, deltaSlot: number, deltaRow: number) => void;
}

function MeasurePanel({
  sm, tool, totalSlots, measureW, timeSig, isFocused, hoverZoom,
  selMeasure, selNote, multiSel, lasso, hoverSlot, hoverRow,
  onHoverChange, onNoteClick, onNoteDouble, onNoteCtxMenu, onBgCtxMenu, onPlace,
  onLassoStart, onLassoMove, onLassoEnd, onDragCommit,
}: MeasurePanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const slotW  = measureW / totalSlots;
  const scale  = isFocused ? hoverZoom : 1;
  // Drag-to-move local state
  const [drag, setDrag] = useState<DragState | null>(null);
  // Prevents click-to-select from firing immediately after a drag completes
  const justDraggedRef = useRef(false);

  const internalHover = hoverSlot !== null && hoverRow !== null
    ? { slot: hoverSlot, row: hoverRow } : null;

  // ── Per-note render data (positions, stem coords, etc.) ──────────────────
  const effectiveTimeSig = sm.measure.time_sig_override ?? timeSig;
  const beamResults      = computeBeaming(sm.notes, effectiveTimeSig);

  type NoteRenderInfo = {
    note: typeof sm.notes[number];
    ni: number;
    di: number; slot: number; dur: string; durSl: number;
    cx: number; cy: number;
    ac: string;
    leds: number[];
    sel: boolean;
    dir: "up" | "down";
    stemX: number; stemEnd: number;
    inChord: boolean; // true when this note shares its slot with another note
  };

  const noteData: NoteRenderInfo[] = sm.notes.map((note, ni) => {
    const di    = pitchToDRow(note.pitch);
    const slot  = note.notation_position ?? note.position;
    const dur   = note.notation_duration  ?? note.duration;
    const durSl = DURATION_SLOTS[dur] ?? 4;
    const cx    = (note.is_rest && dur === "whole")
      ? totalSlots * slotW / 2
      : slot * slotW + slotW / 2;
    const cy    = di * ROW_H + ROW_H / 2;
    const dir   = note.is_rest ? "up" : (note.stem_direction === "up" || note.stem_direction === "down" ? note.stem_direction : noteStemDir(di));
    const rx    = ROW_H * 0.68;
    const stemX = dir === "up" ? cx + rx - 1 : cx - rx + 1;
    const stemEnd = dir === "up" ? cy - STEM_LEN : cy + STEM_LEN;
    return {
      note, ni, di, slot, dur, durSl, cx, cy,
      ac: accSign(note.pitch), leds: ledgerYs(di),
      sel: (selMeasure === sm.measure.id && selNote === ni) || multiSel.has(ni),
      dir, stemX, stemEnd,
      inChord: false,
    };
  });

  // Collect beam groups (groupId → list of noteData entries)
  const beamGroupMap = new Map<number, NoteRenderInfo[]>();
  noteData.forEach((info, i) => {
    const br = beamResults[i];
    if (br && br.groupId !== -1) {
      const g = beamGroupMap.get(br.groupId) ?? [];
      g.push(info);
      beamGroupMap.set(br.groupId, g);
    }
  });

  // ── Beam direction normalization ─────────────────────────────────────────
  // All notes in a beam group MUST share the same stem direction; otherwise
  // stemX lands on opposite sides of different noteheads and the beam
  // geometry is incoherent.
  // Rule (standard engraving): use the average pitch row across all non-rest
  // members of the group.
  //   avgDi >= B4_DROW → stems up;  avgDi < B4_DROW → stems down.
  // We recompute stemX and stemEnd for every member so that chord detection
  // and the slant-geometry pass both see consistent values.
  const _rx = ROW_H * 0.68;
  beamGroupMap.forEach((group) => {
    const nonRests = group.filter((n) => !n.note.is_rest);
    if (nonRests.length === 0) return;
    const avgDi   = nonRests.reduce((s, n) => s + n.di, 0) / nonRests.length;
    // If any note in the group has an explicit stem_direction override, honour it.
    const explicitDir = nonRests.find((n) => n.note.stem_direction === "up" || n.note.stem_direction === "down")?.note.stem_direction;
    const beamDir: "up" | "down" = (explicitDir === "up" || explicitDir === "down") ? explicitDir : (avgDi >= B4_DROW ? "up" : "down");
    group.forEach((info) => {
      if (info.note.is_rest) return;
      info.dir     = beamDir;
      info.stemX   = beamDir === "up" ? info.cx + _rx - 1 : info.cx - _rx + 1;
      info.stemEnd = beamDir === "up" ? info.cy - STEM_LEN : info.cy + STEM_LEN;
    });
  });

  // ── Chord detection (notes sharing the same slot form a chord) ────────────
  // Group non-rest notes by slot. Any slot with ≥2 notes is a chord.
  // We mutate dir / stemX / stemEnd on each member so the beam pass sees
  // the correct shared-stem geometry automatically.
  const chordSlotMap = new Map<number, number[]>(); // slot → noteData indices
  noteData.forEach((info, i) => {
    if (info.note.is_rest) return;
    const arr = chordSlotMap.get(info.slot) ?? [];
    arr.push(i);
    chordSlotMap.set(info.slot, arr);
  });

  const chordGroupMap = new Map<number, NoteRenderInfo[]>();
  let chordIdSeq = 0;
  const rx_ = ROW_H * 0.68; // notehead half-width (matches NoteHead internals)
  chordSlotMap.forEach((indices) => {
    if (indices.length < 2) return;
    const group = indices.map((i) => noteData[i]!);
    // If any chord member is part of a beam group its direction was already
    // fixed by the normalization pass above — honour that.  Otherwise fall
    // back to the average-pitch-row rule for standalone chords.
    const beamedMember = group.find((n) => (beamResults[n.ni]?.groupId ?? -1) !== -1);
    const chordDir: "up" | "down" = beamedMember
      ? beamedMember.dir
      : (() => { const a = group.reduce((s, n) => s + n.di, 0) / group.length; return a >= B4_DROW ? "up" : "down"; })();
    // Outermost noteheads for stem extent
    const sortedByCy = [...group].sort((a, b) => a.cy - b.cy); // top (low cy) first
    const topNote = sortedByCy[0]!;  // highest pitch
    const botNote = sortedByCy[sortedByCy.length - 1]!; // lowest pitch
    const sharedStemX = chordDir === "up" ? botNote.cx + rx_ - 1 : topNote.cx - rx_ + 1;
    // Tip: STEM_LEN past the innermost note in the stem direction
    const sharedStemEnd = chordDir === "up"
      ? topNote.cy - STEM_LEN   // stem goes up past highest note
      : botNote.cy + STEM_LEN;  // stem goes down past lowest note
    // Propagate shared geometry so beams see consistent stemX / stemEnd
    group.forEach((info) => {
      info.inChord    = true;
      info.dir        = chordDir;
      info.stemX      = sharedStemX;
      info.stemEnd    = sharedStemEnd;
    });
    chordGroupMap.set(chordIdSeq++, group);
  });

  // ── Slanted beam geometry ─────────────────────────────────────────────────
  // Standard engraving rule: the beam is a slanted line from the first stem
  // tip to the last (clamped to ±2 staff rows so extreme intervals look good).
  // Each stem's end is updated to the exact Y where it meets that line, so
  // gaps and overshoots are impossible by construction.
  // Chords contribute ONE stemX per beat; the note with the most-extreme
  // natural stemEnd is used as the anchor for the slope calculation.

  type BeamGeo = {
    x1: number; y1: number;
    x2: number; y2: number;
    beamH: number;
    dir: "up" | "down";
    secondarySegs: { sx1: number; sy1: number; sx2: number; sy2: number }[];
  };

  const beamGeoMap = new Map<number, BeamGeo>();
  const _base  = (d: string) => d.startsWith("dotted-") ? d.slice(7) : d;
  const _is16  = (d: string) => _base(d) === "16th";
  const _stubW = ROW_H * 0.65;

  beamGroupMap.forEach((group, gid) => {
    if (group.length < 2) return;
    const dir = group[0]!.dir;

    // One representative per unique stemX (chords share an X).
    // Keep the note whose natural stemEnd is furthest from the noteheads.
    const byX = new Map<number, NoteRenderInfo>();
    group.forEach((info) => {
      const existing = byX.get(info.stemX);
      if (!existing) { byX.set(info.stemX, info); return; }
      const replace = dir === "up"
        ? info.stemEnd < existing.stemEnd   // smaller Y = higher tip (stem-up)
        : info.stemEnd > existing.stemEnd;  // larger  Y = lower  tip (stem-down)
      if (replace) byX.set(info.stemX, info);
    });

    const sorted = [...byX.values()].sort((a, b) => a.stemX - b.stemX);
    if (sorted.length < 2) return;

    const x1    = sorted[0]!.stemX;
    const x2    = sorted[sorted.length - 1]!.stemX;
    const rawY1 = sorted[0]!.stemEnd;
    const rawY2 = sorted[sorted.length - 1]!.stemEnd;

    // Clamp slope to ±2 staff rows
    const maxSlant = ROW_H * 2;
    const span     = x2 - x1 || 1;
    const slope    = Math.max(-maxSlant, Math.min(maxSlant, rawY2 - rawY1)) / span;

    // Anchor the beam line to the note with the most extreme natural stem tip:
    //   stem-up   → min stemEnd (highest pitch, smallest Y = highest in SVG)
    //   stem-down → max stemEnd (lowest  pitch, largest  Y = lowest  in SVG)
    // This guarantees the beam always sits at the correct engraving height
    // relative to the highest (or lowest) pitched note, never dragged in the
    // wrong direction by notes further from the beam.
    const extremal = dir === "up"
      ? sorted.reduce((best, n) => n.stemEnd < best.stemEnd ? n : best)
      : sorted.reduce((best, n) => n.stemEnd > best.stemEnd ? n : best);
    const y1 = extremal.stemEnd - slope * (extremal.stemX - x1);
    const y2 = y1 + slope * span;
    const beamAtX = (x: number) => y1 + slope * (x - x1);

    // Write each note's exact beam-meeting Y back so stems and chord stems
    // both terminate precisely on the beam line.
    group.forEach((info) => { info.stemEnd = beamAtX(info.stemX); });

    const beamH     = ROW_H * 0.625;   // ≈ 10 px at ROW_H=16 — matches standard 0.5 staff-space beam
    const gap2      = beamH + 3;
    const gapOffset = dir === "up" ? gap2 : -gap2;

    // Secondary beam segments — de-dup notes by slot, then apply beam rules.
    const allBySlot: NoteRenderInfo[] = [];
    const seenSlots = new Set<number>();
    [...group].sort((a, b) => a.slot - b.slot).forEach((info) => {
      if (!seenSlots.has(info.slot)) { allBySlot.push(info); seenSlots.add(info.slot); }
    });

    const secondarySegs: { sx1: number; sy1: number; sx2: number; sy2: number }[] = [];
    const hasLeft  = new Set<number>();
    const hasRight = new Set<number>();

    for (let k = 0; k < allBySlot.length - 1; k++) {
      const a = allBySlot[k]!;
      const b = allBySlot[k + 1]!;
      if (_is16(a.dur) && _is16(b.dur)) {
        const sx1 = Math.min(a.stemX, b.stemX);
        const sx2 = Math.max(a.stemX, b.stemX);
        secondarySegs.push({ sx1, sy1: beamAtX(sx1) + gapOffset, sx2, sy2: beamAtX(sx2) + gapOffset });
        hasRight.add(k);
        hasLeft.add(k + 1);
      }
    }

    // Stubs for isolated 16ths (no 16th neighbour on either side)
    for (let k = 0; k < allBySlot.length; k++) {
      const n = allBySlot[k]!;
      if (!_is16(n.dur) || hasLeft.has(k) || hasRight.has(k)) continue;
      if (k > 0) {
        secondarySegs.push({ sx1: n.stemX - _stubW, sy1: beamAtX(n.stemX - _stubW) + gapOffset, sx2: n.stemX, sy2: beamAtX(n.stemX) + gapOffset });
      } else if (k < allBySlot.length - 1) {
        secondarySegs.push({ sx1: n.stemX, sy1: beamAtX(n.stemX) + gapOffset, sx2: n.stemX + _stubW, sy2: beamAtX(n.stemX + _stubW) + gapOffset });
      }
    }

    beamGeoMap.set(gid, { x1, y1, x2, y2, beamH, dir, secondarySegs });
  });

  function getCell(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    // rect reflects CSS transform, so divide to get SVG coordinate space
    const x    = (e.clientX - rect.left)  / scale;
    const y    = (e.clientY - rect.top) / scale;
    const slot = Math.floor(x / slotW);
    const row  = Math.floor(y / ROW_H);
    if (slot < 0 || slot >= totalSlots || row < 0 || row >= D_TOTAL) return null;
    return { slot, row };
  }

  function noteAt(slot: number, row: number): number {
    for (let i = 0; i < sm.notes.length; i++) {
      const n = sm.notes[i]!;
      if (pitchToDRow(n.pitch) !== row) continue;
      const ns = n.notation_position ?? n.position;
      const nd = DURATION_SLOTS[n.notation_duration ?? n.duration] ?? 4;
      if (slot >= ns && slot < ns + nd) return i;
    }
    return -1;
  }

  const hoverOccupied = internalHover
    ? noteAt(internalHover.slot, internalHover.row) !== -1
    : false;
  const hoverOverflows = internalHover
    ? wouldOverflow(internalHover.slot, effectiveDur(tool), totalSlots)
    : false;

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    // ── Drag-to-move ────────────────────────────────────────────
    if (drag) {
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const svgX = (e.clientX - rect.left) / scale;
      const svgY = (e.clientY - rect.top)  / scale;
      const isDragging = drag.isDragging || Math.hypot(svgX - drag.startX, svgY - drag.startY) > 4;
      const origNote = sm.notes[drag.ni];
      const dur   = origNote ? (origNote.notation_duration ?? origNote.duration) : "quarter";
      const durSl = DURATION_SLOTS[dur] ?? 4;
      const rawSlot = Math.floor(svgX / slotW);
      const rawRow  = Math.floor(svgY / ROW_H);
      const snappedSlot = Math.max(0, Math.min(totalSlots - durSl, snapSlot(rawSlot, dur)));
      const snappedRow  = Math.max(0, Math.min(D_TOTAL - 1, rawRow));
      setDrag({ ...drag, isDragging, curSlot: snappedSlot, curRow: snappedRow });
      onHoverChange(null, null);
      return;
    }
    const c = getCell(e);
    if (!c) { onHoverChange(null, null); return; }
    // If lasso drag is active, update its corner
    if (e.buttons === 1 && tool.selectMode) {
      const svg = svgRef.current;
      if (svg) {
        const rect = svg.getBoundingClientRect();
        const x = (e.clientX - rect.left)  / scale;
        const y = (e.clientY - rect.top)   / scale;
        onLassoMove(x, y);
      }
      return;
    }
    // Snap hover ghost to duration grid so the full beat area previews correctly
    onHoverChange(snapSlot(c.slot, effectiveDur(tool)), c.row);
  }
  function onMouseLeave() {
    onHoverChange(null, null);
    if (drag) setDrag(null); // cancel drag when cursor leaves the measure
  }

  function onMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (!tool.selectMode) return;
    // Only initiate lasso on background (note <g> will stopPropagation)
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = (e.clientX - rect.left)  / scale;
    const y = (e.clientY - rect.top)   / scale;
    onLassoStart(x, y);
  }

  function onMouseUp() {
    if (drag) {
      if (drag.isDragging) {
        const origNote = sm.notes[drag.ni];
        if (origNote) {
          const origSlot = origNote.notation_position ?? origNote.position;
          const origDi   = pitchToDRow(origNote.pitch);
          const dSlot    = drag.curSlot - origSlot;
          const dRow     = drag.curRow  - origDi;
          if (dSlot !== 0 || dRow !== 0) {
            justDraggedRef.current = true;
            onDragCommit(drag.ni, dSlot, dRow);
          }
        }
      }
      setDrag(null);
      return;
    }
    if (tool.selectMode) onLassoEnd();
  }

  function onClick(e: React.MouseEvent<SVGSVGElement>) {
    if (tool.selectMode) return; // handled by note-level handlers in select mode
    const c = getCell(e);
    if (!c) return;
    // Check raw position first — allows selecting notes placed at any slot
    const ni = noteAt(c.slot, c.row);
    if (ni !== -1) { onNoteClick(ni); return; }
    // Snap to duration grid for placement so the full beat area is clickable
    const eff  = effectiveDur(tool);
    const slot = snapSlot(c.slot, eff);
    if (wouldOverflow(slot, eff, totalSlots)) return;
    onPlace(slot, c.row);
  }

  function onContextMenu(e: React.MouseEvent<SVGSVGElement>) {
    e.preventDefault();
    onBgCtxMenu(e.clientX, e.clientY);
  }

  // A measure is "empty" only when there are no real (non-placeholder) notes.
  // Placeholder whole-measure rests don't count — auto-fill handles those slots.
  const hasRealNotes = sm.notes.some((n) => !isPlaceholderRest(n, totalSlots));
  const isEmpty      = !hasRealNotes;
  // Compute fill rests for all unoccupied slots (works for empty measures too)
  const autoRests  = computeAutoRests(sm.notes, totalSlots);
  // Y-centre for auto-rest symbols: B4 (middle staff line)
  const autoRestCy = B4_DROW * ROW_H + ROW_H / 2;

  return (
    <div style={{
      position:        "relative",
      display:         "inline-block",
      flexShrink:      0,
      // Vertical padding reserves room for stems/noteheads that extend beyond SVG bounds
      paddingTop:      SVG_PAD,
      paddingBottom:   SVG_PAD,
      // Scale up on focus; origin anchored to the staff centre-bottom
      transform:       isFocused ? `scale(${hoverZoom})` : "scale(1)",
      transformOrigin: "50% 55%",
      transition:      "transform 0.13s ease, box-shadow 0.13s ease",
      zIndex:          isFocused ? 10 : 1,
      boxShadow:       isFocused
        ? "0 8px 24px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.06)"
        : "none",
    }}>
      <svg
        ref={svgRef}
        width={measureW}
        height={SVG_H}
        overflow="visible"
        style={{
          display: "block",
          background: "white",
          userSelect: "none",
          cursor: drag?.isDragging ? "grabbing"
            : tool.selectMode
            ? (lasso ? "crosshair" : "default")
            : internalHover && !hoverOccupied && !hoverOverflows ? "crosshair"
            : hoverOccupied ? "pointer"
            : hoverOverflows ? "not-allowed"
            : "default",
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
        onContextMenu={onContextMenu}
      >
        {/* ── Staff lines ───────────────────────────────────── */}
        {LINE_YS.map((y, li) => (
          <line key={li} x1={0} y1={y} x2={measureW} y2={y}
            stroke="#000" strokeWidth={1.0} style={{ pointerEvents: "none" }} />
        ))}

        {/* ── Focus highlight band (active measure) ─────────── */}
        {isFocused && (
          <rect x={0} y={STAFF_TOP - 1} width={measureW} height={STAFF_BOT - STAFF_TOP + ROW_H + 2}
            fill="rgba(74,108,247,0.04)" style={{ pointerEvents: "none" }} />
        )}

        {/* ── Hover crosshair ───────────────────────────────── */}
        {internalHover && !hoverOccupied && (
          <>
            <rect x={internalHover.slot * slotW} y={STAFF_TOP}
              width={slotW} height={STAFF_BOT - STAFF_TOP + ROW_H}
              fill="rgba(0,0,0,0.04)" style={{ pointerEvents: "none" }} />
            <rect x={0} y={internalHover.row * ROW_H}
              width={measureW} height={ROW_H}
              fill="rgba(0,0,0,0.05)" style={{ pointerEvents: "none" }} />
          </>
        )}

        {/* ── Measure number (above first beat) ────────────── */}
        {(sm.measure.measure_number === 1 || sm.measure.measure_number % 4 === 1) && (
          <text x={2} y={STAFF_TOP - 4}
            fontSize={9} fill="#6b7280" fontFamily="sans-serif"
            style={{ pointerEvents: "none", userSelect: "none" }}>
            {sm.measure.measure_number}
          </text>
        )}

        {/* ── Auto-fill rests (non-interactive, faded) ─────── */}
        {autoRests.map((ar) => {
          const durSl = DURATION_SLOTS[ar.duration] ?? 4;
          // Center whole-measure spanning rests (same as the old WholeMeasureRest)
          const cx    = durSl >= totalSlots
            ? measureW / 2
            : ar.slot * slotW + slotW / 2;
          return (
            <g key={`ar${ar.slot}-${ar.duration}`}
              style={{ pointerEvents: "none", opacity: 0.55 }}>
              {/* Subtle blue tint band — omit for whole-measure spans */}
              {durSl < totalSlots && (
                <rect
                  x={ar.slot * slotW + 1} y={STAFF_TOP}
                  width={durSl * slotW - 2} height={STAFF_BOT - STAFF_TOP + ROW_H}
                  fill="rgba(99,179,237,0.10)" />
              )}
              <NoteHead
                cx={cx} cy={autoRestCy}
                duration={ar.duration}
                isRest={true}
                selected={false}
                acc="" dir="up"
                slots={durSl} slotW={slotW}
              />
            </g>
          );
        })}

        {/* ── Notes ────────────────────────────────────────── */}
        {noteData.map(({ note, ni, cx, cy, dur, durSl, slot, di, ac, leds, sel, dir, inChord, stemEnd }) => {
          const br        = beamResults[ni];
          const beamed    = br ? br.role !== "none" : false;
          const isDragged = drag?.isDragging === true
            && (ni === drag.ni || (multiSel.has(ni) && multiSel.has(drag.ni)));
          return (
            <g key={`n${note.id}-${ni}`}
              style={{
                cursor:  tool.selectMode ? "grab" : "pointer",
                opacity: isDragged ? 0.25 : 1,
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (justDraggedRef.current) { justDraggedRef.current = false; return; }
                onNoteClick(ni);
              }}
              onDoubleClick={(e) => { e.stopPropagation(); onNoteDouble(ni); }}
              onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onNoteCtxMenu(ni, e.clientX, e.clientY); }}
              onMouseDown={(e) => {
                if (!tool.selectMode) return;
                e.stopPropagation();
                const svg = svgRef.current;
                if (!svg) return;
                const rect = svg.getBoundingClientRect();
                const svgX = (e.clientX - rect.left) / scale;
                const svgY = (e.clientY - rect.top)  / scale;
                setDrag({ ni, startX: svgX, startY: svgY, isDragging: false, curSlot: slot, curRow: di });
              }}
            >
              {leds.map((ly, li) => (
                <line key={li}
                  x1={cx - ROW_H * 1.1} y1={ly} x2={cx + ROW_H * 1.1} y2={ly}
                  stroke="#000" strokeWidth={1.0} style={{ pointerEvents: "none" }} />
              ))}
              <NoteHead cx={cx} cy={cy} duration={dur}
                isRest={note.is_rest} selected={sel}
                acc={ac} dir={dir} slots={durSl} slotW={slotW}
                beamed={beamed} suppressStem={inChord}
                stemEndOverride={beamed && !inChord ? stemEnd : undefined}
                noteheadType={note.notehead_type ?? "normal"}
                tremolo={note.tremolo ?? 0} />
              {/* ── Articulation mark ─────────────────────────── */}
              {note.articulation && (
                <ArticMark type={note.articulation} cx={cx} cy={cy} dir={dir} />
              )}
              {/* ── Dynamic mark ──────────────────────────────── */}
              {note.dynamic && (
                <text
                  x={cx} y={cy + ROW_H * 4.2}
                  fontSize={ROW_H * 0.85} fill="#c0334d"
                  textAnchor="middle" fontFamily="serif" fontStyle="italic"
                  fontWeight={700}
                  style={{ userSelect: "none", pointerEvents: "none" }}>
                  {note.dynamic === "<" ? "cresc." : note.dynamic === ">" ? "dim." : note.dynamic}
                </text>
              )}
              {/* ── Arpeggio wavy line ────────────────────────── */}
              {note.arpeggio && (
                <path d={`M${cx - ROW_H * 0.9},${cy - ROW_H * 0.6} C${cx - ROW_H * 1.3},${cy - ROW_H * 0.1} ${cx - ROW_H * 0.5},${cy + ROW_H * 0.4} ${cx - ROW_H * 0.9},${cy + ROW_H * 0.9}`}
                  stroke="#1a1a2e" strokeWidth={1.5} fill="none" strokeLinecap="round"
                  style={{ pointerEvents: "none" }} />
              )}
              {/* ── 8va/8vb label above staff ─────────────────── */}
              {note.ottava && (
                <text
                  x={cx} y={LINE_YS[0]! - ROW_H * 0.8}
                  fontSize={ROW_H * 0.9} fill="#555" fontFamily="serif" fontStyle="italic"
                  textAnchor="middle"
                  style={{ userSelect: "none", pointerEvents: "none" }}>
                  {note.ottava}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Ties ─────────────────────────────────────────────── */}
        {noteData.map(({ note, cx, cy, dir, ni }) => {
          if (!note.tied_to_next) return null;
          // Find next note of same pitch in this measure
          const nextInfo = noteData.find((nd, j) => j > ni && nd.note.pitch === note.pitch && !nd.note.is_rest);
          if (!nextInfo) return null;
          const x1 = cx, x2 = nextInfo.cx;
          const mid = (x1 + x2) / 2;
          const arcH = dir === "up" ? ROW_H * 1.2 : -ROW_H * 1.2;
          return (
            <path key={`tie-${ni}`}
              d={`M${x1},${cy} Q${mid},${cy + arcH} ${x2},${nextInfo.cy}`}
              stroke="#1a1a2e" strokeWidth={1.5} fill="none" strokeLinecap="round"
              style={{ pointerEvents: "none" }} />
          );
        })}

        {/* ── Slurs ────────────────────────────────────────────── */}
        {(() => {
          const slurArcs: React.ReactNode[] = [];
          let slurStart: (typeof noteData)[0] | null = null;
          noteData.forEach((info, i) => {
            if (info.note.slur === "start") { slurStart = info; return; }
            if (info.note.slur === "end" && slurStart) {
              const x1 = slurStart.cx, x2 = info.cx;
              const mid = (x1 + x2) / 2;
              const avgCy = (slurStart.cy + info.cy) / 2;
              const arcH = slurStart.dir === "up" ? ROW_H * 1.8 : -ROW_H * 1.8;
              slurArcs.push(
                <path key={`slur-${i}`}
                  d={`M${x1},${slurStart.cy} Q${mid},${avgCy + arcH} ${x2},${info.cy}`}
                  stroke="#1a1a2e" strokeWidth={1.3} fill="none" strokeLinecap="round"
                  style={{ pointerEvents: "none" }} />
              );
              slurStart = null;
            }
          });
          return slurArcs;
        })()}

        {/* ── Drag ghost notes ─────────────────────────────────── */}
        {drag?.isDragging && (() => {
          const primaryInfo = noteData[drag.ni];
          if (!primaryInfo) return null;
          const deltaSlot = drag.curSlot - primaryInfo.slot;
          const deltaRow  = drag.curRow  - primaryInfo.di;
          const toDrag = (multiSel.has(drag.ni) && multiSel.size > 1)
            ? multiSel : new Set([drag.ni]);
          return (
            <>
              {[...toDrag].map((dni) => {
                const info = noteData[dni];
                if (!info) return null;
                const durSl2  = DURATION_SLOTS[info.dur] ?? 4;
                const newSlot = Math.max(0, Math.min(totalSlots - durSl2, info.slot + deltaSlot));
                const newDi   = Math.max(0, Math.min(D_TOTAL - 1, info.di + deltaRow));
                const ghostCx = newSlot * slotW + slotW / 2;
                const ghostCy = newDi * ROW_H + ROW_H / 2;
                const ghostDir = info.note.is_rest ? "up" : noteStemDir(newDi);
                return (
                  <g key={`dg-${dni}`} style={{ pointerEvents: "none", opacity: 0.65 }}>
                    <NoteHead
                      cx={ghostCx} cy={ghostCy}
                      duration={info.dur} isRest={info.note.is_rest}
                      selected={true} acc="" dir={ghostDir}
                      slots={durSl2} slotW={slotW}
                    />
                  </g>
                );
              })}
              {D_ROWS[drag.curRow] && (
                <text
                  x={drag.curSlot * slotW + slotW / 2}
                  y={Math.max(STAFF_TOP - 5, drag.curRow * ROW_H - 2)}
                  fontSize={9} fill="#4a6cf7" textAnchor="middle"
                  fontFamily="sans-serif" fontWeight={700}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {D_ROWS[drag.curRow]!.pitch}
                </text>
              )}
            </>
          );
        })()}

        {/* ── Lasso selection rect ──────────────────────────── */}
        {lasso && (
          <rect
            x={lasso.x} y={lasso.y} width={lasso.w} height={lasso.h}
            fill="rgba(74,108,247,0.10)" stroke="#4a6cf7" strokeWidth={1}
            strokeDasharray="4 3"
            style={{ pointerEvents: "none" }}
          />
        )}

        {/* ── Chord stems ───────────────────────────────────── */}
        {Array.from(chordGroupMap.entries()).map(([cgid, group]) => {
          // All notes in the group share the same stemX / stemEnd (set in chord pass)
          const { dir: chordDir, stemX: cStemX, stemEnd: cStemEnd } = group[0]!;
          // Stem spans from the outer notehead cy to the stem tip
          const sortedByCy = [...group].sort((a, b) => a.cy - b.cy);
          const stemY1 = chordDir === "up"
            ? sortedByCy[sortedByCy.length - 1]!.cy  // bottom (lowest pitch)
            : sortedByCy[0]!.cy;                      // top (highest pitch)
          // Flags: only for unbeamed chords (beamed chords get the beam bar instead)
          const repNote = group[0]!;
          const isInBeam = group.some((n) => (beamResults[n.ni]?.role ?? "none") !== "none");
          const baseDur  = repNote.dur.startsWith("dotted-") ? repNote.dur.slice(7) : repNote.dur;
          return (
            <g key={`chord-stem-${cgid}`} style={{ pointerEvents: "none" }}>
              <line x1={cStemX} y1={stemY1} x2={cStemX} y2={cStemEnd}
                stroke={NOTE_BLACK} strokeWidth={1.4} />
              {!isInBeam && baseDur === "eighth" && (
                <path
                  d={chordDir === "up"
                    ? `M${cStemX},${cStemEnd} C${cStemX+10},${cStemEnd+6} ${cStemX+9},${cStemEnd+14} ${cStemX+1},${cStemEnd+18}`
                    : `M${cStemX},${cStemEnd} C${cStemX+10},${cStemEnd-6} ${cStemX+9},${cStemEnd-14} ${cStemX+1},${cStemEnd-18}`}
                  stroke={NOTE_BLACK} strokeWidth={1.5} fill="none" />
              )}
              {!isInBeam && baseDur === "16th" && (
                <>
                  <path
                    d={chordDir === "up"
                      ? `M${cStemX},${cStemEnd} C${cStemX+9},${cStemEnd+5} ${cStemX+8},${cStemEnd+11} ${cStemX+1},${cStemEnd+15}`
                      : `M${cStemX},${cStemEnd} C${cStemX+9},${cStemEnd-5} ${cStemX+8},${cStemEnd-11} ${cStemX+1},${cStemEnd-15}`}
                    stroke={NOTE_BLACK} strokeWidth={1.5} fill="none" />
                  <path
                    d={chordDir === "up"
                      ? `M${cStemX},${cStemEnd+9} C${cStemX+9},${cStemEnd+14} ${cStemX+8},${cStemEnd+21} ${cStemX+1},${cStemEnd+24}`
                      : `M${cStemX},${cStemEnd-9} C${cStemX+9},${cStemEnd-14} ${cStemX+8},${cStemEnd-21} ${cStemX+1},${cStemEnd-24}`}
                    stroke={NOTE_BLACK} strokeWidth={1.5} fill="none" />
                </>
              )}
            </g>
          );
        })}

        {/* ── Beams ─────────────────────────────────────────── */}
        {Array.from(beamGeoMap.entries()).map(([gid, geo]) => {
          const { x1, y1, x2, y2, beamH, secondarySegs } = geo;
          const hb  = beamH / 2;
          // Slanted beam trapezoid: 4 corners centred on the beam-line Y at each edge
          const pts = (ax: number, ay: number, bx: number, by: number) =>
            `${ax},${ay - hb} ${bx},${by - hb} ${bx},${by + hb} ${ax},${ay + hb}`;
          return (
            <g key={`beam-${gid}`} style={{ pointerEvents: "none" }}>
              <polygon points={pts(x1, y1, x2, y2)} fill={NOTE_BLACK} />
              {secondarySegs.map((seg, si) => (
                <polygon key={`b2-${si}`}
                  points={pts(seg.sx1, seg.sy1, seg.sx2, seg.sy2)}
                  fill={NOTE_BLACK} />
              ))}
            </g>
          );
        })}

        {/* ── Ghost note on hover ───────────────────────────── */}
        {internalHover && !hoverOccupied && !hoverOverflows && (
          <GhostHead
            cx={internalHover.slot * slotW + slotW / 2}
            cy={internalHover.row * ROW_H + ROW_H / 2}
          />
        )}

        {/* ── Right barline ────────────────────────────────── */}
        <line x1={measureW - 0.5} y1={STAFF_TOP}
          x2={measureW - 0.5} y2={STAFF_BOT + ROW_H / 2}
          stroke="#000" strokeWidth={1.0} style={{ pointerEvents: "none" }} />

        {/* ── Unsaved indicator dot ────────────────────────── */}
        {sm.dirty && (
          <circle cx={measureW - 4} cy={STAFF_TOP - 8} r={3} fill="#f59e0b">
            <title>Unsaved changes</title>
          </circle>
        )}
      </svg>
    </div>
  );
}

// ─── ScoreSystem ──────────────────────────────────────────────────────────────
// One row of measures (one system). ClefPanel + MeasurePanel[].

interface SysProps {
  measures:       SysMeasure[];
  tool:           ToolState;
  totalSlots:     number;
  isFirst:        boolean;
  timeSig:        string;
  clef?:          ClefType;
  measureW:       number;
  hoverZoom:      number;
  selMeasure:     number | null;
  selNote:        number | null;
  multiSelMap:    Record<number, Set<number>>;
  lassoMap:       Record<number, { x: number; y: number; w: number; h: number }>;
  hover:          { mid: number; slot: number; row: number } | null;
  onHover:        (h: { mid: number; slot: number; row: number } | null) => void;
  onNoteClick:    (mid: number, ni: number) => void;
  onNoteDouble:   (mid: number, ni: number) => void;
  onNoteCtxMenu:  (mid: number, ni: number, cx: number, cy: number) => void;
  onBgCtxMenu:    (mid: number, cx: number, cy: number) => void;
  onPlace:        (mid: number, slot: number, row: number) => void;
  onSave:         (mid: number) => void;
  onLassoStart:   (mid: number, x: number, y: number) => void;
  onLassoMove:    (mid: number, x: number, y: number) => void;
  onLassoEnd:     (mid: number) => void;
  onDragCommit:   (mid: number, ni: number, deltaSlot: number, deltaRow: number) => void;
}

function ScoreSystem({
  measures, tool, totalSlots, isFirst, timeSig, clef = "treble",
  measureW, hoverZoom, selMeasure, selNote, multiSelMap, lassoMap,
  hover, onHover, onNoteClick, onNoteDouble, onNoteCtxMenu, onBgCtxMenu, onPlace,
  onLassoStart, onLassoMove, onLassoEnd, onDragCommit,
}: SysProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", lineHeight: 0 }}>
      <ClefPanel isFirst={isFirst} timeSig={timeSig} clef={clef} />
      {measures.map((sm) => {
        const isFocused =
          hover?.mid  === sm.measure.id ||
          selMeasure  === sm.measure.id;
        return (
          <MeasurePanel
            key={sm.measure.id}
            sm={sm}
            tool={tool}
            totalSlots={totalSlots}
            measureW={measureW}
            timeSig={timeSig}
            isFocused={isFocused}
            hoverZoom={hoverZoom}
            selMeasure={selMeasure}
            selNote={selNote}
            multiSel={multiSelMap[sm.measure.id] ?? new Set()}
            lasso={lassoMap[sm.measure.id] ?? null}
            hoverSlot={hover?.mid === sm.measure.id ? hover.slot : null}
            hoverRow={hover?.mid  === sm.measure.id ? hover.row  : null}
            onHoverChange={(slot, row) => {
              if (slot === null) onHover(null);
              else onHover({ mid: sm.measure.id, slot, row: row! });
            }}
            onNoteClick={(ni) => onNoteClick(sm.measure.id, ni)}
            onNoteDouble={(ni) => onNoteDouble(sm.measure.id, ni)}
            onNoteCtxMenu={(ni, cx, cy) => onNoteCtxMenu(sm.measure.id, ni, cx, cy)}
            onBgCtxMenu={(cx, cy) => onBgCtxMenu(sm.measure.id, cx, cy)}
            onPlace={(slot, row) => onPlace(sm.measure.id, slot, row)}
            onLassoStart={(x, y) => onLassoStart(sm.measure.id, x, y)}
            onLassoMove={(x, y) => onLassoMove(sm.measure.id, x, y)}
            onLassoEnd={() => onLassoEnd(sm.measure.id)}
            onDragCommit={(ni, dSlot, dRow) => onDragCommit(sm.measure.id, ni, dSlot, dRow)}
          />
        );
      })}
    </div>
  );
}

// ─── SelectedNotePanel ────────────────────────────────────────────────────────

function SelectedNotePanel({
  note, onEdit, onDelete, onClose,
}: {
  note:     ChartNote;
  onEdit:   (c: Partial<ChartNote>) => void;
  onDelete: () => void;
  onClose:  () => void;
}) {
  return (
    <div style={{
      display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
      padding: "6px 12px", marginBottom: 6,
      background: "#eff6ff", border: "1px solid #bfdbfe",
      borderRadius: 6, fontSize: 12,
    }}>
      <span style={{ fontWeight: 700, color: "#1e40af" }}>Selected:</span>
      <span style={{ color: "#475569" }}>
        {note.pitch} {note.notation_duration ?? note.duration}{note.is_rest ? " rest" : ""}
      </span>
      {!note.is_rest && (
        <label style={{ color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
          Pitch:
          <input value={note.pitch}
            onChange={(e) => onEdit({ pitch: e.target.value })}
            style={{ width: 60, padding: "2px 5px", fontSize: 12, borderRadius: 4,
                     border: "1px solid #93c5fd", marginLeft: 4 }} />
        </label>
      )}
      <label style={{ color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
        Duration:
        <select value={note.notation_duration ?? note.duration}
          onChange={(e) => onEdit({ duration: e.target.value, notation_duration: e.target.value })}
          style={{ marginLeft: 4, fontSize: 12, borderRadius: 4,
                   border: "1px solid #93c5fd", padding: "2px 4px" }}>
          {["whole","half","quarter","eighth","16th"].map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4, color: "#475569" }}>
        <input type="checkbox" checked={note.is_rest}
          onChange={(e) => onEdit({ is_rest: e.target.checked })} />
        Rest
      </label>
      {!note.is_rest && (
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ color: "#475569" }}>Stem:</span>
          {(["up", "down", null] as const).map((v) => (
            <button key={String(v)} type="button"
              onClick={() => onEdit({ stem_direction: v })}
              style={{
                padding: "2px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer",
                border: "1px solid #93c5fd",
                background: (note.stem_direction ?? null) === v ? "#bfdbfe" : "transparent",
                color: "#1e40af", fontWeight: (note.stem_direction ?? null) === v ? 700 : 400,
              }}>
              {v === "up" ? "↑ Up" : v === "down" ? "↓ Down" : "Auto"}
            </button>
          ))}
        </span>
      )}
      <button type="button" onClick={onDelete}
        style={{ padding: "3px 10px", borderRadius: 4, border: "none",
                 background: "#ef4444", color: "white", cursor: "pointer",
                 fontSize: 11, fontWeight: 600 }}>
        Delete
      </button>
      <label style={{ color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
        Articulation:
        <select value={note.articulation ?? ""}
          onChange={(e) => onEdit({ articulation: e.target.value || null })}
          style={{ marginLeft: 4, fontSize: 11, borderRadius: 4,
                   border: "1px solid #93c5fd", padding: "2px 4px" }}>
          <option value="">None</option>
          {["staccato","staccatissimo","tenuto","portato","accent","marcato","strong-accent","stress",
            "up-bow","down-bow","snap-pizzicato","left-hand-pizzicato","harmonic","spiccato",
            "fermata","fermata-short","fermata-long","breath-mark","caesura",
            "trill","trill-wavy","turn","turn-inverted","mordent","mordent-inverted","prall-prall","tremblement","shake","schleifer",
            "doit","fall","plop","scoop","glissando","vibrato","arpeggio-up","arpeggio-down"].map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>
      <label style={{ color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
        Dynamic:
        <select value={note.dynamic ?? ""}
          onChange={(e) => onEdit({ dynamic: e.target.value || null })}
          style={{ marginLeft: 4, fontSize: 11, borderRadius: 4,
                   border: "1px solid #93c5fd", padding: "2px 4px" }}>
          <option value="">None</option>
          {["pppp","ppp","pp","p","mp","mf","f","ff","fff","ffff","fp","fz","sf","sfz","sff","sffz","rfz","rf","<",">"].map((d) => (
            <option key={d} value={d}>{d === "<" ? "cresc." : d === ">" ? "dim." : d}</option>
          ))}
        </select>
      </label>
      <label style={{ color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
        Notehead:
        <select value={note.notehead_type ?? "normal"}
          onChange={(e) => onEdit({ notehead_type: e.target.value === "normal" ? null : e.target.value })}
          style={{ marginLeft: 4, fontSize: 11, borderRadius: 4,
                   border: "1px solid #93c5fd", padding: "2px 4px" }}>
          {["normal","slash","x","circle-x","diamond","diamond-open","triangle","square","back-slash"].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
      <label style={{ color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
        Tremolo:
        <select value={String(note.tremolo ?? 0)}
          onChange={(e) => onEdit({ tremolo: Number(e.target.value) || null })}
          style={{ marginLeft: 4, fontSize: 11, borderRadius: 4,
                   border: "1px solid #93c5fd", padding: "2px 4px" }}>
          {["0","1","2","3","4"].map((n) => (
            <option key={n} value={n}>{n === "0" ? "None" : `${n} slash`}</option>
          ))}
        </select>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4, color: "#475569" }}>
        <input type="checkbox" checked={!!note.tied_to_next}
          onChange={(e) => onEdit({ tied_to_next: e.target.checked || null })} />
        Tie to next
      </label>
      <label style={{ color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
        Slur:
        <select value={note.slur ?? ""}
          onChange={(e) => onEdit({ slur: (e.target.value as ChartNote["slur"]) || null })}
          style={{ marginLeft: 4, fontSize: 11, borderRadius: 4,
                   border: "1px solid #93c5fd", padding: "2px 4px" }}>
          <option value="">None</option>
          <option value="start">Start</option>
          <option value="end">End</option>
        </select>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 4, color: "#475569" }}>
        <input type="checkbox" checked={!!note.arpeggio}
          onChange={(e) => onEdit({ arpeggio: e.target.checked || null })} />
        Arpeggio
      </label>
      <label style={{ color: "#475569", display: "flex", alignItems: "center", gap: 4 }}>
        Ottava:
        <select value={note.ottava ?? ""}
          onChange={(e) => onEdit({ ottava: (e.target.value as ChartNote["ottava"]) || null })}
          style={{ marginLeft: 4, fontSize: 11, borderRadius: 4,
                   border: "1px solid #93c5fd", padding: "2px 4px" }}>
          <option value="">None</option>
          <option value="8va">8va</option>
          <option value="8vb">8vb</option>
          <option value="15ma">15ma</option>
          <option value="15mb">15mb</option>
        </select>
      </label>
      <button type="button" onClick={onClose}
        style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid #93c5fd",
                 background: "transparent", color: "#1e40af", cursor: "pointer", fontSize: 11 }}>
        Done
      </button>
    </div>
  );
}

// ─── ScoreEditor (main export) ────────────────────────────────────────────────

interface ScoreEditorProps {
  chart:   Chart;
  onSaved: (updated: Chart) => void;
}

export default function ScoreEditor({ chart, onSaved }: ScoreEditorProps) {
  const [timeSig,    setTimeSig]    = useState(chart.time_sig);
  const totalSlots = timeSigSlots(timeSig);

  const [settings,   setSettings]   = useState<ScoreSettingsValues>(DEFAULT_SCORE_SETTINGS);
  const [tool,       setTool]       = useState<ToolState>(DEFAULT_TOOL);
  const history = useHistory<Record<number, ChartNote[]>>(
    Object.fromEntries(chart.measures.map((m) => [m.id, m.notes]))
  );
  // Alias for ergonomic reads everywhere in the component
  const localNotes = history.notes;
  const [dirty,   setDirty]   = useState<Record<number, boolean>>({});
  const [saving,  setSaving]  = useState<Record<number, boolean>>({});
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [selMid,  setSelMid]  = useState<number | null>(null);
  const [selNi,   setSelNi]   = useState<number | null>(null);
  const [hover,   setHover]   = useState<{ mid: number; slot: number; row: number } | null>(null);
  const [clef,    setClef]    = useState<ClefType>("treble");

  // Multi-select: Record<measureId, Set<noteIndex>>
  const [multiSelMap, setMultiSelMap] = useState<Record<number, Set<number>>>({});

  // Lasso drag state
  const [lassoState, setLassoState] = useState<LassoState | null>(null);
  // Computed lasso rects per measure (SVG space, positive w/h for rendering)
  const [lassoMap, setLassoMap] = useState<Record<number, { x: number; y: number; w: number; h: number }>>({});

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  // Effective measure content width — responds to measureZoom setting
  const measureW = Math.round(MEASURE_W_BASE * settings.measureZoom);

  useEffect(() => {
    setTimeSig(chart.time_sig);
    history.reset(Object.fromEntries(chart.measures.map((m) => [m.id, m.notes])));
    setDirty({});
    setSelMid(null); setSelNi(null);
    setMultiSelMap({});
    setLassoState(null); setLassoMap({});
    setCtxMenu(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.id]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      // Delete / Backspace — remove selected notes
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      }

      // Ctrl+Z — undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") {
        e.preventDefault();
        history.undo();
        // Mark all measures dirty so user is prompted to save after undo
        setDirty(Object.fromEntries(chart.measures.map((m) => [m.id, true])));
      }

      // Ctrl+Y / Ctrl+Shift+Z — redo
      if (
        ((e.ctrlKey || e.metaKey) && e.key === "y") ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "z")
      ) {
        e.preventDefault();
        history.redo();
        setDirty(Object.fromEntries(chart.measures.map((m) => [m.id, true])));
      }

      // Escape — deselect all
      if (e.key === "Escape") {
        setSelMid(null); setSelNi(null);
        setMultiSelMap({});
        setCtxMenu(null);
      }

      // Ctrl+A — select all notes in the focused measure
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        e.preventDefault();
        if (selMid !== null) {
          const notes = localNotes[selMid] ?? [];
          setMultiSelMap((p) => ({
            ...p,
            [selMid]: new Set(notes.map((_, i) => i)),
          }));
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // We intentionally include selMid and localNotes via the closure —
  // the effect re-subscribes whenever they change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selMid, localNotes, multiSelMap]);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    function onDown() { setCtxMenu(null); }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [ctxMenu]);

  const changeNotes = useCallback((mid: number, notes: ChartNote[]) => {
    history.set((p) => ({ ...p, [mid]: notes }));
    setDirty((p) => ({ ...p, [mid]: true }));
  // history.set is a stable useCallback — safe to include
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.set]);

  // ── Delete selected notes (single or multi) ────────────────────────────────
  function deleteSelected() {
    // Multi-select takes priority
    const hasMul = Object.values(multiSelMap).some((s) => s.size > 0);
    if (hasMul) {
      history.set((prev) => {
        const next = { ...prev };
        for (const [midStr, idxSet] of Object.entries(multiSelMap)) {
          const mid  = Number(midStr);
          const orig = prev[mid] ?? [];
          next[mid]  = orig.filter((_, i) => !idxSet.has(i));
        }
        return next;
      });
      setDirty((p) => {
        const next = { ...p };
        for (const midStr of Object.keys(multiSelMap)) next[Number(midStr)] = true;
        return next;
      });
      setMultiSelMap({});
      setSelMid(null); setSelNi(null);
      return;
    }
    // Single selection fallback
    if (selMid !== null && selNi !== null) {
      changeNotes(selMid, (localNotes[selMid] ?? []).filter((_, i) => i !== selNi));
      setSelMid(null); setSelNi(null);
    }
  }

  // ── Flip stem direction of selected notes ─────────────────────────────────
  function flipStem(dir: "up" | "down") {
    const hasMul = Object.values(multiSelMap).some((s) => s.size > 0);
    if (hasMul) {
      history.set((prev) => {
        const next = { ...prev };
        for (const [midStr, idxSet] of Object.entries(multiSelMap)) {
          const mid  = Number(midStr);
          const orig = prev[mid] ?? [];
          next[mid]  = orig.map((n, i) => idxSet.has(i) ? { ...n, stem_direction: dir } : n);
        }
        return next;
      });
      setDirty((p) => {
        const next = { ...p };
        for (const midStr of Object.keys(multiSelMap)) next[Number(midStr)] = true;
        return next;
      });
      return;
    }
    // Single selection fallback
    if (selMid !== null && selNi !== null) {
      changeNotes(selMid, (localNotes[selMid] ?? []).map((n, i) => i === selNi ? { ...n, stem_direction: dir } : n));
    }
  }

  // ── Total multi-selected count (for status badge) ─────────────────────────
  const multiSelCount = Object.values(multiSelMap).reduce((s, set) => s + set.size, 0);

  function handleNoteClick(mid: number, ni: number) {
    if (tool.selectMode) {
      // Toggle note in multi-select set
      setMultiSelMap((p) => {
        const cur  = new Set(p[mid] ?? []);
        cur.has(ni) ? cur.delete(ni) : cur.add(ni);
        return { ...p, [mid]: cur };
      });
      setSelMid(mid); // keep measure focused
      return;
    }
    // Note-input mode: click existing note to single-select; click again to delete
    if (selMid === mid && selNi === ni) {
      changeNotes(mid, (localNotes[mid] ?? []).filter((_, i) => i !== ni));
      setSelMid(null); setSelNi(null);
    } else {
      setSelMid(mid); setSelNi(ni);
      setMultiSelMap({});
    }
  }

  function handleNoteDouble(mid: number, ni: number) {
    // Double-click always deletes the note immediately
    changeNotes(mid, (localNotes[mid] ?? []).filter((_, i) => i !== ni));
    setSelMid(null); setSelNi(null);
    setMultiSelMap((p) => {
      const next = { ...p };
      const cur  = new Set(next[mid] ?? []);
      cur.delete(ni);
      next[mid] = cur;
      return next;
    });
  }

  function handleNoteCtxMenu(mid: number, ni: number, cx: number, cy: number) {
    // Right-click on a note: add it to multi-select if not already, then show menu
    setMultiSelMap((p) => {
      const cur = new Set(p[mid] ?? []);
      if (!cur.has(ni)) cur.add(ni);
      return { ...p, [mid]: cur };
    });
    setCtxMenu({ x: cx, y: cy, mid, noteIdx: ni });
  }

  function handleBgCtxMenu(mid: number, cx: number, cy: number) {
    if (multiSelCount > 0) {
      setCtxMenu({ x: cx, y: cy, mid, noteIdx: null });
    }
  }

  function handlePlace(mid: number, slot: number, row: number) {
    if (tool.selectMode) return; // no placement in select mode
    const rowDef = D_ROWS[row];
    if (!rowDef) return;
    const eff = effectiveDur(tool);
    if (wouldOverflow(slot, eff, totalSlots)) return;
    const pitch = tool.isRest ? rowDef.pitch : withAcc(rowDef.pitch, tool.accidental);
    const note: ChartNote = {
      id: -(Date.now()), measure_id: mid,
      position: slot, pitch, duration: eff,
      is_rest: tool.isRest, velocity: 80,
      start_time_s: null, end_time_s: null,
      notation_position: slot, notation_duration: eff,
      articulation: tool.articulation || null,
      dynamic: tool.dynamic || null,
      notehead_type: tool.noteheadType !== "normal" ? tool.noteheadType : null,
      tremolo: tool.tremolo > 0 ? tool.tremolo : null,
      tied_to_next: tool.tiedToNext || null,
      slur: tool.slurStart ? "start" : null,
      arpeggio: tool.arpeggio || null,
      ottava: tool.ottava as ChartNote["ottava"] || null,
    };
    const existing = (localNotes[mid] ?? []).filter((n) => !isPlaceholderRest(n, totalSlots));
    changeNotes(mid, [...existing, note]);
    setSelMid(null); setSelNi(null);
  }

  // ── Lasso drag ────────────────────────────────────────────────────────────
  function handleLassoStart(mid: number, x: number, y: number) {
    setLassoState({ mid, x0: x, y0: y, x1: x, y1: y });
    setLassoMap({ [mid]: { x, y, w: 0, h: 0 } });
    // Clear previous selection
    setMultiSelMap({});
  }

  function handleLassoMove(mid: number, x: number, y: number) {
    setLassoState((prev) => {
      if (!prev || prev.mid !== mid) return prev;
      const next = { ...prev, x1: x, y1: y };
      const rx = Math.min(next.x0, next.x1);
      const ry = Math.min(next.y0, next.y1);
      const rw = Math.abs(next.x1 - next.x0);
      const rh = Math.abs(next.y1 - next.y0);
      setLassoMap({ [mid]: { x: rx, y: ry, w: rw, h: rh } });
      return next;
    });
  }

  function handleLassoEnd(mid: number) {
    const ls = lassoState;
    if (!ls || ls.mid !== mid) { setLassoState(null); setLassoMap({}); return; }
    const slotW = measureW / totalSlots;
    const rx = Math.min(ls.x0, ls.x1);
    const ry = Math.min(ls.y0, ls.y1);
    const rw = Math.abs(ls.x1 - ls.x0);
    const rh = Math.abs(ls.y1 - ls.y0);
    // Select any note whose cx/cy falls within the lasso rect
    const notes = localNotes[mid] ?? [];
    const selected = new Set<number>();
    notes.forEach((note, ni) => {
      const dur  = note.notation_duration ?? note.duration;
      const slot = note.notation_position ?? note.position;
      const cx   = (note.is_rest && dur === "whole")
        ? totalSlots * slotW / 2
        : slot * slotW + slotW / 2;
      const di   = pitchToDRow(note.pitch);
      const cy   = di * ROW_H + ROW_H / 2;
      if (cx >= rx && cx <= rx + rw && cy >= ry && cy <= ry + rh) {
        selected.add(ni);
      }
    });
    if (selected.size > 0) {
      setMultiSelMap({ [mid]: selected });
      setSelMid(mid);
    }
    setLassoState(null);
    setLassoMap({});
  }

  // ── Drag-to-move commit ────────────────────────────────────────────────────
  function handleDragCommit(mid: number, ni: number, deltaSlot: number, deltaRow: number) {
    const notes = localNotes[mid] ?? [];
    // If the dragged note is part of a multi-select, move all selected notes
    // by the same delta; otherwise move only the single dragged note.
    const toMove = (multiSelMap[mid]?.has(ni) && (multiSelMap[mid]?.size ?? 0) > 1)
      ? multiSelMap[mid]!
      : new Set([ni]);
    const updated = notes.map((note, idx) => {
      if (!toMove.has(idx)) return note;
      const dur    = note.notation_duration ?? note.duration;
      const durSl  = DURATION_SLOTS[dur] ?? 4;
      const origSlot = note.notation_position ?? note.position;
      const newSlot  = Math.max(0, Math.min(totalSlots - durSl, origSlot + deltaSlot));
      if (note.is_rest) {
        // Rests have no pitch row — only move horizontally
        return { ...note, notation_position: newSlot, position: newSlot };
      }
      const origDi   = pitchToDRow(note.pitch);
      const newDi    = Math.max(0, Math.min(D_TOTAL - 1, origDi + deltaRow));
      const newPitch = D_ROWS[newDi]?.pitch ?? note.pitch;
      return { ...note, notation_position: newSlot, position: newSlot, pitch: newPitch };
    });
    changeNotes(mid, updated);
  }

  async function handleTimeSigChange(ts: string) {
    setTimeSig(ts);
    try {
      const updated = await apiFetch<Chart>(
        `/api/charts/${chart.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ time_sig: ts }),
        }
      );
      onSaved(updated);
    } catch {
      // non-fatal — local state already reflects the change
    }
  }

  async function saveMeasure(mid: number) {
    setSaving((p) => ({ ...p, [mid]: true }));
    setMessage(null);
    try {
      const notes = localNotes[mid] ?? [];
      const updated = await apiFetch<Chart>(
        `/api/charts/${chart.id}/measures/${mid}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes: notes.map((n) => ({
              position: n.notation_position ?? n.position,
              pitch: n.pitch,
              duration: n.notation_duration ?? n.duration,
              is_rest: n.is_rest,
              stem_direction: n.stem_direction ?? null,
            })),
          }),
        }
      );
      const saved = updated.measures.find((m) => m.id === mid);
      // replace: update present without pushing to undo stack
      // (server-assigned IDs shouldn't create an undo entry)
      if (saved) history.replace((p) => ({ ...p, [mid]: saved.notes }));
      setDirty((p) => ({ ...p, [mid]: false }));
      setMessage({ type: "ok", text: "Saved." });
      onSaved(updated);
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving((p) => ({ ...p, [mid]: false }));
    }
  }

  async function saveAll() {
    const dirtyIds = Object.entries(dirty).filter(([, v]) => v).map(([k]) => Number(k));
    for (const mid of dirtyIds) await saveMeasure(mid);
  }

  // Group chart measures into system rows
  const systems: ChartMeasure[][] = [];
  for (let i = 0; i < chart.measures.length; i += M_PER_ROW) {
    systems.push(chart.measures.slice(i, i + M_PER_ROW));
  }

  const anyDirty = Object.values(dirty).some(Boolean);
  const selNote  = selMid != null && selNi != null
    ? (localNotes[selMid] ?? [])[selNi] : null;

  return (
    <div>
      {/* ── Settings panel ─────────────────────────────────────── */}
      <ScoreSettings settings={settings} onChange={setSettings} />

      {/* ── Note input toolbar ─────────────────────────────────── */}
      <NoteEditorToolbar
        tool={tool}
        onToolChange={setTool}
        timeSig={timeSig}
        onTimeSigChange={(ts) => { void handleTimeSigChange(ts); }}
        clef={clef}
        onClefChange={setClef}
      />

      {/* ── Status / save row ──────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10,
                    margin: "6px 0", minHeight: 24 }}>
        {message && (
          <span style={{ fontSize: 12, color: message.type === "ok" ? "#16a34a" : "#dc2626" }}>
            {message.text}
          </span>
        )}
        {multiSelCount > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 600,
            color: "#7c3aed", background: "#ede9fe",
            padding: "2px 8px", borderRadius: 10,
          }}>
            {multiSelCount} note{multiSelCount !== 1 ? "s" : ""} selected
          </span>
        )}
        {/* ── Undo / Redo buttons ── */}
        <button
          type="button"
          title="Undo (Ctrl+Z)"
          disabled={!history.canUndo}
          onClick={() => {
            history.undo();
            setDirty(Object.fromEntries(chart.measures.map((m) => [m.id, true])));
          }}
          style={{
            padding: "3px 8px", borderRadius: 4, border: "1px solid #2a2d4a",
            background: history.canUndo ? "#20213a" : "transparent",
            color: history.canUndo ? "#a9b1d6" : "#3a3e5a",
            cursor: history.canUndo ? "pointer" : "not-allowed",
            fontSize: 12, fontWeight: 600, userSelect: "none",
          }}
        >
          ↩ Undo
        </button>
        <button
          type="button"
          title="Redo (Ctrl+Y)"
          disabled={!history.canRedo}
          onClick={() => {
            history.redo();
            setDirty(Object.fromEntries(chart.measures.map((m) => [m.id, true])));
          }}
          style={{
            padding: "3px 8px", borderRadius: 4, border: "1px solid #2a2d4a",
            background: history.canRedo ? "#20213a" : "transparent",
            color: history.canRedo ? "#a9b1d6" : "#3a3e5a",
            cursor: history.canRedo ? "pointer" : "not-allowed",
            fontSize: 12, fontWeight: 600, userSelect: "none",
          }}
        >
          ↪ Redo
        </button>
        <span style={{ flex: 1 }} />
        {multiSelCount > 0 && (
          <button type="button"
            onClick={() => { setMultiSelMap({}); setSelMid(null); setSelNi(null); }}
            style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid #c4b5fd",
                     background: "transparent", color: "#7c3aed", fontSize: 11, cursor: "pointer" }}>
            Deselect all
          </button>
        )}
        {(multiSelCount > 0 || (selNote && !selNote.is_rest)) && (
          <>
            <button type="button" onClick={() => flipStem("up")}
              title="Force stems up"
              style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid #38bdf8",
                       background: "transparent", color: "#0ea5e9", fontSize: 11, cursor: "pointer" }}>
              ↑ Stem Up
            </button>
            <button type="button" onClick={() => flipStem("down")}
              title="Force stems down"
              style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid #38bdf8",
                       background: "transparent", color: "#0ea5e9", fontSize: 11, cursor: "pointer" }}>
              ↓ Stem Down
            </button>
          </>
        )}
        {multiSelCount > 0 && (
          <button type="button" onClick={deleteSelected}
            style={{ padding: "3px 10px", borderRadius: 4, border: "none",
                     background: "#ef4444", color: "white", fontSize: 11,
                     fontWeight: 600, cursor: "pointer" }}>
            Delete selected
          </button>
        )}
        {anyDirty && (
          <button type="button" onClick={() => { void saveAll(); }}
            style={{ padding: "4px 14px", borderRadius: 5, border: "none",
                     background: "#4a6cf7", color: "white", fontWeight: 700,
                     fontSize: 12, cursor: "pointer" }}>
            Save changes
          </button>
        )}
      </div>

      {/* ── Selected note editor ───────────────────────────────── */}
      {selNote && (
        <SelectedNotePanel
          note={selNote}
          onEdit={(changes) => {
            const notes = localNotes[selMid!] ?? [];
            changeNotes(selMid!, notes.map((n, i) => i === selNi ? { ...n, ...changes } : n));
          }}
          onDelete={() => {
            changeNotes(selMid!, (localNotes[selMid!] ?? []).filter((_, i) => i !== selNi));
            setSelMid(null); setSelNi(null);
          }}
          onClose={() => { setSelMid(null); setSelNi(null); }}
        />
      )}

      <p style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 8px" }}>
        {tool.selectMode
          ? "Select mode: click to select · drag a note to move it (pitch + position) · drag empty area to lasso · Delete removes · Ctrl+A selects all in measure"
          : "Note mode: click staff to place · click note to select · click again or double-click to delete · right-click for options"}
      </p>

      {/* ── Score viewport ─────────────────────────────────────── */}
      <div style={{ overflowX: "auto" }}>
        <div style={{
          zoom: settings.scoreZoom,
          background: "white",
          borderRadius: 6,
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          padding: "24px 20px 16px",
          display: "inline-block",
          minWidth: "100%",
        }}>
          {systems.map((group, si) => (
            <div key={`sys-${si}`} style={{ marginBottom: SVG_H * 0.6 }}>
              <ScoreSystem
                measures={group.map((m) => ({
                  measure: m,
                  notes:   localNotes[m.id] ?? m.notes,
                  dirty:   dirty[m.id]  ?? false,
                  saving:  saving[m.id] ?? false,
                }))}
                tool={tool}
                totalSlots={totalSlots}
                isFirst={si === 0}
                timeSig={timeSig}
                clef={clef}
                measureW={measureW}
                hoverZoom={settings.hoverZoom}
                selMeasure={selMid}
                selNote={selNi}
                multiSelMap={multiSelMap}
                lassoMap={lassoMap}
                hover={hover}
                onHover={setHover}
                onNoteClick={handleNoteClick}
                onNoteDouble={handleNoteDouble}
                onNoteCtxMenu={handleNoteCtxMenu}
                onBgCtxMenu={handleBgCtxMenu}
                onPlace={handlePlace}
                onSave={(mid) => { void saveMeasure(mid); }}
                onLassoStart={handleLassoStart}
                onLassoMove={handleLassoMove}
                onLassoEnd={handleLassoEnd}
                onDragCommit={handleDragCommit}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Context menu ───────────────────────────────────────── */}
      {ctxMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()} // prevent outside-click handler from firing
          style={{
            position: "fixed",
            top:      ctxMenu.y,
            left:     ctxMenu.x,
            zIndex:   9999,
            background:   "#1e2035",
            border:       "1px solid #2a2d4a",
            borderRadius: 6,
            boxShadow:    "0 4px 16px rgba(0,0,0,0.35)",
            minWidth:     160,
            overflow:     "hidden",
            fontSize:     12,
            color:        "#c0caf5",
          }}
        >
          {multiSelCount > 0 && (
            <div style={{ padding: "5px 12px 4px", fontSize: 10, color: "#565f89",
                          borderBottom: "1px solid #2a2d4a", fontWeight: 700,
                          letterSpacing: "0.08em", textTransform: "uppercase" }}>
              {multiSelCount} note{multiSelCount !== 1 ? "s" : ""} selected
            </div>
          )}
          <button
            type="button"
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "8px 14px", background: "none", border: "none",
              color: "#7dd3fc", cursor: "pointer", fontSize: 12,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#1a2a3a")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            onClick={() => { flipStem("up"); setCtxMenu(null); }}
          >
            ↑ Stem Up
          </button>
          <button
            type="button"
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "8px 14px", background: "none", border: "none",
              color: "#7dd3fc", cursor: "pointer", fontSize: 12,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#1a2a3a")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            onClick={() => { flipStem("down"); setCtxMenu(null); }}
          >
            ↓ Stem Down
          </button>
          <div style={{ borderTop: "1px solid #2a2d4a", margin: "2px 0" }} />
          <button
            type="button"
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "8px 14px", background: "none", border: "none",
              color: "#f87171", cursor: "pointer", fontSize: 12, fontWeight: 600,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#2d1f2e")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            onClick={() => { deleteSelected(); setCtxMenu(null); }}
          >
            🗑 Delete selected note{multiSelCount !== 1 ? "s" : ""}
          </button>
          <button
            type="button"
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "8px 14px", background: "none", border: "none",
              color: "#c0caf5", cursor: "pointer", fontSize: 12,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#2a2d4a")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            onClick={() => { setMultiSelMap({}); setSelMid(null); setSelNi(null); setCtxMenu(null); }}
          >
            ✕ Deselect all
          </button>
        </div>
      )}
    </div>
  );
}
