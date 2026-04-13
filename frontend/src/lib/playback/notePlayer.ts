/**
 * notePlayer.ts
 *
 * Pure playback logic — no React, no side-effects.
 *
 * Converts a Chart (from the API / ScoreModel) into a flat list of
 * PlayableNote objects, then schedules them on the Tone.js Transport.
 *
 * Timing strategy
 * ---------------
 * MIDI charts (Basic Pitch):   use start_time_s / end_time_s directly.
 * Chord charts (no timings):   derive seconds from measure_number + position
 *                               + chart.tempo + chart.time_sig.
 *
 * Architecture notes
 * ------------------
 * - Do NOT import Tone here; callers pass the Tone module in.
 * - Do NOT schedule per render; schedule once on play().
 * - Future TODOs: quantization, swing, multi-track, loop playback, instrument selection.
 */

import type { Chart, ChartNote } from "@/components/score/ChartEditor";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PlayableNote {
  pitch: string;
  startSec: number;     // seconds from playback start (transport offset)
  durationSec: number;  // note duration in seconds
  velocity: number;     // normalized 0..1
  isRest: boolean;
  measureIdx: number;   // 0-based measure index (for cursor sync)
}

// ---------------------------------------------------------------------------
// Duration tables (fallback grid computation only)
// ---------------------------------------------------------------------------

const DURATION_BEATS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  "16th": 0.25,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function secondsPerBeat(tempoBpm: number): number {
  return 60 / tempoBpm;
}

function beatsPerMeasure(timeSig: string): number {
  const [top] = timeSig.split("/");
  return parseInt(top, 10) || 4;
}

/**
 * Compute real note duration in seconds from symbolic duration name + tempo.
 * Used as fallback when end_time_s is unavailable.
 */
function symbolicDurationSec(duration: string, tempoBpm: number): number {
  const beats = DURATION_BEATS[duration] ?? 1;
  return beats * secondsPerBeat(tempoBpm);
}

/**
 * Returns true if at least one pitched note in the chart has a real
 * start_time_s value (i.e. this is a MIDI-derived chart).
 */
export function hasMidiTimings(chart: Chart): boolean {
  for (const measure of chart.measures) {
    for (const note of measure.notes ?? []) {
      if (!note.is_rest && note.start_time_s != null) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core: build PlayableNote list
// ---------------------------------------------------------------------------

/**
 * Build a sorted list of PlayableNote objects from a Chart.
 *
 * MIDI path (start_time_s present):
 *   startSec    = note.start_time_s
 *   durationSec = note.end_time_s - note.start_time_s  (clamped to ≥ 0.03 s)
 *
 * Grid path (no start_time_s):
 *   startSec    = (measureNumber-1) * secondsPerMeasure + position * secondsPer16th
 *   durationSec = symbolic duration beats * secondsPerBeat
 */
export function buildPlayableNotes(chart: Chart): PlayableNote[] {
  const spb = secondsPerBeat(chart.tempo);
  const bpm = beatsPerMeasure(chart.time_sig);
  const secondsPerMeasure = bpm * spb;
  const secondsPer16th = spb / 4;

  const notes: PlayableNote[] = [];

  for (const measure of chart.measures) {
    const measureIdx = measure.measure_number - 1; // 0-based

    for (const note of measure.notes ?? []) {
      let startSec: number;
      let durationSec: number;

      if (note.start_time_s != null) {
        // ── MIDI path ────────────────────────────────────────────────
        startSec = note.start_time_s;
        durationSec =
          note.end_time_s != null
            ? Math.max(0.03, note.end_time_s - note.start_time_s)
            : symbolicDurationSec(note.duration, chart.tempo);
      } else {
        // ── Grid path (chord chart) ──────────────────────────────────
        startSec = measureIdx * secondsPerMeasure + note.position * secondsPer16th;
        durationSec = symbolicDurationSec(note.duration, chart.tempo);
      }

      const velocity =
        note.velocity != null ? Math.max(0.05, Math.min(1, note.velocity / 127)) : 0.7;

      notes.push({
        pitch: note.pitch,
        startSec,
        durationSec,
        velocity,
        isRest: note.is_rest,
        measureIdx,
      });
    }
  }

  return notes.sort((a, b) => a.startSec - b.startSec);
}

// ---------------------------------------------------------------------------
// Measure-start times (for cursor sync)
// ---------------------------------------------------------------------------

/**
 * Returns an array where index `i` contains the startSec of the first
 * non-rest event in measure `i+1`, or the grid-computed fallback.
 *
 * Used by the RAF cursor loop to sync the OSMD cursor to Tone.Transport.
 */
export function buildMeasureStarts(chart: Chart, notes: PlayableNote[]): number[] {
  const spb = secondsPerBeat(chart.tempo);
  const bpm = beatsPerMeasure(chart.time_sig);
  const secondsPerMeasure = bpm * spb;

  const count = chart.measures.length;
  // Default: grid fallback
  const starts: number[] = chart.measures.map((m) => (m.measure_number - 1) * secondsPerMeasure);

  // Override with first-note timing if real timings are present
  for (const n of notes) {
    if (!n.isRest && starts[n.measureIdx] !== undefined) {
      // Only update if this is the earliest note we've seen for this measure
      if (n.startSec < starts[n.measureIdx] || starts[n.measureIdx] === (n.measureIdx * secondsPerMeasure)) {
        // Use the note's actual start time only if it's the first note of the measure
        // (notes are already sorted, so first match wins)
        starts[n.measureIdx] = n.startSec;
      }
    }
  }

  // Ensure strictly non-decreasing (safety guard)
  for (let i = 1; i < count; i++) {
    if (starts[i] < starts[i - 1]) {
      starts[i] = starts[i - 1];
    }
  }

  return starts;
}

/**
 * Given a flat sorted list of PlayableNote and a transport time,
 * return the 0-based index of the measure that should be active.
 */
export function activeMeasureAt(measureStarts: number[], seconds: number): number {
  let idx = 0;
  for (let i = measureStarts.length - 1; i >= 0; i--) {
    if (seconds >= measureStarts[i]) {
      idx = i;
      break;
    }
  }
  return idx;
}

// ---------------------------------------------------------------------------
// Tone.js schedule helper
// ---------------------------------------------------------------------------

/**
 * Schedule all non-rest notes onto Tone.Transport.
 *
 * @param Tone   — the Tone.js module (dynamically imported by the caller)
 * @param synth  — a PolySynth (or compatible) instance already connected
 * @param notes  — sorted list from buildPlayableNotes()
 */
export function scheduleNotes(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Tone: typeof import("tone"),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  synth: any,
  notes: PlayableNote[],
): void {
  const transport = Tone.getTransport();
  for (const note of notes) {
    if (note.isRest) continue;
    transport.schedule((time: number) => {
      try {
        synth.triggerAttackRelease(note.pitch, note.durationSec, time, note.velocity);
      } catch {
        // Out-of-range pitch or disposed synth — ignore gracefully
      }
    }, note.startSec);
  }
}
