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
3. In Apps Script, set **`QUESTIONS_JSON_URL`** to a **direct URL whose response body is raw JSON** (first non-whitespace character should be `{`, not `<`).
4. Run **`testQuestionsJsonUrl()`** once in the Apps Script editor; it should report `questionCount` without errors.
5. Run **`syncQuestionsFromJSON()`** once.

This fills `question_id` from `questions.json` and sets `assignment_count` to **0** for new ids, while **preserving** existing counts for ids that already exist.

### If `syncQuestionsFromJSON` fails with `Unexpected token '<'` / `<!DOCTYPE`

`UrlFetchApp` received **HTML**, not JSON. Typical causes:

| Mistake | Fix |
|--------|-----|
| GitHub **file** page (`github.com/.../blob/...`) | Use **Raw** → copy URL like `https://raw.githubusercontent.com/<user>/<repo>/<branch>/questions.json` |
| Vite dev server (`localhost`) | Apps Script **cannot** reach your laptop. Deploy `npm run build` and host `dist/questions.json` on HTTPS (Netlify, Vercel, GitHub Pages, etc.) |
| Wrong path on static host | Open the URL in an **incognito** window; you should see JSON text, not your app’s `index.html` |
| Google Drive “share link” | Drive share links return HTML; upload JSON to a static host or use **raw** GitHub |

Working examples of valid `QUESTIONS_JSON_URL`:

- `https://<your-domain>/questions.json` after `npm run build` and upload/copy `dist/questions.json`
- `https://raw.githubusercontent.com/ORG/REPO/main/questions.json`

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

- `VITE_GOOGLE_FORM_URL` = your deployed Apps Script URL (full `https://script.google.com/macros/s/.../exec`)

### “Failed to fetch” in the browser

Browsers **block** `fetch()` from a local dev page (`http://localhost:...`) to `https://script.google.com/...` (**CORS**).

**Fix (already wired in this repo):**

1. Keep `.env` as the **full** Apps Script URL (`https://script.google.com/macros/s/.../exec`).
2. Run **`npm run dev`** (not opening the `dist/index.html` file directly).
3. The app rewrites that URL to a **same-origin** path and Vite **`vite.config.js`** proxies `/api/google-macro` → `script.google.com`.

If you open the built site from **GitHub Pages** or another host **without** a proxy, a direct `fetch` to Google may still fail with CORS. Options: add a small server-side proxy on your host, or use a host that can proxy (e.g. Netlify redirects to the script URL).

### “Unable to allocate…” or `Apps Script HTTP 404` / non-JSON body

The UI now shows **HTTP status** and a short **body snippet** when allocation fails. Typical fixes:

1. **Wrong Web App URL** — Copy **Deploy → Manage deployments → Web app** URL. It must end with **`/exec`** (not `/dev`). After any script edit, create a **New version** and deploy again.
2. **`SHEET_ID` in Apps Script** — Must be your spreadsheet id (between `/d/` and `/edit` in the Sheet URL). Save the script and redeploy.
3. **Questions tab empty** — Run **`syncQuestionsFromJSON()`** (or paste rows) so `getQuestions` can return 5 ids with `assignment_count < 5`.
4. **Local proxy** — Use `npm run dev` on **localhost** so the Vite proxy runs. The proxy strips `/api/google-macro` and forwards to `https://script.google.com/macros/.../exec`. If you see **HTTP 404** and HTML starting with `<!DOCTYPE`, the proxy path was wrong (fixed in `vite.config.js` `rewrite`); restart `npm run dev`.

## 7) Collection target

With **15** question ids and **5** assignments each:

- **75** completed sessions × **5** questions = **375** question ratings in aggregate  
  (or **75** response rows if you only care about per-session rows).

Adjust pool size or `MAX_ASSIGNMENTS_PER_QUESTION` in the script if you need different totals.
