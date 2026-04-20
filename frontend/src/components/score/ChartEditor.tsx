"use client";

import { FormEvent, useState } from "react";

import { apiFetch } from "@/components/api";

export type ChartNote = {
  id: number;
  measure_id: number;
  position: number;
  pitch: string;
  duration: string;
  is_rest: boolean;
  velocity: number | null;
  /** Absolute playback time (seconds from track start). Present for MIDI charts; null for chord charts. */
  start_time_s: number | null;
  /** Absolute end time (seconds from track start). Present for MIDI charts; null for chord charts. */
  end_time_s: number | null;
  /** Quantized 16th-note grid position for score rendering. Falls back to position when null. */
  notation_position: number | null;
  /** Quantized symbolic duration for score rendering. Falls back to duration when null. */
  notation_duration: string | null;
  /** User-overridden stem direction. null / undefined = auto (computed from pitch). */
  stem_direction?: "up" | "down" | null;
  /** Articulation marking attached to the note (e.g. staccato, marcato, fermata). */
  articulation?: string | null;
  /** Dynamic marking attached to the note (e.g. "mf", "ff", "sfz"). */
  dynamic?: string | null;
  /** Notehead shape override (e.g. "slash", "x", "diamond", "diamond-open", "triangle", "square"). */
  notehead_type?: string | null;
  /** Tremolo slash count (0 = none, 1–4 = slashes). */
  tremolo?: number | null;
  /** True if this note should be tied (curved arc) to the next note of the same pitch. */
  tied_to_next?: boolean | null;
  /** Slur marker: "start" begins a slur, "end" closes it. */
  slur?: "start" | "end" | null;
  /** True if an arpeggio (chord roll) wavy line should be drawn left of this note. */
  arpeggio?: boolean | null;
  /** Octave transposition indicator above/below the staff. */
  ottava?: "8va" | "8vb" | "15ma" | "15mb" | null;
};

export type ChartMeasure = {
  id: number;
  measure_number: number;
  chord_symbol: string | null;
  time_sig_override: string | null;
  chord_confidence: number | null;
  chord_alternatives: [string, number][] | null;
  notes: ChartNote[];
  /** Start-repeat barline at the left edge of this measure. */
  repeat_start?: boolean | null;
  /** End-repeat barline at the right edge of this measure. */
  repeat_end?: boolean | null;
  /** Both end-repeat and start-repeat at the barline between this and the next measure. */
  repeat_both?: boolean | null;
  /** Segno anchor placed above beat 1 of this measure. */
  segno?: boolean | null;
  /** Coda anchor placed above beat 1 of this measure. */
  coda?: boolean | null;
  /** "Fine" label at the end barline of this measure. */
  fine?: boolean | null;
  /** Navigation direction text at the end barline (e.g. D.C., D.S., D.C. al Fine). */
  navigation?: "dc" | "ds" | "dc-al-fine" | "ds-al-coda" | "dc-al-coda" | null;
  /** Volta / numbered ending bracket above this measure. */
  volta?: "1" | "2" | "open" | null;
};

export type Chart = {
  id: number;
  title: string;
  tempo: number;
  key_sig: string;
  time_sig: string;
  status: string;
  measures: ChartMeasure[];
};

type Props = {
  chart: Chart;
  onSaved: (updated: Chart) => void;
};

// Thresholds for confidence colour coding
const CONF_HIGH = 0.45;
const CONF_MED  = 0.35;

function confidenceColor(conf: number | null): string {
  if (conf === null) return "transparent";
  if (conf >= CONF_HIGH) return "#22c55e"; // green
  if (conf >= CONF_MED)  return "#f59e0b"; // amber
  return "#ef4444";                         // red
}

function confidenceTip(measure: ChartMeasure): string {
  if (measure.chord_confidence === null) return "";
  const lines = [`Confidence: ${(measure.chord_confidence * 100).toFixed(1)}%`];
  if (measure.chord_alternatives && measure.chord_alternatives.length > 0) {
    lines.push(
      "Alternatives: " +
        measure.chord_alternatives
          .map(([c, s]) => `${c} (${(s * 100).toFixed(0)}%)`)
          .join(", ")
    );
  }
  return lines.join("\n");
}

/**
 * Simple form-based editor for a structured Chart entity.
 *
 * Allows editing:
 *   - title, tempo, key_sig, time_sig  (metadata PATCH)
 *   - chord symbol per measure          (measure PATCH)
 *
 * After each save the parent is notified via onSaved() so the
 * ScoreViewer can re-fetch MusicXML.
 */
export default function ChartEditor({ chart, onSaved }: Props) {
  const [title, setTitle] = useState(chart.title);
  const [tempo, setTempo] = useState(String(chart.tempo));
  const [keySig, setKeySig] = useState(chart.key_sig);
  const [timeSig, setTimeSig] = useState(chart.time_sig);
  const [chords, setChords] = useState<Record<number, string>>(
    Object.fromEntries(chart.measures.map((m) => [m.id, m.chord_symbol ?? ""]))
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function saveMetadata(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const updated = await apiFetch<Chart>(`/api/charts/${chart.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || undefined,
          tempo: tempo ? Number(tempo) : undefined,
          key_sig: keySig || undefined,
          time_sig: timeSig || undefined,
        }),
      });
      onSaved(updated);
      setMessage({ type: "ok", text: "Saved." });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function saveMeasure(measureId: number) {
    setSaving(true);
    setMessage(null);
    try {
      const updated = await apiFetch<Chart>(`/api/charts/${chart.id}/measures/${measureId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chord_symbol: chords[measureId] ?? null }),
      });
      onSaved(updated);
      setMessage({ type: "ok", text: `Measure saved.` });
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {message && (
        <p style={{ color: message.type === "ok" ? "green" : "red", margin: "0.25rem 0 0.5rem" }}>
          {message.text}
        </p>
      )}

      <form onSubmit={saveMetadata} style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "flex-end" }}>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: 180 }} />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          Tempo (BPM)
          <input
            type="number"
            min={20}
            max={300}
            value={tempo}
            onChange={(e) => setTempo(e.target.value)}
            style={{ width: 80 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          Key
          <select value={keySig} onChange={(e) => setKeySig(e.target.value)} style={{ width: 80 }}>
            {["C", "G", "D", "A", "E", "B", "F#", "F", "Bb", "Eb", "Ab", "Db", "Gb"].map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", fontSize: "0.85rem" }}>
          Time sig
          <select value={timeSig} onChange={(e) => setTimeSig(e.target.value)} style={{ width: 80 }}>
            {["4/4", "3/4", "2/4", "6/8", "12/8"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save metadata"}
        </button>
      </form>

      {chart.measures.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <h4 style={{ marginBottom: "0.25rem" }}>Chord symbols by measure</h4>
          <p style={{ fontSize: "0.8rem", color: "#888", marginBottom: "0.5rem" }}>
            Confidence:{" "}
            <span style={{ color: "#22c55e" }}>■</span> high (&ge;45%){"  "}
            <span style={{ color: "#f59e0b" }}>■</span> medium (&ge;35%){"  "}
            <span style={{ color: "#ef4444" }}>■</span> low (&lt;35%)
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "0.5rem" }}>
            {chart.measures.map((measure) => {
              const conf = measure.chord_confidence;
              const color = confidenceColor(conf);
              const tip = confidenceTip(measure);
              return (
                <div
                  key={measure.id}
                  title={tip || undefined}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                    fontSize: "0.85rem",
                    borderLeft: `3px solid ${color}`,
                    paddingLeft: "0.4rem",
                  }}
                >
                  <label style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>m.{measure.measure_number}</span>
                    {conf !== null && (
                      <span style={{ color, fontVariantNumeric: "tabular-nums" }}>
                        {(conf * 100).toFixed(0)}%
                      </span>
                    )}
                  </label>
                  <div style={{ display: "flex", gap: "0.25rem" }}>
                    <input
                      value={chords[measure.id] ?? ""}
                      onChange={(e) =>
                        setChords((prev) => ({ ...prev, [measure.id]: e.target.value }))
                      }
                      placeholder="e.g. Am7"
                      style={{ width: "100%", minWidth: 0 }}
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => saveMeasure(measure.id)}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      ✓
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
