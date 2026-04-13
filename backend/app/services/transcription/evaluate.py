"""
Chord-analysis evaluation tool.

Runs ChordChartEngine over a grid of (harmonic_stem × chroma_method)
combinations for a single audio file and produces a comparison report.

Usage (from repo root with venv active):

    python -m app.services.transcription.evaluate uploads/1/my_song.mp3

    # Restrict chroma methods:
    python -m app.services.transcription.evaluate uploads/1/my_song.mp3 --methods cqt stft

    # Restrict harmonic stems:
    python -m app.services.transcription.evaluate uploads/1/my_song.mp3 --stems mix other

    # Save a JSON report:
    python -m app.services.transcription.evaluate uploads/1/my_song.mp3 --json report.json

Outputs a table of results to stdout and, optionally, a JSON file.
Does not write to the database.
"""

from __future__ import annotations

import argparse
import json
import logging
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from app.services.transcription.chord_chart import (
    CHROMA_METHODS,
    ChordChartEngine,
    ChromaConfig,
)

logger = logging.getLogger(__name__)

# Default stems to test when none are specified
_DEFAULT_STEMS = ("preferred", "mix", "other")


# ---------------------------------------------------------------------------
# Result dataclass
# ---------------------------------------------------------------------------


@dataclass
class EvalRun:
    """Result of one (harmonic_stem, chroma_method) analysis run."""

    harmonic_stem: str
    chroma_method: str
    audio_source: str          # resolved source label (e.g. "stem:other", "mix")
    tempo_bpm: float
    measure_count: int
    duration_seconds: float    # wall-clock processing time
    chords: list[str]          # chord symbol per measure
    confidences: list[float]   # confidence per measure
    avg_confidence: float
    min_confidence: float
    # number of measures below the low-confidence threshold (< 0.35)
    low_confidence_count: int
    error: str | None = None   # set if the run raised an exception


@dataclass
class EvalReport:
    """Collection of runs over all setting combinations for one audio file."""

    audio_path: str
    runs: list[EvalRun] = field(default_factory=list)

    def best_run(self) -> EvalRun | None:
        """Return the run with the highest average confidence (excluding failed runs)."""
        valid = [r for r in self.runs if r.error is None]
        return max(valid, key=lambda r: r.avg_confidence) if valid else None


# ---------------------------------------------------------------------------
# Core evaluation function
# ---------------------------------------------------------------------------

_LOW_CONFIDENCE_THRESHOLD = 0.35


def evaluate(
    audio_path: Path,
    stems: tuple[str, ...] = _DEFAULT_STEMS,
    methods: tuple[str, ...] = CHROMA_METHODS,
) -> EvalReport:
    """
    Run ChordChartEngine for every (stem, method) combination and return
    an EvalReport with the results.

    Args:
        audio_path: Path to the audio file to analyse.
        stems:      Harmonic stem values to test.
        methods:    Chroma method values to test.
    """
    report = EvalReport(audio_path=str(audio_path))

    for stem in stems:
        for method in methods:
            config = ChromaConfig(method=method, harmonic_stem=stem)
            engine = ChordChartEngine(config)

            t0 = time.perf_counter()
            try:
                result = engine.analyze(audio_path, title=audio_path.stem)
                elapsed = time.perf_counter() - t0

                analyses = result.measure_analyses
                chords = [a.chord for a in analyses]
                confidences = [a.confidence for a in analyses]
                avg_conf = sum(confidences) / len(confidences) if confidences else 0.0
                min_conf = min(confidences) if confidences else 0.0
                low_count = sum(1 for c in confidences if c < _LOW_CONFIDENCE_THRESHOLD)

                run = EvalRun(
                    harmonic_stem=stem,
                    chroma_method=method,
                    audio_source=result.audio_source,
                    tempo_bpm=result.score.tempo,
                    measure_count=len(analyses),
                    duration_seconds=round(elapsed, 2),
                    chords=chords,
                    confidences=[round(c, 4) for c in confidences],
                    avg_confidence=round(avg_conf, 4),
                    min_confidence=round(min_conf, 4),
                    low_confidence_count=low_count,
                )
            except Exception as exc:
                elapsed = time.perf_counter() - t0
                logger.error("Run (%s, %s) failed: %s", stem, method, exc, exc_info=True)
                run = EvalRun(
                    harmonic_stem=stem,
                    chroma_method=method,
                    audio_source="unknown",
                    tempo_bpm=0,
                    measure_count=0,
                    duration_seconds=round(elapsed, 2),
                    chords=[],
                    confidences=[],
                    avg_confidence=0.0,
                    min_confidence=0.0,
                    low_confidence_count=0,
                    error=str(exc),
                )

            report.runs.append(run)
            _log_run(run)

    return report


# ---------------------------------------------------------------------------
# Formatting helpers
# ---------------------------------------------------------------------------


def _log_run(run: EvalRun) -> None:
    if run.error:
        logger.warning("  FAILED  %-12s %-6s — %s", run.harmonic_stem, run.chroma_method, run.error)
    else:
        logger.info(
            "  %-10s %-6s → source=%-12s tempo=%3d BPM  measures=%2d  "
            "avg_conf=%.3f  min_conf=%.3f  low=%d  t=%.2fs",
            run.harmonic_stem,
            run.chroma_method,
            run.audio_source,
            run.tempo_bpm,
            run.measure_count,
            run.avg_confidence,
            run.min_confidence,
            run.low_confidence_count,
            run.duration_seconds,
        )


def format_table(report: EvalReport) -> str:
    """Format report as a human-readable text table."""
    header = (
        f"Evaluation report for: {report.audio_path}\n"
        + "-" * 100 + "\n"
        + f"{'STEM':<12} {'METHOD':<6} {'SOURCE':<14} {'BPM':>5} {'MEAS':>5} "
          f"{'AVG_CONF':>9} {'MIN_CONF':>9} {'LOW':>4} {'TIME_S':>7}\n"
        + "-" * 100
    )
    rows = []
    for r in report.runs:
        if r.error:
            rows.append(f"{'ERROR':<12} {r.chroma_method:<6}  {r.error[:60]}")
        else:
            rows.append(
                f"{r.harmonic_stem:<12} {r.chroma_method:<6} {r.audio_source:<14} "
                f"{r.tempo_bpm:>5.0f} {r.measure_count:>5} "
                f"{r.avg_confidence:>9.4f} {r.min_confidence:>9.4f} "
                f"{r.low_confidence_count:>4} {r.duration_seconds:>7.2f}s"
            )

    best = report.best_run()
    footer = ""
    if best:
        footer = (
            "\n" + "-" * 100
            + f"\nBest run:  stem={best.harmonic_stem}  method={best.chroma_method}"
              f"  avg_confidence={best.avg_confidence:.4f}"
              f"  source={best.audio_source}"
            + f"\nChords:    {best.chords[:16]}{'…' if len(best.chords) > 16 else ''}"
        )

    return "\n".join([header] + rows + [footer])


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Compare chord-chart analysis runs across stem/chroma-method combinations."
    )
    p.add_argument("audio_path", type=Path, help="Path to an audio file (mp3, wav, etc.)")
    p.add_argument(
        "--stems",
        nargs="+",
        default=list(_DEFAULT_STEMS),
        metavar="STEM",
        help=f"Harmonic stem values to test (default: {list(_DEFAULT_STEMS)})",
    )
    p.add_argument(
        "--methods",
        nargs="+",
        default=list(CHROMA_METHODS),
        choices=list(CHROMA_METHODS),
        metavar="METHOD",
        help=f"Chroma methods to test (default: {list(CHROMA_METHODS)})",
    )
    p.add_argument(
        "--json",
        dest="json_path",
        type=Path,
        default=None,
        metavar="FILE",
        help="Write full JSON report to FILE",
    )
    p.add_argument("--verbose", "-v", action="store_true", help="Enable DEBUG logging")
    return p.parse_args()


def main() -> None:
    args = _parse_args()
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(message)s",
    )

    if not args.audio_path.exists():
        print(f"Error: file not found: {args.audio_path}")
        raise SystemExit(1)

    print(f"\nRunning evaluation on: {args.audio_path}")
    print(f"  stems:   {args.stems}")
    print(f"  methods: {args.methods}\n")

    report = evaluate(
        audio_path=args.audio_path,
        stems=tuple(args.stems),
        methods=tuple(args.methods),
    )

    print("\n" + format_table(report))

    if args.json_path:
        # Convert to JSON-serialisable dict
        data = asdict(report)
        args.json_path.write_text(json.dumps(data, indent=2))
        print(f"\nJSON report saved to: {args.json_path}")


if __name__ == "__main__":
    main()
