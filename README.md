# SpeechEQ-Model-Arena

SpeechEQ-Model-Arena is a standalone React + Vite app where each participant evaluates **5 questions** per session, reads multiple model responses per question, and submits independent model scores.

## Core Behavior
- Exactly 5 questions per session.
- Dynamic number of models per question (driven by JSON data).
- Independent 1-10 score required for each model before advancing.
- Results submitted to Google Sheets through Apps Script.
- Assignment is balanced via Apps Script so each question can be collected multiple times.

## Project Layout
- `src/App.jsx`: session loading, ranking UI, submission logic
- `questions.json`: full question pool (generated from `data/` via `npm run generate-questions`)
- `model_responses/`: one JSON file per question (or explicit path from manifest)
- `data/`: question metadata files
- `scripts/generate-questions.js`: build `questions.json` from all `data/<subscale>/<dataset_id>/` folders
- `scripts/validate-model-responses.js`: verify manifest/model payload integrity
- `GOOGLE_SCRIPT_MODEL_ARENA.js`: Apps Script backend

## Local Development
```bash
npm install
npm run generate-questions
npm run check-data
npm run dev
```

## Build
```bash
npm run build
```

This copies `data/`, `model_responses/`, and `questions.json` into `dist/`.

## Data Requirements
- `data/<subscale_slug>/<dataset_id>/metadata.json` defines each scenario; run `npm run generate-questions` to refresh `questions.json`.
- At least two files under `model_response/*.json` must include a `responses[]` entry with matching `dataset_id` for each question.

## Google Sheets Integration
See `GOOGLE_SHEETS_SETUP.md` for the `Questions` (`question_id`, `assignment_count`) and flat `Responses` row layout, plus the `syncQuestionsFromJSON()` initializer.
