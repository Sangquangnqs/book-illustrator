# Book Illustration Studio

Book Illustration Studio is a local full-stack app for the Gradion take-home assessment. It turns pasted or uploaded book text into a small Gemini-generated illustration workflow: style, adult characters, character portraits, chapter prompts, and a final chapter illustration.

The app is intentionally local and lean. Project state is persisted to JSON files, book text and generated images are stored on disk, and the backend owns all pipeline ordering, retry, duplicate-call, and ownership checks.

![Book Illustration Studio landing page](docs/screenshots/image.png)

## Tech Stack

- React + Vite frontend with plain CSS
- Node.js + Express backend
- Local JSON and filesystem persistence
- Zod validation
- Multer memory uploads for `.txt` files
- Signed HttpOnly cookie identity
- Official `@google/genai` JavaScript SDK, pinned in `backend/package.json`
- Vitest, Supertest, React Testing Library, and jsdom for tests

## Prerequisites

- Node.js 22.x recommended. The app was developed and verified with Node 22.
- npm
- A Gemini API key
- Gemini image quota/billing for Nano Banana image generation

## Setup

Install dependencies from the repository root:

```bash
npm install
```

Create a local `.env` from the example:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Fill in:

```env
PORT=3000
VITE_API_BASE_URL=http://localhost:3000
SESSION_SECRET=replace-with-a-long-local-secret
GEMINI_API_KEY=replace-with-your-gemini-api-key
```

`PORT` defaults to `3000`. `VITE_API_BASE_URL` points the frontend at the backend during local development.

## Run Locally

Start the backend and frontend together:

```bash
npm start
```

Local URLs:

- Frontend: `http://127.0.0.1:5173`
- Backend health: `http://localhost:3000/api/health`

If Vite reports that port `5173` is already in use, it may start on the next available port.

## Tests

Run all backend and frontend tests:

```bash
npm test
```

Useful individual commands:

```bash
npm run test --workspace backend
npm run test --workspace frontend
npm run build --workspace frontend
```

See `TESTING.md` for the final verification report and live Gemini smoke-test notes.

## Pipeline Flow

Each step is triggered by the user and must complete before the next one can run:

```text
STYLE -> CHARACTERS -> PORTRAITS -> CHAPTERS -> ILLUSTRATIONS
```

- `STYLE`: uploads/reuses the book context and creates a style interaction.
- `CHARACTERS`: generates structured JSON for up to 2 main adult characters.
- `PORTRAITS`: generates one Nano Banana portrait per character.
- `CHAPTERS`: generates structured JSON for up to 1 chapter illustration prompt.
- `ILLUSTRATIONS`: generates the final chapter illustration from the image chain.

The 2-character and 1-chapter caps are enforced in prompts, Gemini structured-output schemas, and backend Zod validation. Invalid oversized output fails the step instead of being silently truncated.

## Architecture Notes

The React app is a thin client. It signs in, creates projects, renders persisted state, starts or retries the current step, and polls project detail while a step is running.

The Express backend is authoritative for:

- signed-cookie session loading
- project ownership checks
- project creation and file upload validation
- pipeline ordering
- stale-step detection
- duplicate Gemini-call prevention
- generated file serving

Pipeline actions return a persisted `running` state immediately. The backend then continues the claimed work in-process while the frontend polls `GET /api/projects/:projectId`.

## Local Persistence

By default, local data is written under:

```text
data/
  users.json
  projects/
    project_<uuid>/
      project.json
      book.txt
      images/
        portraits/
        chapters/
```

`users.json` maps normalized emails to user records and project IDs. Each project has one `project.json`, one `book.txt`, and project-scoped generated images. JSON writes use temp-file plus rename, with small in-process serialization for shared user state and per-project mutations.

## Resumability, Duplicates, And Retry

Each running step stores `step`, `runId`, and `startedAt` in `project.json`.

- Double-clicks, refreshes, and second tabs see the existing running state instead of starting another Gemini call.
- `/run` only starts the current idle step.
- Failed or stale steps require explicit `/retry`.
- Stale state is derived from `startedAt` and conservative per-step timeouts.
- Retrying creates a new `runId`.
- Expensive image calls and final state writes check `runId` so old work cannot overwrite newer retries.
- Completed previous steps and successful image items are preserved.

There are no queues, workers, automatic retries, SSE, or WebSockets.

## Postman

Postman artifacts are in `postman/`:

- `postman/Book-Illustration-Studio.postman_collection.json`
- `postman/Local.postman_environment.json`

Import both files, select the local environment, start the app with `npm start`, then run `Sign in` first so Postman can store the signed session cookie. The collection uses `{{baseUrl}}`, defaulting to `http://localhost:3000`, and contains no secrets.

Pipeline requests may make real Gemini calls when the backend is configured with `GEMINI_API_KEY`.

## Gemini Image Quota Note

The app uses `gemini-3.1-flash-image` for Nano Banana image generation through the Gemini Interactions API. During live smoke testing, book upload, STYLE, and CHARACTERS succeeded. The image request reached the real API, but actual portrait generation was blocked by HTTP 429 because the test project had zero Free Tier image quota. Image success, MIME handling, file storage, and interaction chaining are covered by mocked SDK and pipeline tests.
