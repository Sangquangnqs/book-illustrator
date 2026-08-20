# Testing

## Strategy

The test suite focuses on the behavior the assessment cares about most: durable project state, user/project isolation, ordered pipeline execution, duplicate-call prevention, retry and stale recovery, Gemini response validation, and the frontend states a reviewer will exercise.

Automated tests do not make live Gemini calls. Gemini calls can spend quota, fail because of account limits, and take long enough to make the suite flaky. Instead, backend pipeline tests use a fake Gemini client and Gemini wrapper tests mock the official SDK. Live Gemini behavior was checked separately with a controlled smoke test.

## Backend Coverage

Backend tests cover:

- health endpoint
- signed-cookie session creation, restore, sign out, and tamper rejection
- user/project isolation
- project creation from pasted text and `.txt` upload
- invalid upload cases, including non-`.txt`, empty file, oversized file, and unexpected file field
- project detail, book text, and safe generated image serving
- local JSON storage, atomic writes, restart reads, per-project update serialization, and shared `users.json` serialization
- project state derivation and validation
- all five pipeline transitions
- out-of-order step rejection
- duplicate `/run` protection
- async running responses and polling-compatible persisted state
- failed and stale retry rules
- `runId` guards for stale success/failure and expensive image side effects
- partial portrait retry without regenerating successful images
- strict 2-character and 1-chapter caps
- image MIME-to-extension handling
- mocked Gemini SDK request shapes, interaction chaining, parsing, and normalized errors

## Frontend Coverage

Frontend tests cover:

- sign-in validation and session restore
- empty project list
- project list status/progress rendering
- new project validation
- project creation from pasted text
- project detail for current, running, failed, stale, and complete states
- concise user-facing Gemini error messages
- polling from running state to completed state
- per-item portrait progress
- generated portrait and chapter illustration rendering
- sign out

The frontend tests are component/state tests using React Testing Library and mocked API responses. Full browser E2E testing is intentionally out of scope for this take-home.

## Mocked Gemini

The pipeline service depends on an app-level Gemini client interface, so tests can inject a fake client without spending quota. The real `@google/genai` wrapper is tested with the SDK mocked, including:

- `gemini-3.7-flash` text interactions
- `gemini-3.1-flash-image` image interactions
- one-attempt SDK retry configuration
- book file upload/context creation
- style, character, chapter, portrait, and illustration request shapes
- invalid JSON/schema output mapping to `GEMINI_INVALID_OUTPUT`
- image missing/rate-limit/request failure normalization

## Final Verification Commands

Run from the repository root:

```bash
npm run test --workspace backend
npm run test --workspace frontend
npm test
npm run build --workspace frontend
```

Postman artifacts were also parsed as JSON:

```bash
node -e "const fs=require('node:fs'); for (const file of ['postman/Book-Illustration-Studio.postman_collection.json','postman/Local.postman_environment.json']) { JSON.parse(fs.readFileSync(file,'utf8')); console.log(file + ': valid JSON'); }"
```

## Final Test Report

Latest verification run:

- `npm run test --workspace backend`: 8 test files passed, 73 tests passed.
- `npm run test --workspace frontend`: 1 test file passed, 14 tests passed.
- `npm test`: backend 73 tests passed, frontend 14 tests passed.
- `npm run build --workspace frontend`: Vite production build passed.
- Postman collection JSON: valid.
- Postman local environment JSON: valid.

## Live Gemini Smoke Test

Live Gemini testing was run separately from the automated suite with a tiny public-domain excerpt.

Verified live:

- book upload/context reuse
- STYLE step
- CHARACTERS step
- persisted `fileUri`
- persisted `bookInteractionId`
- persisted `styleInteractionId`
- persisted `charactersInteractionId`
- structured character output with no more than 2 characters

Live image testing found and drove two fixes:

- `gemini-3.1-flash-lite-image` is a general image model, but it was not supported for the Interactions API path used by this app, so the app uses the Interactions-supported Nano Banana model `gemini-3.1-flash-image`.
- The Interactions image request rejected the unsupported `delivery` field, so the final image response format is `{ type: "image", mime_type: "image/jpeg" }`.

After those fixes, the corrected `gemini-3.1-flash-image` request reached the real Gemini Interactions API. Actual portrait image generation remains blocked for this test project by HTTP 429 because the project/account has zero Free Tier image quota. That means portrait success was not live-verified. Image bytes, MIME handling, file persistence, per-item progress, and image-chain state are covered by mocked SDK and pipeline tests.
