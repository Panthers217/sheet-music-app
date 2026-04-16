"use client";

import React, { useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NoteDuration = "whole" | "half" | "quarter" | "eighth" | "16th";

export type Articulation =
  | ""
  | "staccato"
  | "accent"
  | "tenuto"
  | "fermata"
  | "staccatissimo";

export type Dynamic = "" | "pp" | "p" | "mp" | "mf" | "f" | "ff";

export interface ToolState {
  duration:     NoteDuration;
  isRest:       boolean;
  noteName:     string;       // "C" | "D" | "E" | "F" | "G" | "A" | "B"
  accidental:   string;       // "" | "#" | "b"
  octave:       number;       // 2–6
  articulation: Articulation; // notation mark placed on the note
  dynamic:      Dynamic;      // dynamic marking placed at note entry
}

export const DEFAULT_TOOL: ToolState = {
  duration:     "quarter",
  isRest:       false,
  noteName:     "C",
  accidental:   "",
  octave:       4,
  articulation: "",
  dynamic:      "",
};

export function buildPitch(tool: ToolState): string {
  return `${tool.noteName}${tool.accidental}${tool.octave}`;
}

interface Props {
  tool:           ToolState;
  onToolChange:   (t: ToolState) => void;
  timeSig:        string;
  onTimeSigChange: (ts: string) => void;
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

const ARTICULATIONS: { id: Articulation; title: string }[] = [
  { id: "staccato",      title: "Staccato"      },
  { id: "accent",        title: "Accent"        },
  { id: "tenuto",        title: "Tenuto"        },
  { id: "fermata",       title: "Fermata"       },
  { id: "staccatissimo", title: "Staccatissimo" },
];

const DYNAMICS: { id: Dynamic; label: string }[] = [
  { id: "pp", label: "pp" },
  { id: "p",  label: "p"  },
  { id: "mp", label: "mp" },
  { id: "mf", label: "mf" },
  { id: "f",  label: "f"  },
  { id: "ff", label: "ff" },
];

const TIME_SIGNATURES: { value: string; top: string; bot: string }[] = [
  { value: "2/4",  top: "2",  bot: "4" },
  { value: "3/4",  top: "3",  bot: "4" },
  { value: "4/4",  top: "4",  bot: "4" },
  { value: "6/8",  top: "6",  bot: "8" },
  { value: "9/8",  top: "9",  bot: "8" },
  { value: "12/8", top: "12", bot: "8" },
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

export default function NoteEditorToolbar({ tool, onToolChange, timeSig, onTimeSigChange }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    timeSig:      true,
    noteRest:     true,
    pitch:        true,
    articulation: false,
    dynamics:     false,
  });

  function toggle(id: string) {
    setOpen((p) => ({ ...p, [id]: !p[id] }));
  }

  const pitchDisabled = tool.isRest;
  const displayStr    = tool.isRest
    ? `rest · ${tool.duration}`
    : [
        buildPitch(tool),
        tool.duration,
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
        <div style={S.row}>
          {ARTICULATIONS.map((a) => (
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
        </div>
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
        <div style={S.row}>
          {DYNAMICS.map((dyn) => (
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
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 10, color: "#565f89" }}>
          Stored locally — backend persistence in a future milestone.
        </p>
      </Section>

    </div>
  );
}
