# Decisions

## Use per-project JSON instead of SQLite

The initial stack idea used local JSON and files, and we challenged it against SQLite because SQLite would give stronger built-in write safety and transactions. I kept JSON because this is a local, single-process assessment and the data is naturally project-shaped: one user record, one project folder, one `project.json`, one `book.txt`, and generated images. The cost is that JSON has no database transaction layer, so the storage helper has to do real work: per-project mutexes, shared `users.json` serialization, guarded `ensureReady()` initialization, and temp-file plus rename for atomic JSON replacement. During review, an attempted Windows `copyFile()` fallback was rejected because it weakened the atomic replacement guarantee; if rename retries fail, the write should fail and preserve the previous valid file.

## Persist pipeline progress and derive stale recovery

The first architecture draft included both `startedAt` and `heartbeatAt`. We questioned whether a heartbeat loop solved enough in a local single-process app to justify the extra moving parts. We decided to persist `status`, `currentStep`, and `stepState` with `runId` and `startedAt`, then derive stale state when a running step is older than a conservative timeout. We also changed `/run` and `/retry` to claim the step, persist `running`, return immediately, and continue Gemini work in-process while the frontend polls project detail. The trade-off is that a very slow live request could look stale after the timeout, but this is much simpler than queues, workers, heartbeat infrastructure, SSE, or WebSockets.

## Prevent duplicate and stale execution with atomic claiming and `runId`

The backend, not the browser, prevents duplicate Gemini calls. A step is claimed under the per-project mutex before expensive work starts, and the persisted running state includes the current `runId`. If a user double-clicks, refreshes, or opens a second tab, another `/run` sees the same non-stale running step and returns the existing in-flight state instead of starting another call. Retry creates a new `runId`, and every completion checks that the stored `runId` still matches before writing success or failure. During review, we also tightened image work so superseded runs check `runId` before expensive image calls, after Gemini returns, and before writing image bytes; image filenames include the run ID so an old run cannot overwrite a newer retry.

## Use a signed HttpOnly email cookie for lightweight identity

The first session proposal used an unsigned email cookie. I pushed back because changing that cookie in the browser would let someone impersonate another email and break project isolation. We compared an unsigned cookie, an opaque session token, JWT/session storage, and a signed cookie. We chose a signed email cookie using `SESSION_SECRET`, Node `crypto` HMAC, `crypto.timingSafeEqual`, and HttpOnly/SameSite cookie flags, while still checking project ownership on every project-scoped route. The `cookie` package is only used for parsing and serialization. This is intentionally lightweight identity for a local assessment, not proof that the user owns the email address.

## Use the official Gemini SDK behind an app-level wrapper

The assessment allowed REST or an official SDK. We checked the current Gemini docs and the notebook mechanics, then chose the official `@google/genai` JavaScript SDK because it maps well to the required pieces: file upload, structured output, stored interactions, context chaining, and image generation. The SDK version is pinned, and provider-specific code stays inside a small `geminiClient` wrapper. The pipeline depends only on app-level methods, so automated tests use a fake or mocked client without spending Gemini quota. The trade-off is less raw HTTP transparency, but the wrapper keeps the SDK boundary contained and easier to debug or replace.

## Enforce the real Gemini generation contract

The first architecture draft considered silently truncating oversized Gemini output to satisfy the 2-character and 1-chapter caps. We rejected that because the caps are hard assessment requirements, not a UI preference. The final design asks for the limits in the prompt, encodes them in Gemini structured-output schemas, validates again with Zod on the backend, and fails invalid or oversized output instead of salvaging it. Live image testing also corrected assumptions from AI/reference output: `gemini-3.1-flash-lite-image` was unsuitable for the Interactions API path, so we switched to `gemini-3.1-flash-image`; the unsupported image `delivery` field was removed; and the unnecessary pre-portrait image-context starter was removed so portrait 1 starts the image chain and later images chain from `latestImageInteractionId`. The trade-off is being stricter and slightly deviating from notebook details when the current API contract requires it.

## If I had one more day

I would add a small visible attempt history for each step. It would make retries and failures easier to explain during review without changing the core architecture.
