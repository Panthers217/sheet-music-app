import { useCallback, useRef, useState } from "react";

/**
 * useHistory — generic undo/redo stack for any value.
 *
 * API:
 *   notes    — current present value
 *   set      — push a new value onto the stack (clears future)
 *   undo     — move back one step
 *   redo     — move forward one step
 *   replace  — silently update present without touching past/future
 *              (use after a successful server save)
 *   reset    — discard all history and start fresh with a new value
 *   canUndo  — whether undo is available
 *   canRedo  — whether redo is available
 */

const MAX_HISTORY = 50;

interface HistoryState<T> {
  past:    T[];
  present: T;
  future:  T[];
}

export function useHistory<T>(initial: T) {
  const [state, setState] = useState<HistoryState<T>>({
    past:    [],
    present: initial,
    future:  [],
  });

  // Stable ref so closures can read current state synchronously without
  // needing to be re-subscribed to state changes.
  const stateRef = useRef(state);
  stateRef.current = state;

  /** Push a new value; clears the redo stack. */
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((s) => {
      const nextVal =
        typeof next === "function" ? (next as (prev: T) => T)(s.present) : next;
      return {
        past:    [...s.past.slice(-(MAX_HISTORY - 1)), s.present],
        present: nextVal,
        future:  [],
      };
    });
  }, []);

  /** Move back one step in history. */
  const undo = useCallback(() => {
    setState((s) => {
      if (s.past.length === 0) return s;
      const prev = s.past[s.past.length - 1]!;
      return {
        past:    s.past.slice(0, -1),
        present: prev,
        future:  [s.present, ...s.future.slice(0, MAX_HISTORY - 1)],
      };
    });
  }, []);

  /** Move forward one step in history. */
  const redo = useCallback(() => {
    setState((s) => {
      if (s.future.length === 0) return s;
      const next = s.future[0]!;
      return {
        past:    [...s.past.slice(-(MAX_HISTORY - 1)), s.present],
        present: next,
        future:  s.future.slice(1),
      };
    });
  }, []);

  /**
   * Silently overwrite present without affecting past/future.
   * Use this to reflect server-side updates (e.g. after a successful save)
   * so the server-assigned IDs don't pollute the undo stack.
   */
  const replace = useCallback((next: T | ((prev: T) => T)) => {
    setState((s) => {
      const nextVal =
        typeof next === "function" ? (next as (prev: T) => T)(s.present) : next;
      return { ...s, present: nextVal };
    });
  }, []);

  /** Discard all history and start fresh. */
  const reset = useCallback((val: T) => {
    setState({ past: [], present: val, future: [] });
  }, []);

  return {
    notes:   state.present,
    set,
    undo,
    redo,
    replace,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
