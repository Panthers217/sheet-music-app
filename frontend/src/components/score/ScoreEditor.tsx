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

// Display range: A5 (2 above top line) → C4 (middle C) = 13 rows
const D_TOP   = "A5";
const D_BOT   = "C4";
const D_START = ALL_IDX[D_TOP] ?? 0;
const D_END   = ALL_IDX[D_BOT] ?? ALL_ROWS.length - 1;
const D_ROWS  = ALL_ROWS.slice(D_START, D_END + 1);
const D_TOTAL = D_ROWS.length;

const D_IDX: Record<string, number> = {};
D_ROWS.forEach((r, i) => { D_IDX[r.pitch] = i; });

const LINE_DIDXS = D_ROWS
  .map((r, i) => ({ r, i }))
  .filter(({ r }) => TREBLE_LINES.has(r.pitch))
  .map(({ i }) => i);                        // indices [2,4,6,8,10]

// ─── Fixed layout constants (staff geometry, not affected by zoom) ────────────

const ROW_H          = 14;    // px per pitch row
const MEASURE_W_BASE = 176;   // base measure content width — scaled by measureZoom
const CLEF_W1        = 86;    // clef panel width for first system (clef + time sig)
const CLEF_W2        = 42;    // clef panel width for other systems (clef only)
const M_PER_ROW      = 4;     // measures per system row
const STEM_LEN       = ROW_H * 3.5;

// Derived staff geometry (pixel Y centres of staff lines)
const LINE_YS   = LINE_DIDXS.map((i) => i * ROW_H + ROW_H / 2);
const STAFF_TOP = LINE_YS[0]  ?? 0;
const STAFF_BOT = LINE_YS[LINE_YS.length - 1] ?? ROW_H;
const SVG_H     = D_TOTAL * ROW_H;          // total SVG height

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

function accSign(pitch: string): "♯" | "♭" | "" {
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
const B4_DROW = D_IDX["B4"] ?? 6;
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
  beamed?: boolean; // when true, flags are suppressed (beam drawn by parent)
}

function NoteHead({ cx, cy, duration, isRest, selected, acc, dir, slots, slotW, beamed = false }: NHProps) {
  const isDotted = duration.startsWith("dotted-");
  const baseDur  = isDotted ? duration.slice(7) : duration; // "dotted-quarter" → "quarter"
  const rx     = ROW_H * 0.68;
  const ry     = ROW_H * 0.40;
  const filled = baseDur !== "whole" && baseDur !== "half";
  const stemUp = dir === "up";
  const stemX  = stemUp ? cx + rx - 1 : cx - rx + 1;
  const stemEnd = stemUp ? cy - STEM_LEN : cy + STEM_LEN;
  const s = selected ? SEL_BLUE : NOTE_BLACK;

  if (isRest) {
    const rw  = Math.min(slots * slotW - 6, 20);
    const ry0 = REST_LINE_Y;
    // Dot position for rests is anchored to the rest symbol, not the notehead cy.
    // whole-rest hangs below ry0 → dot sits on the right at the block's vertical midpoint
    // half-rest sits above ry0  → same logic, block midpoint
    // quarter/eighth/16th are drawn around cy → dot anchored to each symbol's rightmost point
    const dotR = ROW_H * 0.12;
    const dotEl = isDotted ? (() => {
      switch (baseDur) {
        case "whole":
          return <circle cx={cx + rw / 2 + 4} cy={ry0 + ROW_H * 0.25}  r={dotR} fill={s} style={{ pointerEvents: "none" }} />;
        case "half":
          return <circle cx={cx + rw / 2 + 4} cy={ry0 - ROW_H * 0.25}  r={dotR} fill={s} style={{ pointerEvents: "none" }} />;
        case "quarter":
          // zigzag spans cx ± ~3px; dot vertically centred at cy
          return <circle cx={cx + 8}            cy={cy}                  r={dotR} fill={s} style={{ pointerEvents: "none" }} />;
        case "eighth":
          // hook circle at cx+2, cy+2; dot in the space to its right, slightly above
          return <circle cx={cx + 9}            cy={cy - 3}              r={dotR} fill={s} style={{ pointerEvents: "none" }} />;
        case "16th":
          // two hook circles; dot between them horizontally, vertically at midpoint
          return <circle cx={cx + 10}           cy={cy - 4}              r={dotR} fill={s} style={{ pointerEvents: "none" }} />;
        default:
          return null;
      }
    })() : null;
    return (
      <g>
        {baseDur === "whole" && (
          <rect x={cx - rw / 2} y={ry0} width={rw} height={ROW_H * 0.5} fill={s} />
        )}
        {baseDur === "half" && (
          <rect x={cx - rw / 2} y={ry0 - ROW_H * 0.5} width={rw} height={ROW_H * 0.5} fill={s} />
        )}
        {baseDur === "quarter" && (
          <path d={`M${cx},${cy - ROW_H} l2,3 l-3,3 l3,3 l-2,3`}
            stroke={s} strokeWidth={1.8} fill="none" strokeLinecap="round" />
        )}
        {baseDur === "eighth" && (
          <>
            <circle cx={cx + 2} cy={cy + 2} r={2.2} fill={s} />
            <path d={`M${cx + 2},${cy} Q${cx - 3},${cy - 5} ${cx + 3},${cy - 11}`}
              stroke={s} strokeWidth={1.4} fill="none" strokeLinecap="round" />
          </>
        )}
        {baseDur === "16th" && (
          <>
            <circle cx={cx + 2} cy={cy + 2} r={2} fill={s} />
            <path d={`M${cx + 2},${cy} Q${cx - 2},${cy - 4} ${cx + 2},${cy - 9}`}
              stroke={s} strokeWidth={1.2} fill="none" strokeLinecap="round" />
            <circle cx={cx + 3} cy={cy - 6} r={2} fill={s} />
            <path d={`M${cx + 3},${cy - 8} Q${cx - 1},${cy - 12} ${cx + 3},${cy - 16}`}
              stroke={s} strokeWidth={1.2} fill="none" strokeLinecap="round" />
          </>
        )}
        {dotEl}
        {selected && (
          <rect x={cx - rw / 2 - 3} y={ry0 - 5} width={rw + 6} height={ROW_H + 6}
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
      {filled
        ? <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={s} />
        : <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="white" stroke={s} strokeWidth={1.7} />
      }
      {/* Augmentation dot: to the upper-right of the notehead */}
      {isDotted && (
        <circle cx={cx + rx + 5} cy={cy - ry * 0.35} r={ROW_H * 0.12}
          fill={s} style={{ pointerEvents: "none" }} />
      )}
      {selected && (
        <rect x={cx - rx - 3} y={cy - ry - 3} width={(rx + 3) * 2} height={(ry + 3) * 2}
          fill="none" stroke={SEL_BLUE} strokeWidth={1.5} rx={3} />
      )}
      {baseDur !== "whole" && (
        <line x1={stemX} y1={cy} x2={stemX} y2={stemEnd}
          stroke={NOTE_BLACK} strokeWidth={1.2} />
      )}
      {!beamed && baseDur === "eighth" && (
        <path
          d={stemUp
            ? `M${stemX},${stemEnd} C${stemX+9},${stemEnd+5} ${stemX+8},${stemEnd+12} ${stemX+1},${stemEnd+16}`
            : `M${stemX},${stemEnd} C${stemX+9},${stemEnd-5} ${stemX+8},${stemEnd-12} ${stemX+1},${stemEnd-16}`}
          stroke={NOTE_BLACK} strokeWidth={1.3} fill="none" />
      )}
      {!beamed && baseDur === "16th" && (
        <>
          <path
            d={stemUp
              ? `M${stemX},${stemEnd} C${stemX+8},${stemEnd+4} ${stemX+7},${stemEnd+10} ${stemX+1},${stemEnd+13}`
              : `M${stemX},${stemEnd} C${stemX+8},${stemEnd-4} ${stemX+7},${stemEnd-10} ${stemX+1},${stemEnd-13}`}
            stroke={NOTE_BLACK} strokeWidth={1.3} fill="none" />
          <path
            d={stemUp
              ? `M${stemX},${stemEnd+8} C${stemX+8},${stemEnd+12} ${stemX+7},${stemEnd+18} ${stemX+1},${stemEnd+21}`
              : `M${stemX},${stemEnd-8} C${stemX+8},${stemEnd-12} ${stemX+7},${stemEnd-18} ${stemX+1},${stemEnd-21}`}
            stroke={NOTE_BLACK} strokeWidth={1.3} fill="none" />
        </>
      )}
    </g>
  );
}

function GhostHead({ cx, cy }: { cx: number; cy: number }) {
  return (
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
      :                             (LINE_YS[2] ?? (STAFF_TOP + STAFF_BOT) / 2) + Math.round(0.40 * staffH); // ≈ 91 + 45 = 136
  const glyph  = CLEF_GLYPHS[clef];
  // Time sig: each digit centred in its staff half
  const halfH  = staffH / 2;
  const tsFz   = Math.round(halfH * 0.88);
  const tsX    = 67;  // centred in right portion of the 86px panel
  const tsTopY = STAFF_TOP + halfH * 0.5;
  const tsBotY = STAFF_TOP + halfH * 1.5;

  return (
    <svg width={clefW} height={SVG_H}
      overflow="visible"
      style={{ display: "block", flexShrink: 0, background: "white" }}>
      {/* Staff lines */}
      {LINE_YS.map((y, li) => (
        <line key={li} x1={0} y1={y} x2={clefW} y2={y}
          stroke="#000" strokeWidth={1.0} />
      ))}
      {/* Opening barline (right edge) */}
      <line x1={clefW - 0.5} y1={STAFF_TOP} x2={clefW - 0.5} y2={STAFF_BOT + ROW_H / 2}
        stroke="#000" strokeWidth={1.4} />
      {/* Clef glyph — Bravura SMuFL font, precisely sized to the staff */}
      <text x={2} y={clefBaselineY} fontSize={clef === "treble" ? staffH : clef === "bass" ? 100 : 90} fill="#1a1a1a"
        fontFamily="Bravura, serif"
        style={{ userSelect: "none", pointerEvents: "none" }}>
        {glyph}
      </text>
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

interface MeasurePanelProps {
  sm:            SysMeasure;
  tool:          ToolState;
  totalSlots:    number;
  measureW:      number;
  timeSig:       string;
  isFocused:     boolean;
  hoverZoom:     number;
  selMeasure:    number | null;
  selNote:       number | null;
  hoverSlot:     number | null;
  hoverRow:      number | null;
  onHoverChange: (slot: number | null, row: number | null) => void;
  onNoteClick:   (ni: number) => void;
  onPlace:       (slot: number, row: number) => void;
}

function MeasurePanel({
  sm, tool, totalSlots, measureW, timeSig, isFocused, hoverZoom,
  selMeasure, selNote, hoverSlot, hoverRow,
  onHoverChange, onNoteClick, onPlace,
}: MeasurePanelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const slotW  = measureW / totalSlots;
  const scale  = isFocused ? hoverZoom : 1;

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
    const dir   = note.is_rest ? "up" : noteStemDir(di);
    const rx    = ROW_H * 0.68;
    const stemX = dir === "up" ? cx + rx - 1 : cx - rx + 1;
    const stemEnd = dir === "up" ? cy - STEM_LEN : cy + STEM_LEN;
    return {
      note, ni, di, slot, dur, durSl, cx, cy,
      ac: accSign(note.pitch), leds: ledgerYs(di),
      sel: selMeasure === sm.measure.id && selNote === ni,
      dir, stemX, stemEnd,
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
    const c = getCell(e);
    if (!c) { onHoverChange(null, null); return; }
    // Snap hover ghost to duration grid so the full beat area previews correctly
    onHoverChange(snapSlot(c.slot, effectiveDur(tool)), c.row);
  }
  function onMouseLeave() { onHoverChange(null, null); }

  function onClick(e: React.MouseEvent<SVGSVGElement>) {
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
        style={{
          display: "block",
          background: "white",
          userSelect: "none",
          cursor: internalHover && !hoverOccupied && !hoverOverflows ? "crosshair"
                : hoverOccupied ? "pointer"
                : hoverOverflows ? "not-allowed"
                : "default",
        }}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onClick={onClick}
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
        {noteData.map(({ note, ni, cx, cy, dur, durSl, ac, leds, sel, dir }) => {
          const br     = beamResults[ni];
          const beamed = br ? br.role !== "none" : false;

          return (
            <g key={`n${note.id}-${ni}`} style={{ cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); onNoteClick(ni); }}>
              {leds.map((ly, li) => (
                <line key={li}
                  x1={cx - ROW_H * 1.1} y1={ly} x2={cx + ROW_H * 1.1} y2={ly}
                  stroke="#000" strokeWidth={1.0} style={{ pointerEvents: "none" }} />
              ))}
              <NoteHead cx={cx} cy={cy} duration={dur}
                isRest={note.is_rest} selected={sel}
                acc={ac} dir={dir} slots={durSl} slotW={slotW}
                beamed={beamed} />
            </g>
          );
        })}

        {/* ── Beams ─────────────────────────────────────────── */}
        {Array.from(beamGroupMap.entries()).map(([gid, group]) => {
          if (group.length < 2) return null;
          const dir    = group[0]!.dir;
          const sorted = [...group].sort((a, b) => a.slot - b.slot);
          const x1     = sorted[0]!.stemX;
          const x2     = sorted[sorted.length - 1]!.stemX;
          const avgEnd = sorted.reduce((s, n) => s + n.stemEnd, 0) / sorted.length;
          const beamH  = ROW_H * 0.38;
          // Centre primary beam rect on average stem-tip Y
          const beamY  = avgEnd - beamH / 2;
          const bx     = Math.min(x1, x2);
          const bw     = Math.max(1, Math.abs(x2 - x1));
          const gap2   = beamH + 2;
          const beam2Y = dir === "up" ? beamY + gap2 : beamY - gap2;
          // Stub width for isolated 16th notes (no 16th neighbour)
          const stubW  = ROW_H * 0.65;
          // Helper: strip "dotted-" prefix to get base duration
          const base   = (d: string) => d.startsWith("dotted-") ? d.slice(7) : d;
          const is16   = (d: string) => base(d) === "16th";

          // ── Secondary beam segments ──────────────────────────────────────
          // Rule 1: full segment between every consecutive 16th–16th pair.
          // Rule 2: stub on a 16th that has no 16th neighbour on either side
          //         (the classic dotted-eighth + 16th pattern).
          //         Stub extends toward its nearest neighbour.
          const secondarySegs: { x: number; w: number }[] = [];
          const hasLeft  = new Set<number>(); // sorted-index already has a secondary beam to its left
          const hasRight = new Set<number>(); // sorted-index already has a secondary beam to its right

          for (let k = 0; k < sorted.length - 1; k++) {
            const a = sorted[k]!;
            const b = sorted[k + 1]!;
            if (is16(a.dur) && is16(b.dur)) {
              const sx = Math.min(a.stemX, b.stemX);
              const sw = Math.abs(b.stemX - a.stemX);
              secondarySegs.push({ x: sx, w: sw });
              hasRight.add(k);
              hasLeft.add(k + 1);
            }
          }

          // Stubs for isolated 16ths (no full secondary on either side)
          for (let k = 0; k < sorted.length; k++) {
            const n = sorted[k]!;
            if (!is16(n.dur)) continue;
            if (hasLeft.has(k) || hasRight.has(k)) continue; // already connected
            // Draw stub toward the nearest neighbour
            if (k > 0) {
              // Stub going left (toward sorted[k-1])
              secondarySegs.push({ x: n.stemX - stubW, w: stubW });
            } else if (k < sorted.length - 1) {
              // Stub going right (toward sorted[k+1])
              secondarySegs.push({ x: n.stemX, w: stubW });
            }
          }

          return (
            <g key={`beam-${gid}`} style={{ pointerEvents: "none" }}>
              {/* Primary beam */}
              <rect x={bx} y={beamY} width={bw} height={beamH} fill={NOTE_BLACK} />
              {/* Secondary beam segments (full or stub) */}
              {secondarySegs.map((seg, si) => (
                <rect key={`b2-${si}`} x={seg.x} y={beam2Y} width={seg.w} height={beamH} fill={NOTE_BLACK} />
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
  measures:    SysMeasure[];
  tool:        ToolState;
  totalSlots:  number;
  isFirst:     boolean;
  timeSig:     string;
  clef?:       ClefType;
  measureW:    number;
  hoverZoom:   number;
  selMeasure:  number | null;
  selNote:     number | null;
  hover:       { mid: number; slot: number; row: number } | null;
  onHover:     (h: { mid: number; slot: number; row: number } | null) => void;
  onNoteClick: (mid: number, ni: number) => void;
  onPlace:     (mid: number, slot: number, row: number) => void;
  onSave:      (mid: number) => void;
}

function ScoreSystem({
  measures, tool, totalSlots, isFirst, timeSig, clef = "treble",
  measureW, hoverZoom, selMeasure, selNote,
  hover, onHover, onNoteClick, onPlace,
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
            hoverSlot={hover?.mid === sm.measure.id ? hover.slot : null}
            hoverRow={hover?.mid  === sm.measure.id ? hover.row  : null}
            onHoverChange={(slot, row) => {
              if (slot === null) onHover(null);
              else onHover({ mid: sm.measure.id, slot, row: row! });
            }}
            onNoteClick={(ni) => onNoteClick(sm.measure.id, ni)}
            onPlace={(slot, row) => onPlace(sm.measure.id, slot, row)}
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
      <button type="button" onClick={onDelete}
        style={{ padding: "3px 10px", borderRadius: 4, border: "none",
                 background: "#ef4444", color: "white", cursor: "pointer",
                 fontSize: 11, fontWeight: 600 }}>
        Delete
      </button>
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
  const [localNotes, setLocalNotes] = useState<Record<number, ChartNote[]>>(() =>
    Object.fromEntries(chart.measures.map((m) => [m.id, m.notes]))
  );
  const [dirty,   setDirty]   = useState<Record<number, boolean>>({});
  const [saving,  setSaving]  = useState<Record<number, boolean>>({});
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
      const [selMid,  setSelMid]  = useState<number | null>(null);
  const [selNi,   setSelNi]   = useState<number | null>(null);
  const [hover,   setHover]   = useState<{ mid: number; slot: number; row: number } | null>(null);
  const [clef,    setClef]    = useState<ClefType>("treble");

  // Effective measure content width — responds to measureZoom setting
  const measureW = Math.round(MEASURE_W_BASE * settings.measureZoom);

  useEffect(() => {
    setTimeSig(chart.time_sig);
    setLocalNotes(Object.fromEntries(chart.measures.map((m) => [m.id, m.notes])));
    setDirty({});
    setSelMid(null); setSelNi(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.id]);

  const changeNotes = useCallback((mid: number, notes: ChartNote[]) => {
    setLocalNotes((p) => ({ ...p, [mid]: notes }));
    setDirty((p) => ({ ...p, [mid]: true }));
  }, []);

  function handleNoteClick(mid: number, ni: number) {
    if (selMid === mid && selNi === ni) {
      changeNotes(mid, (localNotes[mid] ?? []).filter((_, i) => i !== ni));
      setSelMid(null); setSelNi(null);
    } else {
      setSelMid(mid); setSelNi(ni);
    }
  }

  function handlePlace(mid: number, slot: number, row: number) {
    const rowDef = D_ROWS[row];
    if (!rowDef) return;
    // Enforce measure capacity — reject if note would overflow
    const eff = effectiveDur(tool);
    if (wouldOverflow(slot, eff, totalSlots)) return;
    const pitch = tool.isRest ? rowDef.pitch : withAcc(rowDef.pitch, tool.accidental);
    const note: ChartNote = {
      id: -(Date.now()), measure_id: mid,
      position: slot, pitch, duration: eff,
      is_rest: tool.isRest, velocity: 80,
      start_time_s: null, end_time_s: null,
      notation_position: slot, notation_duration: eff,
    };
    // Remove any placeholder whole-measure rest before adding the new note
    const existing = (localNotes[mid] ?? []).filter((n) => !isPlaceholderRest(n, totalSlots));
    changeNotes(mid, [...existing, note]);
    setSelMid(null); setSelNi(null);
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
            })),
          }),
        }
      );
      const saved = updated.measures.find((m) => m.id === mid);
      if (saved) setLocalNotes((p) => ({ ...p, [mid]: saved.notes }));
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
        <span style={{ flex: 1 }} />
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
        Click a pitch row to place · click note to select · click again to delete
      </p>

      {/* ── Score viewport ─────────────────────────────────────── */}
      {/*
        CSS `zoom` scales the content and ALSO scales the layout box, so the
        outer scroll container correctly shows scrollbars when zoomed in,
        and the page does not have empty space when zoomed out.
      */}
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
                hover={hover}
                onHover={setHover}
                onNoteClick={handleNoteClick}
                onPlace={handlePlace}
                onSave={(mid) => { void saveMeasure(mid); }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
