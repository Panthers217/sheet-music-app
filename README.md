# Sheet Music App

A music chart-generation web app built around a structured audio → stems → chart → MusicXML → render pipeline.

## Architecture overview

```
Audio upload
     │
     ▼
Demucs stem separation   (background task, CPU)
     │
     ▼
Transcription engine     (ChordChartEngine: beat tracking + chromagram chord detection)
     │
     ▼
Internal ScoreModel      (Python dataclasses — source of truth)
     │
     ▼
Chart DB entities        (Chart / ChartMeasure / ChartNote in SQLite)
     │
     ▼
MusicXML generator       (generates standard MusicXML 3.1 from ScoreModel)
     │
     ▼
OSMD frontend renderer   (OpenSheetMusicDisplay renders MusicXML in browser)
     │
     ▼
User edits               (form editor → PATCH endpoints → DB update → MusicXML regenerated)
```

### Key design rule
**MusicXML is the exchange/render format, not the source of truth.**
The source of truth is the `Chart` / `ChartMeasure` / `ChartNote` DB model.
MusicXML is always regenerated from that model on demand.

## What is implemented

- ✅ Project CRUD (create, list, edit, delete)
- ✅ Audio upload (MP3 / WAV)
- ✅ Demucs stem separation (background task, CPU, `htdemucs` model → drums / bass / vocals / other)
- ✅ Structured chart DB model (`Chart`, `ChartMeasure`, `ChartNote`, `Export`)
- ✅ Chord-chart transcription engine (librosa beat tracking + chroma-based chord detection)
- ✅ MusicXML 3.1 generator (time sig, key sig, clef, tempo, chord symbols, notes/rests)
- ✅ OSMD score preview in project page
- ✅ Form-based chart editor (title, tempo, key, time sig, chord symbols per measure)
- ✅ MusicXML auto-regenerated after edits
- ✅ Notation timing layer with configurable quantization (separate from playback timing)
- ✅ Playback/notation timing split: MIDI timing for audio, quantized notation for score rendering
- ✅ Playhead auto-scroll (opt-in checkbox in playback controls)

## Timing model: playback timing vs. notation timing

MIDI-derived charts carry two separate timing layers per note.  They serve
different purposes and must not be conflated.

### Performance timing (for audio playback)
Stored in `start_time_s` / `end_time_s` on each `ChartNote` / `ScoreNote`.
These are **raw values from Basic Pitch** — the exact seconds at which the
model detected each note in the audio.  Tone.js uses these directly when
scheduling notes, so playback sounds tight and accurate.

### Notation timing (for score rendering)
Stored in `notation_position` / `notation_duration` on each `ChartNote` /
`ScoreNote`.  These are **derived by `NotationQuantizer`** after MIDI parsing:

1. `notation_position` — the note's 16th-note grid slot within its measure,
   computed from `start_time_s`, the chart tempo, and the configured
   quantization grid ("16th" by default).
2. `notation_duration` — the nearest symbolic duration ("whole", "half",
   "quarter", "eighth", "16th"), **clamped** to fit within the remaining
   space in the measure.  This prevents MusicXML overflow errors.

When `notation_position` / `notation_duration` are `None` (chord-only charts
with no MIDI timing), the generator falls back to `position` / `duration`.

### Why they're separate
Raw MIDI onset times don't align neatly with a rhythmic grid.  A note played
on beat 2 might have `start_time_s = 1.487 s` instead of the grid-perfect
`1.500 s`.  Using raw times for notation would scatter noteheads across
non-standard positions in the MusicXML.  Using quantized notation values for
audio would introduce slight rhythmic jitter in playback.  Keeping them
separate gives the best of both worlds.

### Data flow summary

```
Basic Pitch MIDI
      │
      ▼
  MidiParser  ──── raw snap ───▶  position, duration   (notation fallback)
      │             ──── raw ───▶  start_time_s, end_time_s  (performance)
      │
      ▼
NotationQuantizer
      │   (reads start_time_s/end_time_s + tempo + time_sig)
      ▼
  notation_position, notation_duration   (clamped, grid-aligned)
      │
      ├──▶ MusicXML generator  (uses notation_position / notation_duration)
      │
      └──▶ Tone.js (uses start_time_s / end_time_s — unchanged)
```

### Configuring quantization
The grid defaults to 16th notes.  To use a coarser grid (e.g. eighth notes):

```python
from app.services.audio.quantizer import NotationQuantizer
quantizer = NotationQuantizer()
quantizer.quantize(score, grid="eighth")
```

Upload triggers `demucs.separate -n htdemucs` in a FastAPI `BackgroundTask`.
Stems are written to `uploads/{project_id}/stems/htdemucs/{song_stem}/`.
The processing job status is tracked in the DB (`queued → running → completed/failed`).

**Dependencies:** `torch==2.5.1+cpu`, `torchaudio==2.5.1+cpu`, `soundfile` (CPU-only, no CUDA needed).

## How chart analysis works

`POST /api/songs/{id}/charts` runs `ChordChartEngine` on the uploaded audio:

1. **Harmonic source selection** — the engine prefers a Demucs stem for chroma extraction.
   Priority: `other` stem → `vocals` stem → full mix.  Beat tracking always uses the
   original mix regardless (more reliable percussive transients).
2. **Beat tracking** — `librosa.beat.beat_track` on the mix detects tempo (BPM) and beat timestamps.
3. **Measure segmentation** — beats are grouped into 4-beat measures (4/4).
4. **Chromagram** — configurable via `ChromaConfig.method`: `cqt` (default) | `stft` | `cens`.
   Computed on the selected harmonic source for cleaner pitch-class content.
5. **Chord detection** — per-measure average chroma (L1-normalised) is dot-product scored
   against all 24 major/minor triad templates.  The best match wins; top 3 alternatives
   and confidence scores are recorded.
6. **ScoreModel → DB** — `ChartBuilder` persists the result as `Chart` / `ChartMeasure` /
   `ChartNote` rows.  Each `ChartMeasure` stores `chord_confidence` (float) and
   `chord_alternatives` (JSON list) for frontend display.

The `source` field on the stored chart is `"chord_chart"`.
If analysis fails completely the engine falls back and marks the chart `"placeholder"`.

### Chroma strategy comparison (test track "live in a way app test.mp3")

| Method | Chords (first 6 of 24 measures) | Typical confidence |
|--------|----------------------------------|-------------------|
| `cqt`  | Bb F Gm Gm Bb Bb                | 0.35 – 0.62       |
| `stft` | Bb F F Gm Bbm Bb                | 0.31 – 0.38       |
| `cens` | Bb Bb Bb Bb Bb Bb               | 0.47 – 0.63       |

`cqt` gives the most varied results on this track; `cens` (smoothed energy) tends to lock on
the tonic and produces less variety.  `cqt` is the current default.

### Configuration

Pass a `ChromaConfig` to `ChordChartEngine` to override defaults:

```python
from app.services.transcription.chord_chart import ChordChartEngine, ChromaConfig

engine = ChordChartEngine(ChromaConfig(
    method="stft",           # "cqt" | "stft" | "cens"
    harmonic_stem="other",   # "preferred" | "mix" | "other" | "vocals"
    n_alternatives=3,        # alternatives stored per measure
))
result = engine.analyze(song_path, title="My Song")
# result.measure_analyses[i].chord, .confidence, .alternatives
```

**Current limitations:**
- Notes are whole-rests (pitch transcription not yet implemented).
- Key signature is hardcoded to C (Krumhansl–Schmuckler detection is a planned TODO).
- Time signature is fixed to 4/4 (metre detection is a planned TODO).
- Chord templates cover only major and minor triads (no 7ths, sus, diminished, etc.).

**Dependency:** `librosa==0.11.0` (`requirements.txt`); ffmpeg is required for MP3 loading.

## How MusicXML works

`GET /api/charts/{id}/musicxml` regenerates MusicXML from the current DB state using
`services/musicxml/generator.py` and returns raw XML with `application/xml`.
The file is also written to `uploads/{project_id}/generated/musicxml/chart_{id}.xml`.

## How OSMD works

`ScoreViewer.tsx` dynamically imports `opensheetmusicdisplay` on the client and renders
any MusicXML string passed via prop.  On every save the project page re-fetches MusicXML
and passes the new string — OSMD re-renders automatically.

## Repository structure

```text
.
├── backend/
│   ├── app/
│   │   ├── api/routes.py          ← all HTTP endpoints
│   │   ├── db.py                  ← SQLite connection / session
│   │   ├── main.py                ← FastAPI app + startup
│   │   ├── models/entities.py     ← SQLAlchemy ORM models
│   │   ├── schemas.py             ← Pydantic request/response models
│   │   └── services/
│   │       ├── audio/stems.py     ← stem path helpers
│   │       ├── chart/builder.py   ← ScoreModel ↔ DB entities
│   │       ├── musicxml/generator.py ← MusicXML generation
│   │       ├── processing.py      ← Demucs background pipeline
│   │       ├── score/model.py     ← internal ScoreModel dataclasses
│   │       ├── storage/paths.py   ← file path config
│   │       ├── audio/stems.py     ← stem path helpers
│   │       ├── audio/timing.py    ← TimingAnalyzer (librosa beat tracking)
│   │       └── transcription/
│   │           ├── base.py         ← TranscriptionEngine ABC
│   │           ├── chord_chart.py  ← ChordChartEngine (ChromaConfig, MeasureAnalysis, ChordChartResult)
│   │           └── placeholder.py  ← fallback 8-measure scaffold
│   ├── data/app.db                ← SQLite database
│   ├── requirements.txt
│   └── uploads/                   ← audio + stems + generated exports
├── frontend/
│   └── src/
│       ├── app/projects/[projectId]/page.tsx  ← project detail + chart
│       └── components/
│           ├── api.ts             ← fetch wrapper
│           └── score/
│               ├── ChartEditor.tsx   ← form-based chart editor
│               └── ScoreViewer.tsx   ← OSMD renderer
└── README.md
```

## Database schema

Tables are created automatically on backend startup via `Base.metadata.create_all`.

| Table | Purpose |
|---|---|
| `projects` | Project metadata |
| `songs` | Audio file reference per project |
| `stems` | Demucs stem file paths + status |
| `processing_jobs` | Background task lifecycle |
| `charts` | Structured chart (title, tempo, key, time_sig) |
| `chart_measures` | One row per measure (chord_symbol, time_sig_override) |
| `chart_notes` | One row per note/rest (pitch, duration, is_rest) |
| `exports` | Generated MusicXML file paths |
| `chart_edits` | Legacy JSON blob editor (kept for compatibility) |

## Environment variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/app.db` | SQLite path |
| `UPLOAD_DIR` | `./uploads` | Root for audio/stems/exports |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed frontend origins |
| `DEMUCS_MODEL` | `htdemucs` | Demucs model name |

### Frontend (`frontend/.env.local`)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Backend base URL |

## Running locally

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

> **Note:** `torch` and `torchaudio` must be installed from the PyTorch CPU index.
> The `requirements.txt` pins `torch==2.5.1+cpu` and `torchaudio==2.5.1+cpu`.
> Install with `--extra-index-url https://download.pytorch.org/whl/cpu`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## How to test chart rendering

1. Start both servers.
2. Create a project.
3. Upload an MP3 or WAV file.
4. Watch stem status on the project page (refresh after ~60–90s for CPU).
5. Click **Generate chart** — this runs beat tracking + chord detection and produces MusicXML.
6. The score renders in the browser via OSMD.
7. Edit the title, tempo, key, time sig, or chord symbols and save — OSMD re-renders.

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/projects` | Create project |
| `GET` | `/api/projects` | List projects |
| `GET` | `/api/projects/{id}` | Project detail with songs/stems |
| `PUT` | `/api/projects/{id}` | Update project |
| `DELETE` | `/api/projects/{id}` | Delete project + files |
| `POST` | `/api/projects/{id}/upload` | Upload audio → start Demucs |
| `POST` | `/api/songs/{id}/reprocess` | Re-queue Demucs for a song |
| `GET` | `/api/songs/{id}/stems` | List stems |
| `POST` | `/api/songs/{id}/charts` | Generate structured chart |
| `GET` | `/api/charts/{id}` | Get chart with measures |
| `PATCH` | `/api/charts/{id}` | Update chart metadata |
| `PATCH` | `/api/charts/{id}/measures/{mid}` | Update a measure |
| `GET` | `/api/charts/{id}/musicxml` | Get generated MusicXML |
| `GET` | `/api/jobs/{id}` | Processing job status |
| `PUT` | `/api/charts/{id}` | Update legacy JSON chart blob |

## Validation commands

### Backend

```bash
cd backend
source .venv/bin/activate
python -m pytest app/tests/ -q
```

### Frontend

```bash
cd frontend
npm run typecheck
npm run lint
npm run build
```

## Note editor — supported notation

The custom SVG score editor (`ScoreEditor.tsx` + `NoteEditorToolbar.tsx`) supports:

### Note durations
| Duration | Grid slots (16th = 1) | Beamable |
|---|---|---|
| Whole | 16 | No |
| Half | 8 | No |
| Quarter | 4 | No |
| Eighth | 2 | **Yes** |
| Sixteenth | 1 | **Yes** |

### Accidentals
Natural (♮), Sharp (♯), Flat (♭)

### Pitch range
C2 – B6, treble clef staff displayed A5 – C4 (with ledger lines for C4).

### Rests
All durations above are available as rests.

### Articulations (UI — stored locally; backend persistence planned)
Staccato, Accent, Tenuto, Fermata, Staccatissimo

### Dynamics (UI — stored locally; backend persistence planned)
pp, p, mp, mf, f, ff

---

## Automatic beaming

Notes are grouped into beams automatically based on the time signature.  The
logic lives in `frontend/src/lib/beaming.ts` and mirrors exactly in
`backend/app/services/musicxml/generator.py` (so OSMD's MusicXML rendering
and the custom SVG editor both beam identically).

### Beat windows by time signature

| Time sig | Beat windows (16th-note slots) | Notes |
|---|---|---|
| 4/4 | [0–7] [8–15] | Half-measure groups |
| 3/4 | [0–3] [4–7] [8–11] | Per-beat groups |
| 2/4 | [0–7] | Whole-measure group |
| 6/8 | [0–5] [6–11] | Dotted-quarter compound groups |
| 9/8 | [0–5] [6–11] [12–17] | Three dotted-quarter groups |
| 12/8 | [0–5] [6–11] [12–17] [18–23] | Four dotted-quarter groups |
| other | Per-beat (fallback) | `16/denominator` slots |

### Beaming rules

1. Only **eighth** and **sixteenth** notes can be beamed.
2. Notes must be **strictly adjacent** (no gap in the 16th-note grid).
3. A rest or non-beamable note **breaks** the beam at that point.
4. Two beamable notes in **different beat windows** are never beamed together.
5. A solo beamable note that forms no group stays flagged individually.

### Second beam level (for 16th notes)

When **every** note in a beam group is a sixteenth, two parallel beam lines
are drawn.  In the MusicXML output this is encoded as `<beam number="1">` and
`<beam number="2">` elements per note.

### Known limitations

- Mixed eighth+sixteenth groups: SVG editor draws one beam only (second beam
  for 16ths is emitted in MusicXML but not drawn in the custom SVG editor).
- 32nd notes are not yet supported in either editor or generator.
- Tuplets (triplets, etc.) are not yet supported.
- Beam angles are always horizontal (correct engraving would tilt beams to
  follow the pitch contour of the group).

### Verifying beaming

```bash
# Backend beaming smoke-tests
cd backend && source .venv/bin/activate
python3 - <<'EOF'
from app.services.musicxml.generator import _compute_beam_roles
from app.services.score.model import ScoreNote

def n(pos, dur): return ScoreNote(pitch="E4", duration=dur, is_rest=False, position=pos)

# 4/4: two adjacent eighths → beamed
roles = _compute_beam_roles([n(0,"eighth"), n(2,"eighth")], "4/4")
assert roles[0][0] == "begin" and roles[1][0] == "end", roles

# 4/4: eighth spanning window boundary (slot 6 + slot 8) → NOT beamed
roles = _compute_beam_roles([n(6,"eighth"), n(8,"eighth")], "4/4")
assert all(r[0] == "none" for r in roles), roles

# 6/8: six adjacent eighths → two groups of 3
roles = _compute_beam_roles([n(i*2,"eighth") for i in range(6)], "6/8")
expected = ["begin","continue","end","begin","continue","end"]
assert [r[0] for r in roles] == expected, roles

print("All beaming checks passed.")
EOF
```

```bash
# Frontend beaming unit tests (requires jest or vitest)
cd frontend
npx jest src/lib/beaming.test.ts --no-coverage
```

---

## Current limitations

- Transcription is a placeholder (returns 8-measure whole-rest scaffold with fixed chord symbols).
- No real pitch/beat/chord analysis yet — transcription module is pluggable for future engines.
- Single-part / single-instrument MusicXML only.
- No drag-and-drop notation editor — chart editing is form-based.
- Articulations and dynamics are stored in the UI `ToolState` but not yet persisted to the DB.
- No user authentication.
- CPU-only Demucs (no GPU acceleration in dev).

## Next milestones

1. Integrate a real chord/beat detection library (e.g. `librosa`, `basic-pitch`, or `mir_eval`).
2. Populate ChartNote rows from actual transcription output.
3. Multi-part MusicXML (separate parts per Demucs stem).
4. Export to PDF via LilyPond or similar.
5. Add user authentication.
6. Persist articulations and dynamics to the DB / MusicXML.
7. Mixed eighth+sixteenth beam groups with partial secondary beams.


