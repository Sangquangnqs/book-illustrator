# Decisions

## Use `startedAt` instead of `heartbeatAt` for stale recovery

The first architecture draft included both `startedAt` and `heartbeatAt` for running steps. We questioned whether a heartbeat solved a real correctness problem in a local single-process app. We decided to remove `heartbeatAt` and treat a running step as stale when its `startedAt` is older than a conservative per-step timeout. We kept `runId` as the guard that prevents an old Gemini response from overwriting a newer retry. The trade-off is less precision: a very slow but still-alive request could look stale after the timeout, so the timeout needs to be generous.

## Use per-project JSON instead of SQLite

The initial idea was to use local JSON/file-based storage. We compared that against SQLite because SQLite would provide stronger write safety and transactions. We decided to keep per-project JSON because the app is local, single-process, small in scope, and the stored data is naturally project-shaped. To reduce the risk, all project writes will go through a small storage helper with a per-project mutex and atomic temp-file rename. The trade-off is that JSON gives us less built-in protection than SQLite, so our storage helper has to be boring and correct.

## Serialize shared `users.json` writes too

The first Milestone 2 implementation protected per-project `project.json` updates with a mutex. During review I noticed that `users.json` is also shared mutable state, and its read-modify-write path was not serialized. Atomic writes prevent partial or corrupt files, but they do not prevent one overlapping update from overwriting another. We changed the storage design to serialize `users.json` mutations with a small shared queue. The regression test for concurrent project creation also exposed an initialization race, so `ensureReady()` is now guarded with a shared promise. Cost: a little more coordination code in storage, but it keeps the JSON approach safe enough for this local single-process app.

## Use a signed email cookie for lightweight identity

The first session proposal used an unsigned email cookie. I pushed back because changing that cookie in the browser would let someone pretend to be another email and break project isolation. We compared an unsigned cookie, an opaque session token, JWT/session storage, and a signed cookie. We chose a signed email cookie using `SESSION_SECRET`, Node `crypto` HMAC, and server-side ownership checks on every project route. The `cookie` package is only used for parsing and serialization. Trade-off: this is still lightweight identity for a local assessment, not proof that the user owns the email address.

## Use the official Gemini JavaScript SDK behind a wrapper

The assessment allows either REST or an official SDK. The earlier architecture left that open. We checked the current Gemini docs and the notebook behavior, then decided to use the official `@google/genai` JavaScript SDK because it maps closely to the notebook concepts: file upload, structured output, interactions/context chaining, and image generation. We will pin the SDK version and keep SDK-specific code inside a small `geminiClient` wrapper. The trade-off is relying on SDK behavior instead of raw HTTP transparency, but the wrapper gives us a contained place to debug or swap approaches if needed.

## Validate Gemini caps instead of silently truncating

The first architecture draft said the backend could cap oversized Gemini responses after parsing. We questioned whether silently slicing results was the right behavior for hard assessment limits. We decided to enforce the 2-character and 1-chapter caps in three places: the prompt, the structured-output schema using array limits, and backend validation. If Gemini still returns an invalid shape or too many items, the step fails and can be retried by the user. The trade-off is that a step may fail even when we could have salvaged part of the output, but it keeps the contract explicit and avoids quietly dropping generated content.

## If I had one more day

I would add a small visible attempt history for each step. It would make retries and failures easier to explain during review without changing the core architecture.
