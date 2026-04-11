# MVP Phased Implementation Plan

## Architecture proposal

The MVP is split into four clear layers:

1. **Frontend (`frontend/`)**
   - Next.js + TypeScript UI for project creation, audio upload, project detail view, and chart editing.
   - Talks only to FastAPI via HTTP.
2. **Backend API (`backend/app/api`)**
   - FastAPI endpoints for CRUD-style metadata operations and file upload orchestration.
   - No heavy processing logic in route handlers.
3. **Processing pipeline (`backend/app/services/processing.py`)**
   - Interface-style service that creates placeholder jobs now and can swap to real stem/transcription later.
4. **Persistence (`backend/app/db.py` + SQLAlchemy models)**
   - SQLite stores metadata and chart edits.
   - Uploaded audio remains on local filesystem and DB stores file references.

This keeps concerns separated and supports incremental replacement of placeholder processing services.

## Folder structure (proposed)

```text
.
├── .devcontainer/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── models/
│   │   ├── services/
│   │   ├── db.py
│   │   ├── schemas.py
│   │   └── main.py
│   ├── tests/
│   ├── uploads/
│   └── requirements.txt
├── frontend/
│   ├── src/app/
│   ├── src/components/
│   └── package.json
├── docs/
│   └── implementation-plan.md
└── README.md
```

## Phases

### Phase 1: Project scaffold + devcontainer
- Add frontend/backend directories, runtime scripts, and devcontainer.
- Add environment variable examples.

### Phase 2: SQLite schema + DB integration
- Add SQLAlchemy setup and initial schema:
  - users
  - projects
  - songs
  - stems
  - chart_edits
  - processing_jobs
- Add migration bootstrap via `init_db` command.

### Phase 3: First thin vertical slice
- API endpoints:
  - create/list/get project
  - upload audio file for project
  - create placeholder processing job + basic chart entry
  - update chart edits
- Frontend pages:
  - create/select project
  - upload song
  - project detail metadata display
  - simple chart editor text area

### Phase 4: Docs + validation
- Update README with exact local + Codespaces setup and commands.
- Add basic backend smoke tests for API happy path.
- Run lint/typecheck/tests.
