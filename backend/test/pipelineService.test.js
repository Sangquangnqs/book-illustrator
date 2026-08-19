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
    const client = createFakeGeminiClient();
    const service = createService(client);
    const project = await createProject();

    await expect(service.runStep({ projectId: project.id, userEmail, step: "STYLE" })).resolves.toMatchObject({
      type: "completed",
      project: { status: "STYLE_DONE", currentStep: "CHARACTERS", style: expect.any(String) }
    });
    await expect(
      service.runStep({ projectId: project.id, userEmail, step: "CHARACTERS" })
    ).resolves.toMatchObject({
      type: "completed",
      project: { status: "CHARACTERS_DONE", currentStep: "PORTRAITS" }
    });
    await expect(service.runStep({ projectId: project.id, userEmail, step: "PORTRAITS" })).resolves.toMatchObject({
      type: "completed",
      project: { status: "PORTRAITS_DONE", currentStep: "CHAPTERS" }
    });
    await expect(service.runStep({ projectId: project.id, userEmail, step: "CHAPTERS" })).resolves.toMatchObject({
      type: "completed",
      project: { status: "CHAPTERS_DONE", currentStep: "ILLUSTRATIONS" }
    });
    const final = await service.runStep({ projectId: project.id, userEmail, step: "ILLUSTRATIONS" });

    expect(final).toMatchObject({
      type: "completed",
      project: { status: "DONE", currentStep: null, stepState: { status: "idle" } }
    });
    expect(final.project.characters.every((character) => character.image.status === "done")).toBe(true);
    expect(final.project.chapters.every((chapter) => chapter.image.status === "done")).toBe(true);
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
      generateStyle: async () => {
        generateStyleCalls += 1;
        await deferred.promise;
        return { style: "ink wash", gemini: {} };
      }
    };
    const service = createService(client);
    const project = await createProject();

    const first = service.runStep({ projectId: project.id, userEmail, step: "STYLE" });
    await waitFor(() => generateStyleCalls === 1);
    const second = await service.runStep({ projectId: project.id, userEmail, step: "STYLE" });

    expect(second).toMatchObject({ type: "already_running", project: { stepState: { status: "running" } } });
    deferred.resolve();
    await expect(first).resolves.toMatchObject({ type: "completed", project: { status: "STYLE_DONE" } });
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
    const client = createFakeGeminiClient({ failures: { generateStyle: "style failed" } });
    const service = createService(client);
    const project = await createProject();

    const failed = await service.runStep({ projectId: project.id, userEmail, step: "STYLE" });

    expect(failed).toMatchObject({
      type: "failed",
      project: { stepState: { status: "failed", step: "STYLE", error: { message: "style failed" } } }
    });
    await expect(service.runStep({ projectId: project.id, userEmail, step: "STYLE" })).rejects.toMatchObject({
      code: "FAILED_RETRY_REQUIRED"
    });
  });

  it("requires explicit retry for stale running steps", async () => {
    const client = createFakeGeminiClient();
    const service = createService(client);
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
    const client = createFakeGeminiClient({ style: "charcoal" });
    const service = createService(client);
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

    const result = await service.retryStep({ projectId: project.id, userEmail, step: "STYLE" });

    expect(result).toMatchObject({ type: "completed", project: { status: "STYLE_DONE", style: "charcoal" } });
    expect(result.project.stepState.runId).toBe(null);
    expect(runCounter).toBe(1);
  });

  it("does not let an old success completion overwrite newer retry state", async () => {
    const deferred = createDeferred();
    const client = {
      generateStyle: async () => {
        await deferred.promise;
        return { style: "old style", gemini: {} };
      }
    };
    const service = createService(client);
    const project = await createProject();

    const oldRun = service.runStep({ projectId: project.id, userEmail, step: "STYLE" });
    await waitFor(async () => (await storage.readProject(project.id)).stepState.status === "running");
    now = new Date("2026-08-19T07:00:00.000Z");
    await storage.updateProject(project.id, (current) => ({
      ...current,
      stepState: runningState("STYLE", "run_new", "2026-08-19T07:00:00.000Z")
    }));

    deferred.resolve();
    await oldRun;

    const stored = await storage.readProject(project.id);
    expect(stored.status).toBe("CREATED");
    expect(stored.stepState).toMatchObject({ status: "running", runId: "run_new" });
    expect(stored.style).toBe(null);
  });

  it("does not let an old failure completion overwrite newer retry state", async () => {
    const deferred = createDeferred();
    const client = {
      generateStyle: async () => {
        await deferred.promise;
        throw new Error("old failure");
      }
    };
    const service = createService(client);
    const project = await createProject();

    const oldRun = service.runStep({ projectId: project.id, userEmail, step: "STYLE" });
    await waitFor(async () => (await storage.readProject(project.id)).stepState.status === "running");
    await storage.updateProject(project.id, (current) => ({
      ...current,
      stepState: runningState("STYLE", "run_new", "2026-08-19T07:00:00.000Z")
    }));

    deferred.resolve();
    await oldRun;

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
    await service.runStep({ projectId: project.id, userEmail, step: "STYLE" });
    await service.runStep({ projectId: project.id, userEmail, step: "CHARACTERS" });

    const failed = await service.runStep({ projectId: project.id, userEmail, step: "PORTRAITS" });

    expect(failed.project.characters[0].image).toMatchObject({ status: "done", path: "portraits/char_1.png" });
    expect(failed.project.characters[1].image).toMatchObject({ status: "failed" });

    const retried = await service.retryStep({ projectId: project.id, userEmail, step: "PORTRAITS" });

    expect(retried.project.status).toBe("PORTRAITS_DONE");
    expect(retried.project.characters.every((character) => character.image.status === "done")).toBe(true);
    expect(client.calls.filter((call) => call.method === "generatePortrait" && call.input.character.id === "char_1"))
      .toHaveLength(1);
    expect(client.calls.filter((call) => call.method === "generatePortrait" && call.input.character.id === "char_2"))
      .toHaveLength(2);
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
    await service.runStep({ projectId: project.id, userEmail, step: "STYLE" });

    const result = await service.runStep({ projectId: project.id, userEmail, step: "CHARACTERS" });

    expect(result).toMatchObject({
      type: "failed",
      project: { status: "STYLE_DONE", stepState: { status: "failed", step: "CHARACTERS" } }
    });
    expect(result.project.characters).toEqual([]);
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
    await service.runStep({ projectId: project.id, userEmail, step: "STYLE" });
    await service.runStep({ projectId: project.id, userEmail, step: "CHARACTERS" });
    await service.runStep({ projectId: project.id, userEmail, step: "PORTRAITS" });

    const result = await service.runStep({ projectId: project.id, userEmail, step: "CHAPTERS" });

    expect(result).toMatchObject({
      type: "failed",
      project: { status: "PORTRAITS_DONE", stepState: { status: "failed", step: "CHAPTERS" } }
    });
    expect(result.project.chapters).toEqual([]);
  });
});

function createService(client) {
  return new PipelineService({
    storage,
    geminiClient: client,
    now: () => now,
    staleTimeouts: {
      STYLE: 10,
      CHARACTERS: 10,
      PORTRAITS: 10,
      CHAPTERS: 10,
      ILLUSTRATIONS: 10
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

function runningState(step, runId, startedAt = "2026-08-19T06:00:00.000Z") {
  return {
    status: "running",
    step,
    runId,
    startedAt,
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

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 5);
    });
  }

  throw new Error("Timed out waiting for condition");
}
