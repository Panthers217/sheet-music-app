# Sheet Music App Implementation Todo

## Objective

Turn the current app into a structured music-chart generation system built around:

audio upload → Demucs stems → transcription pipeline → internal score model → MusicXML → OSMD render → editable chart workflow

---

## Guiding principles

* Keep the internal score model as the source of truth
* Generate MusicXML from the internal model
* Use OSMD for score rendering
* Keep transcription services modular
* Keep the MVP simple and editable
* Avoid building a full notation editor too early

---

## Priority order

### 1. Audit current repo

* [ ] Review upload flow
* [ ] Review Demucs integration
* [ ] Review DB schema
* [ ] Review API routes
* [ ] Review frontend pages/components
* [ ] Write implementation plan summary

### 2. Backend schema and models

* [ ] Add/update `projects`
* [ ] Add/update `songs`
* [ ] Add/update `stems`
* [ ] Add/update `processing_jobs`
* [ ] Add/update `charts`
* [ ] Add/update `chart_measures`
* [ ] Add/update `chart_notes`
* [ ] Add/update `chart_edits`
* [ ] Add/update `exports`

### 3. Processing modules

* [ ] Create `services/audio/`
* [ ] Create `services/transcription/`
* [ ] Create `services/chart/`
* [ ] Create `services/musicxml/`
* [ ] Create `services/storage/`

### 4. Internal score model

* [ ] Define score schema/types
* [ ] Support title
* [ ] Support tempo
* [ ] Support key
* [ ] Support time signature
* [ ] Support measures
* [ ] Support notes/rests
* [ ] Support durations
* [ ] Support chord symbols
* [ ] Support part/instrument metadata

### 5. MusicXML generation

* [ ] Build MusicXML generator
* [ ] Support single-part output first
* [ ] Add clef/time/key/tempo output
* [ ] Add measure note/rest output
* [ ] Add chord symbols if practical
* [ ] Add sample MusicXML output
* [ ] Add endpoint to retrieve MusicXML

### 6. Frontend score rendering

* [ ] Add OSMD dependency if missing
* [ ] Build `ScoreViewer` component
* [ ] Fetch MusicXML from backend
* [ ] Render chart page with OSMD
* [ ] Add loading/error states

### 7. Editing workflow

* [ ] Build simple chart metadata editor
* [ ] Build measure/chord form editor
* [ ] Add note-data editing in simple form/grid
* [ ] Save edits to backend
* [ ] Regenerate MusicXML after edits
* [ ] Re-render score after save

### 8. API routes

* [ ] Create project
* [ ] Upload song
* [ ] List stems
* [ ] Create chart from song/stem
* [ ] Get chart
* [ ] Update chart edits
* [ ] Get generated MusicXML
* [ ] Get processing job status

### 9. File storage

* [ ] Standardize `uploads/`
* [ ] Standardize `stems/`
* [ ] Standardize `generated/musicxml/`
* [ ] Add config/env-driven paths

### 10. Docs

* [ ] Update README architecture section
* [ ] Explain MusicXML role
* [ ] Explain Demucs role
* [ ] Explain OSMD role
* [ ] Add run instructions
* [ ] Add known limitations
* [ ] Add next milestones

---

## MVP limits

For now, do not build:

* full drag-and-drop notation editing
* advanced polyphonic transcription
* polished multi-instrument score editing
* mobile UI
* production infra

---

## Definition of success for this phase

* A song can be uploaded
* Demucs stems are available
* A chart entity can be created
* A simple internal score model exists
* MusicXML can be generated from that model
* OSMD can render that MusicXML
* User can make basic edits and save them
* README clearly explains the architecture
