# Google Sheets pipeline (SpeechEQ-Model-Arena)

## 1) Create a spreadsheet

Add two tabs (exact names):

- `Questions`
- `Responses`

## 2) Questions tab schema

The Apps Script expects **exactly two columns** (row 1 = header):

| question_id | assignment_count |
|-------------|------------------|
| `20260308_233939_cf32f97e67e4` | 0 |
| ... | ... |

- **`question_id`**: stable id for each scenario (must match `dataset_id` / manifest `id` used by the app).
- **`assignment_count`**: number of completed sessions that included this id (incremented on each successful submit). Stops allocating when count reaches **5**.

### Initialize / refresh ids from your repo

1. In the repo, generate the manifest from every folder under `data/`:
   - `npm run generate-questions`
2. Host `questions.json` somewhere HTTPS-readable (or use your deployed site `.../questions.json`).
3. In Apps Script, set `QUESTIONS_JSON_URL` and run **`syncQuestionsFromJSON()`** once.

This fills `question_id` from `questions.json` and sets `assignment_count` to **0** for new ids, while **preserving** existing counts for ids that already exist.

You can also paste ids manually: set `assignment_count` to `0` for new rows.

## 3) Deploy Apps Script

1. Create a project and paste `GOOGLE_SCRIPT_MODEL_ARENA.js`.
2. Set **`SHEET_ID`** to your spreadsheet id.
3. Set **`QUESTIONS_JSON_URL`** (used only by `syncQuestionsFromJSON`).
4. Deploy as **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (or Anyone with the link, depending on your needs)

## 4) Runtime: allocate 5 questions per session

When the app loads, it calls:

`GET ?action=getQuestions&count=5`

The script:

1. Reads all rows in `Questions` with `assignment_count < 5`.
2. Sorts by **lowest** `assignment_count` first.
3. Returns the **next 5** `question_id` values.
4. If **no** rows are under the cap (every id has count 5), it returns `{ success: true, questions: [], exhausted: true }` and the UI shows an error.
5. If fewer than 5 ids are available under the cap, it returns `{ success: false, error: "Not enough questions..." }`.

## 5) Submit: Responses tab (wide row)

On each successful `POST`, the script appends **one row** with:

- `Timestamp`, `Prolific PID`, `Study ID`, `Session ID`, `Client Version`
- For each `Q1` … `Q5`:
  - `Qn_id`
  - `Qn_model_1_name`, `Qn_model_1_rate`, … up to **`Qn_model_6_name`**, **`Qn_model_6_rate`**

Unused model slots are left blank. Names are the **full** model file stem (e.g. `qwen3-omni-30b-a3b-instruct_001_ser_llm`).

After append, `assignment_count` is incremented by **1** for each `questionId` in that submission.

## 6) Frontend env

Copy `.env.example` to `.env` and set:

- `VITE_GOOGLE_FORM_URL` = your deployed Apps Script URL

## 7) Collection target

With **15** question ids and **5** assignments each:

- **75** completed sessions × **5** questions = **375** question ratings in aggregate  
  (or **75** response rows if you only care about per-session rows).

Adjust pool size or `MAX_ASSIGNMENTS_PER_QUESTION` in the script if you need different totals.
