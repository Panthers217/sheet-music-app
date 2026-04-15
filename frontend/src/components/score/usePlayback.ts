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
 * Timing layers:
 *   MIDI charts  → start_time_s / end_time_s (performance timing, precise)
 *   Chord charts → computed from measure position + tempo (grid fallback)
 *   OSMD cursor  → advances by notation measure boundaries (notation timing)
 *
 * The measureStarts array bridges both layers: it maps each notation measure
 * index to the transport time when that measure starts, using real MIDI
 * timings when available or the grid fallback otherwise.
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
    /** The SVG/DOM element representing the cursor line — used for auto-scroll. */
    CursorElement?: HTMLElement | null;
  };
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PlaybackState = "stopped" | "started" | "paused";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePlayback(
  chart: Chart | null,
  osmd: OsmdHandle | null,
  /** When true, the score container scrolls to keep the playhead visible. */
  autoScroll = false,
) {
  const [state, setState] = useState<PlaybackState>("stopped");

  // Stable refs — never cause re-renders
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const synthRef = useRef<any>(null);
  const toneRef = useRef<typeof import("tone") | null>(null);
  const rafRef = useRef<number>(0);
  const osmdRef = useRef(osmd);
  const autoScrollRef = useRef(autoScroll);

  // Keep refs fresh without adding them to effect deps
  useEffect(() => { osmdRef.current = osmd; }, [osmd]);
  useEffect(() => { autoScrollRef.current = autoScroll; }, [autoScroll]);

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
        try { osmdRef.current?.cursor.reset(); } catch { /* ignore */ }
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

        // Auto-scroll: bring the cursor element into view if enabled
        if (autoScrollRef.current) {
          try {
            const el = cursor.CursorElement;
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          } catch {
            // scrollIntoView may not be available in all environments
          }
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
    // Reset cursor immediately (don't wait for next RAF tick)
    try {
      osmdRef.current?.cursor.reset();
    } catch {
      // ignore
    }
    setState("stopped");
  }, []);

  return { play, pause, stop, state, usingMidiTimings };
}

