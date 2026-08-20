# Implementation Plan

Build required behavior first, then polish. Each milestone should be runnable, testable, and small enough to commit on its own.

Final status: milestones 1-8 are complete.

## 1. Project scaffolding and scripts

Goal: Create the React/Vite frontend, Express backend, shared local dev shape, and one-command entry points.

Main files/modules:

- `frontend/`
- `backend/`
- root `package.json`
- `.env.example`
- `.gitignore`
- start/test scripts

Requirements covered:

- One command starts the stack.
- One command runs tests.
- Gemini key is environment-based and not committed.

Tests/checks before moving on:

- Frontend dev server starts.
- Backend health endpoint responds.
- Root start script launches both.
- Root test script runs placeholder frontend and backend test commands.

Suggested Git commit boundary: `chore: scaffold frontend and backend`

## 2. Storage and project state model

Goal: Implement the local storage foundation before adding routes or Gemini calls.

Main files/modules:

- `backend/src/storage/`
- `backend/src/domain/projectState.js`
- `backend/src/domain/projectSchema.js`
- `backend/test/storage.test.js`
- `backend/test/projectState.test.js`

Requirements covered:

- Local JSON/file storage.
- State isolated per user/project.
- Safe concurrent or overlapping writes.
- Resumable project state after restart.

Tests/checks before moving on:

- Creates user and project folders in a temp data directory.
- Writes `project.json` atomically.
- Reads project state after simulated process restart.
- Serializes overlapping updates through the per-project mutex.
- Derives next step from persisted status.

Suggested Git commit boundary: `feat: add local storage and project state model`

## 3. Identity and project APIs

Goal: Add usable backend APIs for sign-in, project list, project creation, book text, and image file serving.

Main files/modules:

- `backend/src/server.js`
- `backend/src/routes/sessionRoutes.js`
- `backend/src/routes/projectRoutes.js`
- `backend/src/middleware/session.js`
- `backend/test/projectRoutes.test.js`

Requirements covered:

- Email + name identity.
- Existing email loads projects.
- User has many projects.
- Create project from pasted text or uploaded `.txt`.
- Book text stored locally and readable later.
- Images served through backend API.

Tests/checks before moving on:

- Invalid identity input returns validation errors.
- Same email reloads the same user.
- Project list only returns the signed-in user's projects.
- Project creation works with pasted text.
- Project creation works with `.txt` upload.
- Non-`.txt` upload is rejected.

Suggested Git commit boundary: `feat: add identity and project APIs`

## 4. Pipeline execution, concurrency, and recovery

Goal: Build the pipeline state machine using a fake Gemini client so the hard correctness behavior is testable without spending quota.

Main files/modules:

- `backend/src/pipeline/pipelineService.js`
- `backend/src/pipeline/stepGuards.js`
- `backend/src/pipeline/staleTimeouts.js`
- `backend/src/services/geminiClient.fake.js`
- `backend/test/pipelineService.test.js`
- `backend/test/pipelineRoutes.test.js`

Requirements covered:

- Steps run one at a time by explicit user action.
- Steps cannot run out of order.
- Refresh/second tab/double-click cannot start duplicate work.
- Failures are retryable for that step only.
- Stale running steps can be retried.
- Completed results are preserved between steps.
- Server-side 2-character / 1-chapter enforcement.

Tests/checks before moving on:

- Cannot run `CHARACTERS` before `STYLE`.
- Two simultaneous run requests result in one fake Gemini call.
- Existing running step returns in-flight state.
- Failed step stores error and can retry.
- Old `startedAt` is returned as stale.
- Old completion with wrong `runId` cannot overwrite newer state.
- Invalid oversized Gemini JSON fails instead of truncating.

Suggested Git commit boundary: `feat: add pipeline state machine`

## 5. Gemini integration

Goal: Replace the fake pipeline client with a real `@google/genai` wrapper while keeping tests mocked.

Main files/modules:

- `backend/src/services/geminiClient.js`
- `backend/src/services/geminiSchemas.js`
- `backend/src/config/env.js`
- `backend/test/geminiValidation.test.js`

Requirements covered:

- Real calls to current Gemini text and image models.
- File upload or equivalent one-time book context.
- Structured JSON output.
- Context/interaction chaining.
- Image generation.
- No committed API key.
- No automatic application-level retry loop.

Tests/checks before moving on:

- Unit tests validate Gemini response parsing and schema failures.
- Backend still passes all fake-client pipeline tests.
- Manual smoke test with a tiny public-domain text can run at least Style and Characters.
- Model IDs and SDK version are recorded for later `DECISIONS.md`/README updates.

Suggested Git commit boundary: `feat: wire Gemini SDK integration`

## 6. Frontend screens and states

Goal: Build the required UI against the backend APIs, using the demo as the scope floor.

Main files/modules:

- `frontend/src/App.jsx`
- `frontend/src/api/client.js`
- `frontend/src/routes/Identity.jsx`
- `frontend/src/routes/ProjectList.jsx`
- `frontend/src/routes/NewProject.jsx`
- `frontend/src/routes/ProjectDetail.jsx`
- `frontend/src/components/Stepper.jsx`
- `frontend/src/components/ProjectCard.jsx`
- `frontend/src/components/EntityCard.jsx`
- `frontend/src/styles.css`
- `frontend/src/**/*.test.jsx`
- `frontend/test/setup.js`

Requirements covered:

- Identity screen with validation.
- Project list, empty state, status pill, and five-step progress.
- New project form with upload and paste text.
- Project detail with full book text, stepper, style, character cards, chapter cards, images, current action, in-progress state, error state, stale recovery, and sign out.
- Per-item image progress while image steps run.

Tests/checks before moving on:

- Component tests cover key empty, loading, error, stale, and project-detail states.
- Manual browser walkthrough of auth, project creation, and project detail.
- Refresh during running fake step shows in-flight state.
- Double-click does not visibly start duplicate work.
- Mobile and desktop layouts remain readable.

Suggested Git commit boundary: `feat: build required frontend flow`

## 7. Test consolidation and integration pass

Goal: Fill any remaining required test gaps, prove the frontend and backend suites run together, and capture the real test report for `TESTING.md`.

Main files/modules:

- `backend/test/*.test.js`
- `frontend/src/**/*.test.jsx`
- root test script
- `TESTING.md` draft/test output capture

Requirements covered:

- Backend and frontend tests are both present.
- One command runs the tests.
- Real test output is captured for `TESTING.md`.
- Nice to have: mocked happy-path integration test through all 5 steps.

Tests/checks before moving on:

- Backend test suite passes.
- Frontend test suite passes.
- Root test command runs both suites.
- Test output is saved for `TESTING.md`.
- Tests use fake Gemini responses and do not spend API quota.
- Any missing requirement from earlier milestone tests is covered or explicitly noted for `TESTING.md`.

Suggested Git commit boundary: `test: consolidate required test coverage`

## 8. README, TESTING.md, decisions, and final polish

Goal: Make the repository easy for a reviewer to run and understand.

Main files/modules:

- `README.md`
- `TESTING.md`
- `DECISIONS.md`
- `docs/architecture.md`
- `docs/plan.md`

Requirements covered:

- README includes prerequisites, env vars, one start command, one test command, and architecture overview.
- `TESTING.md` includes strategy and real test report.
- `DECISIONS.md` contains 4-6 real decisions and at least 3 AI overrides.
- AI artifacts are committed.
- No secrets committed.

Tests/checks before moving on:

- Fresh setup from README works.
- Test command output matches `TESTING.md`.
- Manual full happy path works with Gemini, within the hard 2-character / 1-chapter limits.
- Manual failure/stale/retry behavior is checked with fake or forced errors.

Suggested Git commit boundary: `docs: add reviewer instructions and test report`

## Bonus only if time remains

- Visible attempt history per step.
- Sample public-domain book picker.
- SSE for real-time updates instead of polling.
- One later notebook section, only after the required five-step app is solid.
