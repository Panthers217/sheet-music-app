"use client";

/**
 * PlaybackControls — Play / Pause / Stop controls for a structured chart.
 *
 * Requires:
 *   - chart: Chart with measure notes populated
 *   - osmd: OsmdHandle from ScoreViewer's onOsmdReady callback
 *
 * The component is intentionally dumb — all logic lives in usePlayback.
 */

import { useState } from "react";
import type { Chart } from "./ChartEditor";
import { type OsmdHandle, usePlayback } from "./usePlayback";

type Props = {
  chart: Chart;
  osmd: OsmdHandle | null;
};

export default function PlaybackControls({ chart, osmd }: Props) {
  const [autoScroll, setAutoScroll] = useState(false);
  const { play, pause, stop, state, usingMidiTimings } = usePlayback(chart, osmd, autoScroll);

  const hasRealNotes = chart.measures.some((m) =>
    m.notes?.some((n) => !n.is_rest),
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        padding: "0.6rem 0",
        flexWrap: "wrap",
      }}
    >
      {/* Play */}
      <button
        type="button"
        disabled={state === "started"}
        onClick={() => void play()}
        style={buttonStyle(state === "started" ? "#bbb" : "#22c55e")}
        title="Play"
      >
        ▶ Play
      </button>

      {/* Pause */}
      <button
        type="button"
        disabled={state !== "started"}
        onClick={() => void pause()}
        style={buttonStyle(state !== "started" ? "#bbb" : "#f59e0b")}
        title="Pause"
      >
        ⏸ Pause
      </button>

      {/* Stop */}
      <button
        type="button"
        disabled={state === "stopped"}
        onClick={() => void stop()}
        style={buttonStyle(state === "stopped" ? "#bbb" : "#ef4444")}
        title="Stop"
      >
        ⏹ Stop
      </button>

      {/* Auto-scroll toggle */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.25rem",
          fontSize: "0.8rem",
          color: "#555",
          cursor: "pointer",
          marginLeft: "0.25rem",
          userSelect: "none",
        }}
        title="Scroll the score to follow the playhead"
      >
        <input
          type="checkbox"
          checked={autoScroll}
          onChange={(e) => setAutoScroll(e.target.checked)}
          style={{ cursor: "pointer" }}
        />
        Auto-scroll
      </label>

      {/* Status */}
      <span style={{ fontSize: "0.8rem", color: "#888", marginLeft: "0.25rem" }}>
        {state === "started" ? "Playing…" : state === "paused" ? "Paused" : "Stopped"}
      </span>

      {/* Info when no real notes */}
      {!hasRealNotes && (
        <span style={{ fontSize: "0.8rem", color: "#aaa", marginLeft: "0.5rem" }}>
          (chord chart — cursor only, no audio)
        </span>
      )}

      {/* Timing mode indicator */}
      {hasRealNotes && (
        <span style={{ fontSize: "0.75rem", color: usingMidiTimings ? "#22c55e" : "#888", marginLeft: "0.5rem" }}>
          {usingMidiTimings ? "MIDI timing" : "grid timing"}
        </span>
      )}
    </div>
  );
}

function buttonStyle(color: string): React.CSSProperties {
  return {
    background: color,
    color: "#fff",
    border: "none",
    borderRadius: 4,
    padding: "0.3rem 0.8rem",
    cursor: color === "#bbb" ? "default" : "pointer",
    fontSize: "0.85rem",
    fontWeight: 600,
  };
}
