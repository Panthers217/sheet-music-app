"use client";

import { FormEvent, useState } from "react";

import { apiFetch } from "@/components/api";

export type ChartMeasure = {
  id: number;
  measure_number: number;
  chord_symbol: string | null;
  time_sig_override: string | null;
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
          <h4 style={{ marginBottom: "0.5rem" }}>Chord symbols by measure</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: "0.5rem" }}>
            {chart.measures.map((measure) => (
              <div
                key={measure.id}
                style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.85rem" }}
              >
                <label>m.{measure.measure_number}</label>
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
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
