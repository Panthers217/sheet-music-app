# Sheet Music App MVP

MVP scaffold for a music analysis + chart generation workflow with a thin vertical slice.

## What is implemented now

- Next.js frontend for project management, audio upload, and chart editing.
- FastAPI backend with SQLite metadata persistence.
- Local filesystem upload storage (metadata in DB, files on disk).
- Processing pipeline that runs Demucs stem separation and seeds:
   - processing job status
   - stems (`drums`, `bass`, `vocals`, `other`)
   - initial editable chart content

## Repository structure

```text
.
├── .devcontainer/
├── backend/
│   ├── app/
│   ├── data/
│   ├── uploads/
│   ├── requirements.txt
│   └── pytest.ini
├── docs/
├── frontend/
└── README.md
```

## Environment variables

### Backend (`backend/.env`)

Copy `backend/.env.example` and adjust if needed:

- `DATABASE_URL` (default: `sqlite:///./data/app.db`)
- `UPLOAD_DIR` (default: `./uploads`)
- `CORS_ORIGINS` (default: `http://localhost:3000`)

### Frontend (`frontend/.env.local`)

Copy `frontend/.env.example`:

- `NEXT_PUBLIC_API_BASE_URL` (default: `http://localhost:8000`)

## Run locally (Mac/Linux)

### 1) Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Note: real stem separation requires `ffmpeg` to be available on the system PATH.

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`.

## Run in GitHub Codespaces

1. Open the repo in Codespaces.
2. Wait for `postCreateCommand` to install dependencies.
3. Start backend:
   ```bash
   cd backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
4. Start frontend in a second terminal:
   ```bash
   cd frontend
   npm run dev
   ```
5. Use forwarded ports `3000` and `8000`.

## Initial database schema

SQLAlchemy models include:
- `users`
- `projects`
- `songs`
- `stems`
- `chart_edits`
- `processing_jobs`

Tables are created automatically on backend startup.

## Thin vertical slice flow

1. Create a project in the UI.
2. Upload an audio file for that project.
3. Backend stores file metadata + local file path.
4. Processing pipeline creates:
   - a processing job (`queued` -> `running` -> `completed`/`failed`),
   - stem files and metadata,
   - starter chart edit JSON text.
5. Project detail page displays songs and provides a basic editable chart text area.

## Validation commands

### Backend

```bash
cd backend
pytest
```

### Frontend

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
```
