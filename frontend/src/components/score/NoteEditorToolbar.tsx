"use client";

import React from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NoteDuration = "whole" | "half" | "quarter" | "eighth" | "16th";

export interface ToolState {
  duration: NoteDuration;
  isRest: boolean;
  noteName: string;    // "C" | "D" | "E" | "F" | "G" | "A" | "B"
  accidental: string;  // "" | "#" | "b"
  octave: number;      // 2–6
}

export const DEFAULT_TOOL: ToolState = {
  duration: "quarter",
  isRest: false,
  noteName: "C",
  accidental: "",
  octave: 4,
};

export function buildPitch(tool: ToolState): string {
  return `${tool.noteName}${tool.accidental}${tool.octave}`;
}

interface Props {
  tool: ToolState;
  onToolChange: (t: ToolState) => void;
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

    // ── Rests ────────────────────────────────────────────────────────────────
    case "whole-rest":
      // Thick rectangle hanging below a ledger line
      return (
        <svg width={s} height={s} viewBox="0 0 24 22" aria-hidden>
          <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1" />
          <rect x="6" y="12" width="12" height="6" fill="currentColor" />
        </svg>
      );

    case "half-rest":
      // Thick rectangle sitting on a ledger line
      return (
        <svg width={s} height={s} viewBox="0 0 24 22" aria-hidden>
          <line x1="3" y1="15" x2="21" y2="15" stroke="currentColor" strokeWidth="1" />
          <rect x="6" y="9" width="12" height="6" fill="currentColor" />
        </svg>
      );

    case "quarter-rest":
      return (
        <svg width={s} height={sh} viewBox="0 0 22 30" aria-hidden>
          {/* Classic zigzag quarter rest shape */}
          <path
            d="M14,2 L8,10 L14,14 L6,22 L11,27 L7,30"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );

    case "eighth-rest":
      return (
        <svg width={s} height={sh} viewBox="0 0 24 30" aria-hidden>
          <circle cx="14" cy="22" r="3" fill="currentColor" />
          <path
            d="M14,19 Q8,13 15,7"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
        </svg>
      );

    case "16th-rest":
      return (
        <svg width={s} height={sh} viewBox="0 0 24 30" aria-hidden>
          <circle cx="14" cy="24" r="2.5" fill="currentColor" />
          <path d="M14,21 Q8,16 15,11" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <circle cx="16" cy="15" r="2.5" fill="currentColor" />
          <path d="M16,12 Q10,7 17,2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
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
  { id: "whole", label: "Whole" },
  { id: "half", label: "Half" },
  { id: "quarter", label: "Quarter" },
  { id: "eighth", label: "Eighth" },
  { id: "16th", label: "Sixteenth" },
];

const NOTE_NAMES = ["C", "D", "E", "F", "G", "A", "B"];

const ACCIDENTALS = [
  { value: "", label: "♮", title: "Natural" },
  { value: "#", label: "♯", title: "Sharp" },
  { value: "b", label: "♭", title: "Flat" },
];

// ---------------------------------------------------------------------------
// Styles (inline, matching the project's dark aesthetic)
// ---------------------------------------------------------------------------

const S = {
  container: {
    background: "#1a1b2e",
    borderRadius: 8,
    padding: "10px 14px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#c0caf5",
    fontSize: 12,
    userSelect: "none" as const,
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
  },

  titleBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBottom: 6,
    borderBottom: "1px solid #2a2d4a",
  },

  titleText: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "#565f89",
  },

  activeTool: {
    fontSize: 11,
    fontWeight: 600,
    color: "#7aa2f7",
    marginLeft: "auto",
  },

  row: {
    display: "flex",
    gap: 4,
    alignItems: "center",
    flexWrap: "wrap" as const,
  },

  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#565f89",
    minWidth: 38,
  },

  divider: {
    width: 1,
    height: 34,
    background: "#2a2d4a",
    margin: "0 2px",
    flexShrink: 0,
  },

  noteBtn: (active: boolean) => ({
    width: 40,
    height: 44,
    borderRadius: 5,
    border: `1px solid ${active ? "#7aa2f7" : "#2a2d4a"}`,
    background: active ? "#3d59a1" : "#20213a",
    color: active ? "#e0e7ff" : "#a9b1d6",
    cursor: "pointer" as const,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.1s",
    padding: 0,
    flexShrink: 0,
  }),

  smallBtn: (active: boolean, disabled = false) => ({
    padding: "4px 7px",
    borderRadius: 4,
    border: `1px solid ${active ? "#7aa2f7" : "#2a2d4a"}`,
    background: active ? "#3d59a1" : "#20213a",
    color: active ? "#e0e7ff" : disabled ? "#3a3e5a" : "#a9b1d6",
    cursor: disabled ? "not-allowed" as const : "pointer" as const,
    fontSize: 13,
    fontWeight: active ? 700 : 400,
    lineHeight: "1.2",
    transition: "all 0.1s",
    flexShrink: 0,
    pointerEvents: disabled ? "none" as const : "auto" as const,
    opacity: disabled ? 0.4 : 1,
  }),
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NoteEditorToolbar({ tool, onToolChange }: Props) {
  const pitchDisabled = tool.isRest;
  const currentPitchStr = tool.isRest
    ? `rest (${tool.duration})`
    : `${buildPitch(tool)} ${tool.duration}`;

  return (
    <div style={S.container} role="toolbar" aria-label="Note editor toolbar">

      {/* ── Title bar ──────────────────────────────────────────────────── */}
      <div style={S.titleBar}>
        <span style={S.titleText}>Part Box</span>
        <div style={{ flex: 1, height: 1, background: "#2a2d4a" }} />
        <span style={S.activeTool}>{currentPitchStr}</span>
      </div>

      {/* ── Duration row — Notes + Rests ───────────────────────────────── */}
      <div style={S.row}>
        <span style={S.sectionLabel}>Notes</span>
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

        <div style={S.divider} />

        <span style={S.sectionLabel}>Rests</span>
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

      {/* ── Pitch selector ─────────────────────────────────────────────── */}
      <div style={S.row}>
        <span style={S.sectionLabel}>Pitch</span>

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

        <div style={S.divider} />

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

        <span style={S.sectionLabel}>Oct</span>
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
  );
}
