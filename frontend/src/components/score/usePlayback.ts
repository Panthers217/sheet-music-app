"use client";

/**
 * usePlayback — Tone.js playback hook
 *
 * Drives note-level audio playback synced to an OSMD cursor.
 *
 * Architecture:
 *   Chart (measures + notes) → NoteEvent[] → Tone.Transport schedule
 *   Tone.Transport.seconds → RAF loop → cursor.next() until currentMeasure matches
 *
 * Timing is computed entirely on the frontend from:
 *   measure_number, note.position (16th-note grid offset),
 *   note.duration, chart.tempo, chart.time_sig
 *
 * Future TODOs:
 *   - swing / triplet quantization
 *   - multi-part merging
 *   - velocity dynamics
 *   - use server-side start_time_s when available for higher accuracy
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chart } from "./ChartEditor";

// ---------------------------------------------------------------------------
// OSMD handle — minimal interface that avoids importing opensheetmusicdisplay
// in this module (it accesses the DOM and would break SSR analysis).
// ---------------------------------------------------------------------------
export interface OsmdHandle {
  cursor: {
    show(): void;
    reset(): void;
    next(): void;
    Iterator: { CurrentMeasureIndex: number };
  };
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export type PlaybackState = "stopped" | "started" | "paused";

interface NoteEvent {
  pitch: string;
  startSeconds: number;
  toneDuration: string; // Tone.js format: "1n" | "2n" | "4n" | "8n" | "16n"
  normalizedVelocity: number; // 0..1
  isRest: boolean;
}

// ---------------------------------------------------------------------------
// Duration tables
// ---------------------------------------------------------------------------

const DURATION_BEATS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
};

const DURATION_TONE: Record<string, string> = {
  whole: "1n",
  half: "2n",
  quarter: "4n",
  eighth: "8n",
  "16th": "16n",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildNoteEvents(chart: Chart): NoteEvent[] {
  const [beatsStr] = chart.time_sig.split("/");
  const beatsPerMeasure = parseInt(beatsStr, 10) || 4;
  const secondsPerBeat = 60 / chart.tempo;
  const secondsPer16th = secondsPerBeat / 4;
  const secondsPerMeasure = beatsPerMeasure * secondsPerBeat;

  const events: NoteEvent[] = [];
  for (const measure of chart.measures) {
    const measureStart = (measure.measure_number - 1) * secondsPerMeasure;
    for (const note of measure.notes ?? []) {
      events.push({
        pitch: note.pitch,
        startSeconds: measureStart + note.position * secondsPer16th,
        toneDuration: DURATION_TONE[note.duration] ?? "4n",
        normalizedVelocity: note.velocity != null ? Math.max(0.05, note.velocity / 127) : 0.7,
        isRest: note.is_rest,
      });
    }
  }
  return events.sort((a, b) => a.startSeconds - b.startSeconds);
}

function buildMeasureStartTimes(chart: Chart): number[] {
  const [beatsStr] = chart.time_sig.split("/");
  const beatsPerMeasure = parseInt(beatsStr, 10) || 4;
  const secondsPerMeasure = (60 / chart.tempo) * beatsPerMeasure;
  // index i → measure_number i+1
  return chart.measures.map((m) => (m.measure_number - 1) * secondsPerMeasure);
}

function getCurrentMeasureIdx(seconds: number, starts: number[]): number {
  let idx = 0;
  for (let i = starts.length - 1; i >= 0; i--) {
    if (seconds >= starts[i]) {
      idx = i;
      break;
    }
  }
  return idx;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlayback(chart: Chart | null, osmd: OsmdHandle | null) {
  const [state, setState] = useState<PlaybackState>("stopped");

  // Stable refs — never cause re-renders
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const synthRef = useRef<any>(null);
  const toneRef = useRef<typeof import("tone") | null>(null);
  const rafRef = useRef<number>(0);
  const osmdRef = useRef(osmd);

  // Keep osmdRef fresh without adding it to effect deps
  useEffect(() => {
    osmdRef.current = osmd;
  }, [osmd]);

  const noteEvents = useMemo(
    () => (chart ? buildNoteEvents(chart) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chart?.id, chart?.tempo, chart?.time_sig],
  );

  const measureStartTimes = useMemo(
    () => (chart ? buildMeasureStartTimes(chart) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chart?.id, chart?.tempo, chart?.time_sig],
  );

  // ---- Cleanup on unmount or when chart changes -------------------------
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (toneRef.current) {
        const t = toneRef.current.getTransport();
        t.cancel();
        t.stop();
      }
      if (synthRef.current) {
        try {
          synthRef.current.releaseAll?.();
          synthRef.current.dispose();
        } catch {
          // ignore
        }
        synthRef.current = null;
      }
      setState("stopped");
    };
    // only run when chart id changes (not every render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart?.id]);

  // ---- Cursor RAF loop --------------------------------------------------
  const startCursorLoop = useCallback(
    (starts: number[]) => {
      const tick = () => {
        const Tone = toneRef.current;
        if (!Tone) return;

        const transport = Tone.getTransport();
        const transportState = transport.state;

        if (transportState === "stopped") {
          setState("stopped");
          osmdRef.current?.cursor.reset();
          return;
        }

        const seconds = transport.seconds;
        const cursor = osmdRef.current?.cursor;
        if (cursor) {
          const targetMeasure = getCurrentMeasureIdx(seconds, starts);
          try {
            let cur = cursor.Iterator.CurrentMeasureIndex;
            let safety = 0;
            while (cur < targetMeasure && safety < 200) {
              const prev = cur;
              cursor.next();
              cur = cursor.Iterator.CurrentMeasureIndex;
              if (cur === prev) break; // cursor didn't advance (end of score)
              safety++;
            }
          } catch {
            // OSMD cursor may throw at end of score — ignore
          }
        }

        if (transportState === "started") {
          rafRef.current = requestAnimationFrame(tick);
        }
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [],
  );

  // ---- play -------------------------------------------------------------
  const play = useCallback(async () => {
    // Lazy-load Tone.js (must not run during SSR)
    if (!toneRef.current) {
      toneRef.current = await import("tone");
    }
    const Tone = toneRef.current;

    // AudioContext must be resumed after a user gesture
    await Tone.start();

    const transport = Tone.getTransport();

    if (transport.state === "paused") {
      // Resume from current position — no rescheduling needed
      transport.start();
      setState("started");
      startCursorLoop(measureStartTimes);
      return;
    }

    // ---- Fresh start ----
    transport.cancel();
    transport.stop();

    // Set tempo
    if (chart) {
      transport.bpm.value = chart.tempo;
    }

    // Reset OSMD cursor
    try {
      osmdRef.current?.cursor.reset();
    } catch {
      // ignore
    }

    // Build / rebuild synth
    if (synthRef.current) {
      try {
        synthRef.current.releaseAll?.();
        synthRef.current.dispose();
      } catch {
        // ignore
      }
    }
    const synth = new Tone.PolySynth(Tone.Synth).toDestination();
    // Softer, shorter envelope for instrument-like sound
    synth.set({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3 },
    });
    synthRef.current = synth;

    // Schedule all non-rest notes
    for (const event of noteEvents) {
      if (!event.isRest) {
        // eslint-disable-next-line no-loop-func
        Tone.getTransport().schedule((time: number) => {
          try {
            synth.triggerAttackRelease(
              event.pitch,
              event.toneDuration,
              time,
              event.normalizedVelocity,
            );
          } catch {
            // ignore invalid pitches (e.g. percussion)
          }
        }, event.startSeconds);
      }
    }

    transport.start();
    setState("started");
    startCursorLoop(measureStartTimes);
  }, [chart, noteEvents, measureStartTimes, startCursorLoop]);

  // ---- pause ------------------------------------------------------------
  const pause = useCallback(async () => {
    if (!toneRef.current) return;
    cancelAnimationFrame(rafRef.current);
    toneRef.current.getTransport().pause();
    setState("paused");
  }, []);

  // ---- stop -------------------------------------------------------------
  const stop = useCallback(async () => {
    cancelAnimationFrame(rafRef.current);
    if (toneRef.current) {
      const transport = toneRef.current.getTransport();
      transport.cancel();
      transport.stop();
    }
    if (synthRef.current) {
      try {
        synthRef.current.releaseAll?.();
      } catch {
        // ignore
      }
    }
    try {
      osmdRef.current?.cursor.reset();
    } catch {
      // ignore
    }
    setState("stopped");
  }, []);

  return { play, pause, stop, state };
}
