"use client";

/**
 * ScoreSettings — collapsible settings panel for the score editor.
 *
 * Exposes three controls:
 *  1. Score zoom    — scales the entire score viewport (0.4 – 2.0)
 *  2. Measure width — multiplies the base measure content width (0.5 – 2.0)
 *  3. Focus zoom    — scale factor applied to a hovered / selected measure (1.0 – 1.5)
 */

import React, { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScoreSettingsValues {
  /** Overall viewport zoom.  1.0 = 100 %.  Applied as CSS zoom on the score container. */
  scoreZoom: number;
  /** Measure-width multiplier.  1.0 = default 176 px per measure. */
  measureZoom: number;
  /** CSS scale factor for the focused (hovered or selected) measure. */
  hoverZoom: number;
}

export const DEFAULT_SCORE_SETTINGS: ScoreSettingsValues = {
  scoreZoom:   1.0,
  measureZoom: 1.0,
  hoverZoom:   1.15,
};

// ─── Internal slider row ──────────────────────────────────────────────────────

interface SliderRowProps {
  label:      string;
  value:      number;
  min:        number;
  max:        number;
  step:       number;
  defaultVal: number;
  onChange:   (v: number) => void;
  format:     (v: number) => string;
}

function SliderRow({ label, value, min, max, step, defaultVal, onChange, format }: SliderRowProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {/* Label */}
      <span style={{ width: 120, flexShrink: 0, fontSize: 12, color: "#374151", fontWeight: 500 }}>
        {label}
      </span>

      {/* Range input */}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1, accentColor: "#4a6cf7", cursor: "pointer", minWidth: 100 }}
      />

      {/* Current value */}
      <span style={{
        width: 44, textAlign: "right", flexShrink: 0,
        fontSize: 12, fontFamily: "monospace", color: "#475569",
      }}>
        {format(value)}
      </span>

      {/* Reset to default */}
      <button
        type="button"
        onClick={() => onChange(defaultVal)}
        title="Reset to default"
        style={{
          flexShrink: 0,
          fontSize: 10, padding: "2px 7px", borderRadius: 4,
          border: "1px solid #d1d5db", background: "#f9fafb",
          color: "#6b7280", cursor: "pointer", lineHeight: 1.5,
        }}
      >
        ↺
      </button>
    </div>
  );
}

// ─── ScoreSettings (export) ───────────────────────────────────────────────────

interface Props {
  settings: ScoreSettingsValues;
  onChange: (s: ScoreSettingsValues) => void;
}

export default function ScoreSettings({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false);

  function set(key: keyof ScoreSettingsValues, value: number) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div style={{
      border: "1px solid #e5e7eb",
      borderRadius: 6,
      marginBottom: 8,
      overflow: "hidden",
      background: "white",
    }}>
      {/* Toggle header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "7px 12px", background: "#f8fafc",
          border: "none", cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>⚙ Score Settings</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "#94a3b8" }}>{open ? "▲ Hide" : "▼ Show"}</span>
      </button>

      {/* Panel body */}
      {open && (
        <div style={{
          padding: "12px 16px 14px",
          display: "flex", flexDirection: "column", gap: 12,
          borderTop: "1px solid #e5e7eb",
        }}>
          {/* ── Section: Score ───────────────────────────────────── */}
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: "#94a3b8",
                      textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Score
          </p>

          <SliderRow
            label="Score zoom"
            value={settings.scoreZoom}
            min={0.4} max={2.0} step={0.05}
            defaultVal={DEFAULT_SCORE_SETTINGS.scoreZoom}
            onChange={(v) => set("scoreZoom", v)}
            format={(v) => `${Math.round(v * 100)}%`}
          />

          {/* ── Section: Measures ────────────────────────────────── */}
          <p style={{ margin: "4px 0 0", fontSize: 11, fontWeight: 700, color: "#94a3b8",
                      textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Measures
          </p>

          <SliderRow
            label="Measure width"
            value={settings.measureZoom}
            min={0.5} max={2.0} step={0.05}
            defaultVal={DEFAULT_SCORE_SETTINGS.measureZoom}
            onChange={(v) => set("measureZoom", v)}
            format={(v) => `${Math.round(v * 100)}%`}
          />

          <SliderRow
            label="Focus zoom"
            value={settings.hoverZoom}
            min={1.0} max={1.5} step={0.01}
            defaultVal={DEFAULT_SCORE_SETTINGS.hoverZoom}
            onChange={(v) => set("hoverZoom", v)}
            format={(v) => `+${Math.round((v - 1) * 100)}%`}
          />

          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#94a3b8" }}>
            Focus zoom applies when the mouse hovers a measure or a note in it is selected.
          </p>

          {/* ── Reset all ─────────────────────────────────────────── */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
            <button
              type="button"
              onClick={() => onChange(DEFAULT_SCORE_SETTINGS)}
              style={{
                fontSize: 11, padding: "4px 12px", borderRadius: 4,
                border: "1px solid #d1d5db", background: "#f9fafb",
                color: "#374151", cursor: "pointer",
              }}
            >
              Reset all defaults
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
