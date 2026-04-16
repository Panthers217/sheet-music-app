/**
 * Beaming utility — unit tests.
 *
 * Run with: npx jest src/lib/beaming.test.ts  (or vitest / your test runner)
 *
 * These cover the common-practice scenarios required by the implementation:
 *   • 4/4 beaming (half-measure groups)
 *   • 3/4 beaming (per-beat groups)
 *   • 2/4 beaming (whole-measure group)
 *   • 6/8 beaming (dotted-quarter compound groups)
 *   • Rests and non-beamable values always break a beam
 *   • Gap between beamable notes breaks a beam
 *   • Isolated beamable notes remain unbeamed (flagged)
 */

import { computeBeaming, getBeamWindows } from "./beaming";

// ─── Helper ──────────────────────────────────────────────────────────────────

type NoteIn = { position: number; duration: string; is_rest: boolean };

function note(position: number, duration: string, is_rest = false): NoteIn {
  return { position, duration, is_rest };
}

// ─── getBeamWindows ───────────────────────────────────────────────────────────

describe("getBeamWindows", () => {
  test("4/4 → two half-measure groups", () => {
    expect(getBeamWindows("4/4")).toEqual([[0, 8], [8, 16]]);
  });

  test("2/4 → single whole-measure group", () => {
    expect(getBeamWindows("2/4")).toEqual([[0, 8]]);
  });

  test("3/4 → three per-beat groups", () => {
    expect(getBeamWindows("3/4")).toEqual([[0, 4], [4, 8], [8, 12]]);
  });

  test("6/8 → two dotted-quarter groups", () => {
    expect(getBeamWindows("6/8")).toEqual([[0, 6], [6, 12]]);
  });

  test("9/8 → three dotted-quarter groups", () => {
    expect(getBeamWindows("9/8")).toEqual([[0, 6], [6, 12], [12, 18]]);
  });

  test("12/8 → four dotted-quarter groups", () => {
    expect(getBeamWindows("12/8")).toEqual([[0, 6], [6, 12], [12, 18], [18, 24]]);
  });
});

// ─── computeBeaming — 4/4 ────────────────────────────────────────────────────

describe("computeBeaming — 4/4", () => {
  test("two adjacent eighth notes → beamed", () => {
    const notes = [note(0, "eighth"), note(2, "eighth")];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("begin");
    expect(result[1]!.role).toBe("end");
    expect(result[0]!.groupId).toBe(result[1]!.groupId);
  });

  test("four adjacent sixteenth notes → beamed as one group", () => {
    const notes = [note(0, "16th"), note(1, "16th"), note(2, "16th"), note(3, "16th")];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("begin");
    expect(result[1]!.role).toBe("continue");
    expect(result[2]!.role).toBe("continue");
    expect(result[3]!.role).toBe("end");
    // All share the same groupId
    const gid = result[0]!.groupId;
    result.forEach((r) => expect(r.groupId).toBe(gid));
  });

  test("isolated eighth note → not beamed (flagged)", () => {
    const result = computeBeaming([note(0, "eighth")], "4/4");
    expect(result[0]!.role).toBe("none");
    expect(result[0]!.groupId).toBe(-1);
  });

  test("eighth + quarter + eighth → two isolated flagged notes", () => {
    const notes = [note(0, "eighth"), note(2, "quarter"), note(6, "eighth")];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("none");
    expect(result[1]!.role).toBe("none");
    expect(result[2]!.role).toBe("none");
  });

  test("two pairs separated by a quarter note → two separate groups", () => {
    const notes = [
      note(0, "eighth"),
      note(2, "eighth"),
      note(4, "quarter"),
      note(8, "eighth"),
      note(10, "eighth"),
    ];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("begin");
    expect(result[1]!.role).toBe("end");
    expect(result[2]!.role).toBe("none");
    expect(result[3]!.role).toBe("begin");
    expect(result[4]!.role).toBe("end");
    expect(result[0]!.groupId).not.toBe(result[3]!.groupId);
  });

  test("eighth notes that span the half-measure boundary → separate groups", () => {
    // Beam group 1: beats 1+2 (slots 0-7), group 2: beats 3+4 (slots 8-15)
    // E4@6 is end of first window, F4@8 is start of second — they must NOT beam together
    const notes = [note(6, "eighth"), note(8, "eighth")];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("none");
    expect(result[1]!.role).toBe("none");
  });

  test("gap between eighth notes → not beamed", () => {
    // E4 at 0, G4 at 4 — there is a 2-slot gap between them
    const notes = [note(0, "eighth"), note(4, "eighth")];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("none");
    expect(result[1]!.role).toBe("none");
  });

  test("rest inside a run → breaks the beam", () => {
    const notes = [
      note(0, "eighth"),
      note(2, "eighth", true), // rest
      note(4, "eighth"),
    ];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("none");
    expect(result[1]!.role).toBe("none");
    expect(result[2]!.role).toBe("none");
  });

  test("three adjacent eighth notes → begin, continue, end", () => {
    const notes = [note(0, "eighth"), note(2, "eighth"), note(4, "eighth")];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("begin");
    expect(result[1]!.role).toBe("continue");
    expect(result[2]!.role).toBe("end");
  });
});

// ─── computeBeaming — 3/4 ────────────────────────────────────────────────────

describe("computeBeaming — 3/4", () => {
  test("two eighth notes on beat 1 → beamed", () => {
    const notes = [note(0, "eighth"), note(2, "eighth")];
    expect(computeBeaming(notes, "3/4")[0]!.role).toBe("begin");
    expect(computeBeaming(notes, "3/4")[1]!.role).toBe("end");
  });

  test("eighths on different beats → separate groups (per-beat windows)", () => {
    // slots: beat1=[0,4), beat2=[4,8), beat3=[8,12)
    const notes = [note(2, "eighth"), note(4, "eighth")];
    const result = computeBeaming(notes, "3/4");
    // note at 2 is in [0,4), note at 4 is in [4,8) — different windows
    expect(result[0]!.role).toBe("none");
    expect(result[1]!.role).toBe("none");
  });
});

// ─── computeBeaming — 2/4 ────────────────────────────────────────────────────

describe("computeBeaming — 2/4", () => {
  test("two adjacent eighths anywhere in measure → beamed", () => {
    const notes = [note(4, "eighth"), note(6, "eighth")];
    const result = computeBeaming(notes, "2/4");
    expect(result[0]!.role).toBe("begin");
    expect(result[1]!.role).toBe("end");
  });
});

// ─── computeBeaming — 6/8 ────────────────────────────────────────────────────

describe("computeBeaming — 6/8", () => {
  test("three adjacent eighths in first dotted-quarter group → beamed", () => {
    const notes = [note(0, "eighth"), note(2, "eighth"), note(4, "eighth")];
    const result = computeBeaming(notes, "6/8");
    expect(result[0]!.role).toBe("begin");
    expect(result[1]!.role).toBe("continue");
    expect(result[2]!.role).toBe("end");
  });

  test("three adjacent eighths in second dotted-quarter group → beamed", () => {
    const notes = [note(6, "eighth"), note(8, "eighth"), note(10, "eighth")];
    const result = computeBeaming(notes, "6/8");
    expect(result[0]!.role).toBe("begin");
    expect(result[1]!.role).toBe("continue");
    expect(result[2]!.role).toBe("end");
  });

  test("eighth on beat 3 (slot 4) and beat 4 (slot 6) → separate groups (window boundary)", () => {
    // slot 4 is in [0,6), slot 6 is in [6,12) — different windows
    const notes = [note(4, "eighth"), note(6, "eighth")];
    const result = computeBeaming(notes, "6/8");
    expect(result[0]!.role).toBe("none");
    expect(result[1]!.role).toBe("none");
  });

  test("six adjacent eighths in full 6/8 measure → two groups of 3", () => {
    const notes = Array.from({ length: 6 }, (_, i) => note(i * 2, "eighth"));
    const result = computeBeaming(notes, "6/8");
    const roles = result.map((r) => r.role);
    expect(roles).toEqual(["begin", "continue", "end", "begin", "continue", "end"]);
    // The two groups have different groupIds
    expect(result[0]!.groupId).not.toBe(result[3]!.groupId);
  });
});

// ─── computeBeaming — dotted-eighth + 16th combinations ─────────────────────

describe("computeBeaming — dotted-eighth + 16th", () => {
  // In 4/4 a dotted-eighth (3 slots) + 16th (1 slot) = 4 slots = 1 beat — the most
  // common syncopated beaming pattern in common-practice notation.

  test("dotted-eighth then 16th → beamed together", () => {
    // slot 0 dotted-eighth (3 slots) + slot 3 16th (1 slot) = 4 slots total
    const notes = [note(0, "dotted-eighth"), note(3, "16th")];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("begin");
    expect(result[1]!.role).toBe("end");
    expect(result[0]!.groupId).toBe(result[1]!.groupId);
  });

  test("16th then dotted-eighth → beamed together", () => {
    // slot 0 16th (1 slot) + slot 1 dotted-eighth (3 slots)
    const notes = [note(0, "16th"), note(1, "dotted-eighth")];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("begin");
    expect(result[1]!.role).toBe("end");
    expect(result[0]!.groupId).toBe(result[1]!.groupId);
  });

  test("isolated dotted-eighth → not beamed", () => {
    const result = computeBeaming([note(0, "dotted-eighth")], "4/4");
    expect(result[0]!.role).toBe("none");
    expect(result[0]!.groupId).toBe(-1);
  });

  test("dotted-eighth + 16th + 16th + dotted-eighth → one group across 4/4 half-measure", () => {
    // All four notes are adjacent within window [0,8) — no gaps, so one beam group.
    // d8(0-2) + 16(3) + 16(4) + d8(5-7) = 8 slots = beats 1+2 of 4/4.
    const notes = [
      note(0, "dotted-eighth"),
      note(3, "16th"),
      note(4, "16th"),
      note(5, "dotted-eighth"),
    ];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("begin");
    expect(result[1]!.role).toBe("continue");
    expect(result[2]!.role).toBe("continue");
    expect(result[3]!.role).toBe("end");
    // All share the same groupId
    const gid = result[0]!.groupId;
    result.forEach((r) => expect(r.groupId).toBe(gid));
  });

  test("gap between dotted-eighth and 16th → not beamed", () => {
    // d8 at slot 0 ends at slot 3, but 16th placed at slot 4 (gap)
    const notes = [note(0, "dotted-eighth"), note(4, "16th")];
    const result = computeBeaming(notes, "4/4");
    expect(result[0]!.role).toBe("none");
    expect(result[1]!.role).toBe("none");
  });

  test("dotted-eighth + 16th in 6/8 dotted-quarter window → beamed", () => {
    // In 6/8, window [0,6): d8 (0-2) + 16 (3) = 4 slots, still within the window
    const notes = [note(0, "dotted-eighth"), note(3, "16th")];
    const result = computeBeaming(notes, "6/8");
    expect(result[0]!.role).toBe("begin");
    expect(result[1]!.role).toBe("end");
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("computeBeaming — edge cases", () => {
  test("empty measure → empty results", () => {
    expect(computeBeaming([], "4/4")).toEqual([]);
  });

  test("whole + half + quarter notes → all unbeamed", () => {
    const notes = [note(0, "whole"), note(0, "half"), note(0, "quarter")];
    const result = computeBeaming(notes, "4/4");
    result.forEach((r) => {
      expect(r.role).toBe("none");
      expect(r.groupId).toBe(-1);
    });
  });

  test("unsorted input still produces correct groups", () => {
    // Notes provided in reverse order
    const notes = [note(2, "eighth"), note(0, "eighth")];
    const result = computeBeaming(notes, "4/4");
    // Both should be beamed
    expect(result.some((r) => r.role === "begin")).toBe(true);
    expect(result.some((r) => r.role === "end")).toBe(true);
    expect(result[0]!.groupId).toBe(result[1]!.groupId);
  });
});
