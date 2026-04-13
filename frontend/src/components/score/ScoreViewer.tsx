"use client";

import { useEffect, useRef, useState } from "react";
import type { OsmdHandle } from "./usePlayback";

type Props = {
  /** Full MusicXML string to render, or null to show nothing */
  musicXml: string | null;
  /** Optional height for the score container */
  height?: string;
  /**
   * Called after OSMD renders successfully with the OSMD instance.
   * Pass the instance to usePlayback / PlaybackControls for cursor sync.
   * Called with null when musicXml becomes null or the component unmounts.
   */
  onOsmdReady?: (osmd: OsmdHandle | null) => void;
};

/**
 * Renders MusicXML using OpenSheetMusicDisplay (OSMD).
 *
 * OSMD touches the DOM, so this component is client-only.
 * It dynamically imports OSMD on mount to avoid SSR issues.
 */
export default function ScoreViewer({ musicXml, height = "400px", onOsmdReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Keep a stable ref to the callback to avoid re-triggering the effect
  const onReadyRef = useRef(onOsmdReady);
  useEffect(() => { onReadyRef.current = onOsmdReady; }, [onOsmdReady]);

  useEffect(() => {
    if (!musicXml || !containerRef.current) {
      onReadyRef.current?.(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Dynamic import keeps OSMD out of the SSR bundle
    import("opensheetmusicdisplay").then(({ OpenSheetMusicDisplay }) => {
      if (cancelled || !containerRef.current) return;

      // Clear previous render
      containerRef.current.innerHTML = "";

      const osmd = new OpenSheetMusicDisplay(containerRef.current, {
        autoResize: true,
        backend: "svg",
        drawTitle: true,
      });

      osmd
        .load(musicXml)
        .then(() => {
          if (cancelled) return;
          osmd.render();

          // Enable cursor for playhead sync
          try {
            osmd.cursor.show();
            osmd.cursor.reset();
          } catch {
            // cursor may not be available on all OSMD builds
          }

          // Notify parent with the OSMD handle
          onReadyRef.current?.(osmd as unknown as OsmdHandle);

          setLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Render failed");
          setLoading(false);
        });
    });

    return () => {
      cancelled = true;
      onReadyRef.current?.(null);
    };
  }, [musicXml]);

  if (!musicXml) return null;

  return (
    <div style={{ position: "relative" }}>
      {loading && <p style={{ color: "#888", marginBottom: "0.5rem" }}>Rendering score…</p>}
      {error && (
        <p style={{ color: "red", marginBottom: "0.5rem" }}>Score render error: {error}</p>
      )}
      <div
        ref={containerRef}
        style={{ width: "100%", minHeight: height, border: "1px solid #e0e0e0", borderRadius: 4 }}
      />
    </div>
  );
}
