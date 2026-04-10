# AGENTS.md

## Project purpose
This repository contains an MVP for a music analysis and chart-generation app.
The app should:
- accept audio uploads
- process audio into stems later through a modular pipeline
- generate editable chart/notation data
- allow users to edit and save chart results

## Tech stack
- Frontend: Next.js + React + TypeScript
- Backend: FastAPI + Python
- Database: SQLite
- Dev environment: GitHub Codespaces with devcontainer

## Coding priorities
- Keep the MVP simple
- Prefer clear structure over cleverness
- Avoid overengineering
- Build thin vertical slices
- Use placeholders/interfaces for future AI/audio steps when full implementation is not ready
- Keep code easy for a solo developer to continue

## Architecture rules
- Keep frontend, backend, processing, and persistence separated
- Do not tightly couple AI/audio processing to the UI
- Make processing pipeline replaceable
- Store only metadata in the database; use file paths/references for local file storage in MVP
- Use environment variables for configurable settings

## Implementation rules
- Work one milestone at a time
- Before making large changes, summarize the plan
- Keep diffs scoped
- Update README when setup or commands change
- Add or update validation commands as features are introduced
- Prefer practical defaults

## MVP milestones
1. Scaffold frontend/backend/devcontainer
2. Add SQLite schema and database access
3. Implement audio upload endpoint and UI
4. Add project/song metadata views
5. Add placeholder processing job flow
6. Add editable chart data model and basic editor
7. Add exports later

## Validation expectations
- Run relevant install/build/lint/test commands after each milestone
- Fix broken builds before moving on
- Report blockers clearly