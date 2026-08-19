import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PipelineService } from "../src/pipeline/pipelineService.js";
import { createFakeGeminiClient } from "../src/services/geminiClient.fake.js";
import { ProjectStorage } from "../src/storage/projectStorage.js";
import { createTempDataDir } from "./helpers/tempDataDir.js";

const userEmail = "mira@example.com";

let temp;
let storage;
let now;
let runCounter;

beforeEach(async () => {
  temp = await createTempDataDir();
  storage = new ProjectStorage({ dataDir: temp.dataDir });
  now = new Date("2026-08-19T06:00:00.000Z");
  runCounter = 0;
});

afterEach(async () => {
  await temp.cleanup();
});

describe("PipelineService", () => {
  it("runs all five happy-path transitions in order", async () => {
    const service = createService(createFakeGeminiClient());
    const project = await createProject();

    await expect(runAndWait(service, { projectId: project.id, userEmail, step: "STYLE" })).resolves.toMatchObject({
      status: "STYLE_DONE",
      currentStep: "CHARACTERS",
      style: expect.any(String)
    });
    await expect(runAndWait(service, { projectId: project.id, userEmail, step: "CHARACTERS" })).resolves.toMatchObject({
      status: "CHARACTERS_DONE",
      currentStep: "PORTRAITS"
    });
    await expect(runAndWait(service, { projectId: project.id, userEmail, step: "PORTRAITS" })).resolves.toMatchObject({
      status: "PORTRAITS_DONE",
      currentStep: "CHAPTERS"
    });
    await expect(runAndWait(service, { projectId: project.id, userEmail, step: "CHAPTERS" })).resolves.toMatchObject({
      status: "CHAPTERS_DONE",
      currentStep: "ILLUSTRATIONS"
    });
    const final = await runAndWait(service, { projectId: project.id, userEmail, step: "ILLUSTRATIONS" });

    expect(final).toMatchObject({
      status: "DONE",
      currentStep: null,
      stepState: { status: "idle" }
    });
    expect(final.characters.every((character) => character.image.status === "done")).toBe(true);
    expect(final.chapters.every((chapter) => chapter.image.status === "done")).toBe(true);
  });

  it("rejects out-of-order steps", async () => {
    const service = createService(createFakeGeminiClient());
    const project = await createProject();

    await expect(
      service.runStep({ projectId: project.id, userEmail, step: "CHARACTERS" })
    ).rejects.toMatchObject({
      status: 409,
      code: "STEP_OUT_OF_ORDER"
    });
  });

  it("deduplicates simultaneous run requests before calling Gemini", async () => {
    const deferred = createDeferred();
    let generateStyleCalls = 0;
    const client = {
      ensureBookContext: async () => ({ fileUri: "files/fake-book", bookInteractionId: "fake-book" }),
      generateStyle: async () => {
        generateStyleCalls += 1;
        await deferred.promise;
        return { style: "ink wash", gemini: {} };
      }
    };
    const service = createService(client);
    const project = await createProject();

    const first = await service.runStep({ projectId: project.id, userEmail, step: "STYLE" });
    const second = await service.runStep({ projectId: project.id, userEmail, step: "STYLE" });

    expect(first).toMatchObject({ type: "running", project: { stepState: { status: "running" } } });
    expect(second).toMatchObject({ type: "already_running", project: { stepState: { status: "running" } } });
    await waitForCondition(() => generateStyleCalls === 1);
    expect(generateStyleCalls).toBe(1);

    deferred.resolve();
    await expect(waitForProject(service, project.id, (stored) => stored.status === "STYLE_DONE")).resolves.toMatchObject({
      status: "STYLE_DONE"
    });
  });

  it("returns the persisted running state without another Gemini call", async () => {
    const client = createFakeGeminiClient();
    const service = createService(client);
    const project = await createProject();
    await storage.updateProject(project.id, (current) => ({
      ...current,
      stepState: runningState("STYLE", "run_existing")
    }));

    const result = await service.runStep({ projectId: project.id, userEmail, step: "STYLE" });

    expect(result).toMatchObject({
      type: "already_running",
      project: { stepState: { status: "running", runId: "run_existing" } }
    });
    expect(client.count("generateStyle")).toBe(0);
  });

  it("persists failed steps and requires retry", async () => {
    const service = createService(createFakeGeminiClient({ failures: { generateStyle: "style failed" } }));
    const project = await createProject();

    const started = await service.runStep({ projectId: project.id, userEmail, step: "STYLE" });
    const failed = await waitForProject(service, project.id, (stored) => stored.stepState.status === "failed");

    expect(started.type).toBe("running");
    expect(failed).toMatchObject({
      stepState: { status: "failed", step: "STYLE", error: { message: "style failed" } }
    });
    await expect(service.runStep({ projectId: project.id, userEmail, step: "STYLE" })).rejects.toMatchObject({
      code: "FAILED_RETRY_REQUIRED"
    });
  });

  it("requires explicit retry for stale running steps", async () => {
    const service = createService(createFakeGeminiClient());
    const project = await createProject();
    await storage.updateProject(project.id, (current) => ({
      ...current,
      stepState: runningState("STYLE", "run_old", "2026-08-19T05:00:00.000Z")
    }));

    await expect(service.runStep({ projectId: project.id, userEmail, step: "STYLE" })).rejects.toMatchObject({
      code: "STALE_RETRY_REQUIRED"
    });
    expect(service.viewProject(await storage.readProject(project.id)).stepState.status).toBe("stale");
  });

  it("creates a new runId when retrying", async () => {
    const service = createService(createFakeGeminiClient({ style: "charcoal" }));
    const project = await createProject();
    await storage.updateProject(project.id, (current) => ({
      ...current,
      stepState: {
        status: "failed",
        step: "STYLE",
        runId: "run_failed",
        startedAt: "2026-08-19T05:59:00.000Z",
        error: { message: "failed", code: "STEP_FAILED" }
      }
    }));

    const retry = await service.retryStep({ projectId: project.id, userEmail, step: "STYLE" });
    const result = await waitForProject(service, project.id, (stored) => stored.status === "STYLE_DONE");

    expect(retry).toMatchObject({ type: "running", project: { stepState: { runId: "run_1" } } });
    expect(result).toMatchObject({ status: "STYLE_DONE", style: "charcoal", stepState: { runId: null } });
  });

  it("does not let an old success completion overwrite newer retry state", async () => {
    const deferred = createDeferred();
    const service = createService({
      ensureBookContext: async () => ({ fileUri: "files/fake-book", bookInteractionId: "fake-book" }),
      generateStyle: async () => {
        await deferred.promise;
        return { style: "old style", gemini: {} };
      }
    });
    const project = await createProject();

    await service.runStep({ projectId: project.id, userEmail, step: "STYLE" });
    await waitForProject(service, project.id, (stored) => stored.stepState.status === "running");
    await storage.updateProject(project.id, (current) => ({
      ...current,
      stepState: runningState("STYLE", "run_new", "2026-08-19T07:00:00.000Z")
    }));

    deferred.resolve();
    await delay(20);

    const stored = await storage.readProject(project.id);
    expect(stored.status).toBe("CREATED");
    expect(stored.stepState).toMatchObject({ status: "running", runId: "run_new" });
    expect(stored.style).toBe(null);
  });

  it("does not let an old failure completion overwrite newer retry state", async () => {
    const deferred = createDeferred();
    const service = createService({
      ensureBookContext: async () => ({ fileUri: "files/fake-book", bookInteractionId: "fake-book" }),
      generateStyle: async () => {
        await deferred.promise;
        throw new Error("old failure");
      }
    });
    const project = await createProject();

    await service.runStep({ projectId: project.id, userEmail, step: "STYLE" });
    await waitForProject(service, project.id, (stored) => stored.stepState.status === "running");
    await storage.updateProject(project.id, (current) => ({
      ...current,
      stepState: runningState("STYLE", "run_new", "2026-08-19T07:00:00.000Z")
    }));

    deferred.resolve();
    await delay(20);

    const stored = await storage.readProject(project.id);
    expect(stored.stepState).toMatchObject({ status: "running", runId: "run_new", error: null });
  });

  it("preserves a successful portrait and skips it when retrying the failed portrait", async () => {
    let char2Attempts = 0;
    const client = createFakeGeminiClient({
      failures: {
        generatePortrait: ({ character }) => {
          if (character.id === "char_2" && char2Attempts === 0) {
            char2Attempts += 1;
            return "portrait failed";
          }
          return false;
        }
      }
    });
    const service = createService(client);
    const project = await createProject();
    await runAndWait(service, { projectId: project.id, userEmail, step: "STYLE" });
    await runAndWait(service, { projectId: project.id, userEmail, step: "CHARACTERS" });

    const failed = await runAndWait(service, { projectId: project.id, userEmail, step: "PORTRAITS" }, (stored) =>
      stored.stepState.status === "failed"
    );

    expect(failed.characters[0].image).toMatchObject({ status: "done", path: "portraits/char_1_run_3.png" });
    expect(failed.characters[1].image).toMatchObject({ status: "failed" });

    const retryStarted = await service.retryStep({ projectId: project.id, userEmail, step: "PORTRAITS" });
    const retried = await waitForProject(service, project.id, (stored) => stored.status === "PORTRAITS_DONE");

    expect(retryStarted).toMatchObject({ type: "running" });
    expect(retried.characters.every((character) => character.image.status === "done")).toBe(true);
    expect(client.calls.filter((call) => call.method === "generatePortrait" && call.input.character.id === "char_1"))
      .toHaveLength(1);
    expect(client.calls.filter((call) => call.method === "generatePortrait" && call.input.character.id === "char_2"))
      .toHaveLength(2);
  });

  it("stops a superseded image run before making another expensive image call", async () => {
    let projectId;
    let portraitCalls = 0;
    const client = createFakeGeminiClient();
    client.generatePortrait = async ({ character }) => {
      portraitCalls += 1;
      if (character.id === "char_1") {
        await storage.updateProject(projectId, (project) => ({
          ...project,
          stepState: runningState("PORTRAITS", "run_new")
        }));
      }
      return { bytes: Buffer.from(`portrait ${character.id}`) };
    };
    const service = createService(client);
    const project = await createProject();
    projectId = project.id;
    await runAndWait(service, { projectId, userEmail, step: "STYLE" });
    await runAndWait(service, { projectId, userEmail, step: "CHARACTERS" });

    await service.runStep({ projectId, userEmail, step: "PORTRAITS" });
    await delay(80);

    expect(portraitCalls).toBe(1);
    await expect(storage.readProject(projectId)).resolves.toMatchObject({
      status: "CHARACTERS_DONE",
      stepState: { status: "running", runId: "run_new" }
    });
  });

  it("does not let stale image results overwrite a newer retry file path", async () => {
    const deferred = createDeferred();
    const service = createService({
      ensureBookContext: async () => ({ fileUri: "files/fake-book", bookInteractionId: "fake-book" }),
      generatePortrait: async () => {
        await deferred.promise;
        return { bytes: Buffer.from("old portrait") };
      }
    });
    const project = await createProject();
    await storage.updateProject(project.id, (current) => ({
      ...current,
      status: "CHARACTERS_DONE",
      characters: [
        {
          id: "char_1",
          name: "Mole",
          prompt: "Mole prompt",
          image: { status: "pending", path: null, error: null }
        }
      ],
      stepState: idleState()
    }));

    await service.runStep({ projectId: project.id, userEmail, step: "PORTRAITS" });
    await waitForProject(service, project.id, (stored) => stored.characters[0].image.status === "running");
    await storage.updateProject(project.id, (current) => ({
      ...current,
      stepState: runningState("PORTRAITS", "run_new"),
      characters: [
        {
          ...current.characters[0],
          image: { status: "done", path: "portraits/char_1_run_new.png", error: null }
        }
      ]
    }));

    deferred.resolve();
    await delay(40);

    await expect(storage.readProject(project.id)).resolves.toMatchObject({
      characters: [{ image: { status: "done", path: "portraits/char_1_run_new.png" } }]
    });
  });

  it("calls ensureBookContext once and reuses persisted context", async () => {
    const client = createFakeGeminiClient();
    const service = createService(client);
    const project = await createProject();

    await runAndWait(service, { projectId: project.id, userEmail, step: "STYLE" });
    await runAndWait(service, { projectId: project.id, userEmail, step: "CHARACTERS" });

    const stored = await storage.readProject(project.id);
    expect(client.count("ensureBookContext")).toBe(1);
    expect(stored.gemini).toMatchObject({
      fileUri: "files/fake-book",
      bookInteractionId: "fake-book-interaction"
    });
  });

  it("fails oversized character output instead of truncating", async () => {
    const service = createService(
      createFakeGeminiClient({
        characters: [
          { name: "One", prompt: "One prompt" },
          { name: "Two", prompt: "Two prompt" },
          { name: "Three", prompt: "Three prompt" }
        ]
      })
    );
    const project = await createProject();
    await runAndWait(service, { projectId: project.id, userEmail, step: "STYLE" });

    const result = await runAndWait(service, { projectId: project.id, userEmail, step: "CHARACTERS" }, (stored) =>
      stored.stepState.status === "failed"
    );

    expect(result).toMatchObject({
      status: "STYLE_DONE",
      stepState: { status: "failed", step: "CHARACTERS" }
    });
    expect(result.characters).toEqual([]);
  });

  it("fails oversized chapter output instead of truncating", async () => {
    const service = createService(
      createFakeGeminiClient({
        chapters: [
          { name: "One", prompt: "One prompt" },
          { name: "Two", prompt: "Two prompt" }
        ]
      })
    );
    const project = await createProject();
    await runAndWait(service, { projectId: project.id, userEmail, step: "STYLE" });
    await runAndWait(service, { projectId: project.id, userEmail, step: "CHARACTERS" });
    await runAndWait(service, { projectId: project.id, userEmail, step: "PORTRAITS" });

    const result = await runAndWait(service, { projectId: project.id, userEmail, step: "CHAPTERS" }, (stored) =>
      stored.stepState.status === "failed"
    );

    expect(result).toMatchObject({
      status: "PORTRAITS_DONE",
      stepState: { status: "failed", step: "CHAPTERS" }
    });
    expect(result.chapters).toEqual([]);
  });
});

function createService(client) {
  return new PipelineService({
    storage,
    geminiClient: client,
    now: () => now,
    staleTimeouts: {
      STYLE: 60_000,
      CHARACTERS: 60_000,
      PORTRAITS: 60_000,
      CHAPTERS: 60_000,
      ILLUSTRATIONS: 60_000
    },
    runIdFactory: () => `run_${++runCounter}`
  });
}

async function createProject() {
  return storage.createProject({
    id: "project_00000000-0000-4000-8000-000000000001",
    userEmail,
    title: "The Wind in the Willows",
    bookText: "The Mole had been working very hard all the morning."
  });
}

async function runAndWait(service, args, isDone = (stored) => stored.stepState.status !== "running") {
  const started = await service.runStep(args);
  expect(started).toMatchObject({ type: "running", project: { stepState: { status: "running" } } });
  return waitForProject(service, args.projectId, isDone);
}

async function waitForProject(service, projectId, predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const project = service.viewProject(await storage.readProject(projectId));
    if (predicate(project)) {
      return project;
    }
    await delay(10);
  }

  throw new Error("Timed out waiting for project state");
}

async function waitForCondition(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) {
      return;
    }
    await delay(10);
  }

  throw new Error("Timed out waiting for condition");
}

function runningState(step, runId, startedAt = "2026-08-19T06:00:00.000Z") {
  return {
    status: "running",
    step,
    runId,
    startedAt,
    error: null
  };
}

function idleState() {
  return {
    status: "idle",
    step: null,
    runId: null,
    startedAt: null,
    error: null
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
