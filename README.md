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

## How Demucs fits in

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

## Current limitations

- Transcription is a placeholder (returns 8-measure whole-rest scaffold with fixed chord symbols).
- No real pitch/beat/chord analysis yet — transcription module is pluggable for future engines.
- Single-part / single-instrument MusicXML only.
- No drag-and-drop notation editor — chart editing is form-based.
- No user authentication.
- CPU-only Demucs (no GPU acceleration in dev).

## Next milestones

1. Integrate a real chord/beat detection library (e.g. `librosa`, `basic-pitch`, or `mir_eval`).
2. Populate ChartNote rows from actual transcription output.
3. Multi-part MusicXML (separate parts per Demucs stem).
4. Export to PDF via LilyPond or similar.
5. Add user authentication.

