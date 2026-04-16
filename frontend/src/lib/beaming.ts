/**
 * Beaming utility.
 *
 * Determines which consecutive short notes within a measure should be
 * connected by beams, based on time-signature beat groupings.
 *
 * Supported time signatures with tailored beam windows:
 *   4/4  → two half-measure groups (beats 1+2 together, beats 3+4 together)
 *   3/4  → one window per quarter-note beat
 *   2/4  → one whole-measure window
 *   6/8  → two dotted-quarter windows (3 × eighth each)
 *   9/8  → three dotted-quarter windows
 *   12/8 → four dotted-quarter windows
 *   other → one window per beat (fallback)
 *
 * Notes that can be beamed: "eighth", "16th".
 * Rests, whole, half, and quarter notes always break a beam.
 *
 * A run of beamable notes is broken if:
 *   - a rest or non-beamable note falls between them
 *   - there is any gap (unused grid slots) between adjacent beamable notes
 *   - the notes span a window boundary
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type BeamRole = "begin" | "continue" | "end" | "none";

export interface BeamResult {
  /** Beam role for this note, or "none" if unbeamed (flag shown normally). */
  role: BeamRole;
  /** Stable numeric ID shared by all notes in the same beam group; −1 if unbeamed. */
  groupId: number;
}

// ─── Internal constants ───────────────────────────────────────────────────────

// dotted-eighth beams with an adjacent 16th (the classic 3+1 = one beat pattern)
const BEAMABLE = new Set(["eighth", "16th", "dotted-eighth"]);

/** 16th-note grid slots per duration value. */
const SLOTS: Record<string, number> = {
  whole: 16,
  half: 8,
  quarter: 4,
  eighth: 2,
  "16th": 1,
  // Dotted beamable values
  "dotted-eighth": 3,  // 3 × 16th slots — beams with a following/preceding 16th
};

// ─── Beat-window calculation ──────────────────────────────────────────────────

/**
 * Returns [start, end) half-open intervals (in 16th-note slots) that define
 * the rhythmic groups within which notes may be beamed together.
 *
 * @example
 *   getBeamWindows("4/4") // → [[0,8],[8,16]]
 *   getBeamWindows("6/8") // → [[0,6],[6,12]]
 */
export function getBeamWindows(timeSig: string): Array<[number, number]> {
  const parts = timeSig.split("/").map(Number);
  const n = isFinite(parts[0]!) ? parts[0]! : 4;
  const d = isFinite(parts[1]!) ? parts[1]! : 4;

  // Compound meters (denominator = 8 with numerator divisible by 3):
  // group in dotted-quarter spans (3 × eighth = 6 × 16th slots).
  if (d === 8 && n % 3 === 0) {
    const groupSlots = 6;
    const count = n / 3;
    return Array.from(
      { length: count },
      (_, i) => [i * groupSlots, (i + 1) * groupSlots] as [number, number],
    );
  }

  // 4/4: two half-measure groups
  if (n === 4 && d === 4) return [[0, 8], [8, 16]];

  // 2/4: single whole-measure group
  if (n === 2 && d === 4) return [[0, 8]];

  // 3/4: one window per beat
  if (n === 3 && d === 4) return [[0, 4], [4, 8], [8, 12]];

  // Fallback: one window per beat
  const beatSlots = Math.round(16 / d);
  return Array.from(
    { length: n },
    (_, i) => [i * beatSlots, (i + 1) * beatSlots] as [number, number],
  );
}

// ─── Core beaming function ────────────────────────────────────────────────────

/**
 * Computes beam roles for every note in a measure.
 *
 * @param notes    All notes/rests in the measure (any order — sorted internally).
 * @param timeSig  Time-signature string, e.g. "4/4", "6/8".
 * @returns        One `BeamResult` per note, in the **same order** as `notes`.
 *
 * @example
 * // Two adjacent eighth notes in 4/4 → beamed
 * const notes = [
 *   { position: 0, duration: "eighth", is_rest: false },
 *   { position: 2, duration: "eighth", is_rest: false },
 * ];
 * computeBeaming(notes, "4/4");
 * // → [{ role:"begin", groupId:0 }, { role:"end", groupId:0 }]
 */
export function computeBeaming(
  notes: ReadonlyArray<{ position: number; duration: string; is_rest: boolean }>,
  timeSig: string,
): BeamResult[] {
  const results: BeamResult[] = notes.map(() => ({ role: "none" as BeamRole, groupId: -1 }));

  if (notes.length === 0) return results;

  // Work on a position-sorted copy, preserving original indices.
  const sorted = notes
    .map((n, i) => ({ n, i }))
    .sort((a, b) => a.n.position - b.n.position);

  const windows = getBeamWindows(timeSig);
  let nextGroupId = 0;

  for (const [winStart, winEnd] of windows) {
    const inWindow = sorted.filter(
      ({ n }) => n.position >= winStart && n.position < winEnd,
    );

    let runIndices: number[] = [];
    let prevEnd = -1;

    for (const { n, i } of inWindow) {
      const durSlots = SLOTS[n.duration] ?? 4;

      if (n.is_rest || !BEAMABLE.has(n.duration)) {
        // Non-beamable element: flush any accumulated run, then reset.
        if (runIndices.length >= 2) {
          _flushRun(runIndices, results, nextGroupId++);
        }
        runIndices = [];
        prevEnd = n.position + durSlots;
        continue;
      }

      // Beamable note: break run on gap between this note and previous.
      if (runIndices.length > 0 && n.position !== prevEnd) {
        if (runIndices.length >= 2) {
          _flushRun(runIndices, results, nextGroupId++);
        }
        runIndices = [];
      }

      runIndices.push(i);
      prevEnd = n.position + durSlots;
    }

    // Flush remaining run at end of window.
    if (runIndices.length >= 2) {
      _flushRun(runIndices, results, nextGroupId++);
    }
  }

  return results;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _flushRun(
  indices: number[],
  results: BeamResult[],
  groupId: number,
): void {
  if (indices.length < 2) return;

  results[indices[0]!]!.role = "begin";
  results[indices[0]!]!.groupId = groupId;

  for (let k = 1; k < indices.length - 1; k++) {
    results[indices[k]!]!.role = "continue";
    results[indices[k]!]!.groupId = groupId;
  }

  results[indices[indices.length - 1]!]!.role = "end";
  results[indices[indices.length - 1]!]!.groupId = groupId;
}
