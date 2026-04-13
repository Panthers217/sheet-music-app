"use client";

/**
 * usePlayback — Tone.js playback hook
 *
 * Drives note-level audio playback synced to an OSMD cursor.
 *
 * Architecture:
 *   Chart (measures + notes) → PlayableNote[] via notePlayer
 *   → Tone.Transport.schedule() → RAF loop → cursor.next()
 *
 * Timing mode is selected automatically:
 *   MIDI charts  → start_time_s / end_time_s from Basic Pitch (precise)
 *   Chord charts → computed from measure position + tempo (grid fallback)
 *
 * Future TODOs:
 *   - swing / triplet quantization
 *   - multi-part merging
 *   - velocity dynamics refinement
 *   - loop playback
 *   - note highlighting in OSMD
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Chart } from "./ChartEditor";
import {
  activeMeasureAt,
  buildMeasureStarts,
  buildPlayableNotes,
  hasMidiTimings,
  scheduleNotes,
} from "@/lib/playback/notePlayer";

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
// Public types
// ---------------------------------------------------------------------------

export type PlaybackState = "stopped" | "started" | "paused";

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

  // Derive playable notes (memoised — only changes when chart content changes)
  const playableNotes = useMemo(
    () => (chart ? buildPlayableNotes(chart) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chart?.id, chart?.tempo, chart?.time_sig],
  );

  const measureStarts = useMemo(
    () => (chart ? buildMeasureStarts(chart, playableNotes) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chart?.id, chart?.tempo, chart?.time_sig, playableNotes],
  );

  // Expose timing mode so UI can show an indicator
  const usingMidiTimings = useMemo(
    () => (chart ? hasMidiTimings(chart) : false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chart?.id],
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
  const startCursorLoop = useCallback((starts: number[]) => {
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
        const targetMeasure = activeMeasureAt(starts, seconds);
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
  }, []);

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
      startCursorLoop(measureStarts);
      return;
    }

    // ---- Fresh start ----
    transport.cancel();
    transport.stop();

    // Set BPM — useful for grid-fallback mode; harmless for MIDI mode
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
    synth.set({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.01, decay: 0.1, sustain: 0.5, release: 0.3 },
    });
    synthRef.current = synth;

    // Schedule all non-rest notes via notePlayer helper
    scheduleNotes(Tone, synth, playableNotes);

    transport.start();
    setState("started");
    startCursorLoop(measureStarts);
  }, [chart, playableNotes, measureStarts, startCursorLoop]);

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

  return { play, pause, stop, state, usingMidiTimings };
}

