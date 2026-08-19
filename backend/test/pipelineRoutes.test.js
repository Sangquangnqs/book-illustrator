import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { createFakeGeminiClient } from "../src/services/geminiClient.fake.js";
import { ProjectStorage } from "../src/storage/projectStorage.js";
import { createTempDataDir } from "./helpers/tempDataDir.js";

let temp;
let storage;
let app;
let client;

beforeEach(async () => {
  temp = await createTempDataDir();
  storage = new ProjectStorage({ dataDir: temp.dataDir });
  client = createFakeGeminiClient();
  app = createApp({ storage, sessionSecret: "test-secret", geminiClient: client });
});

afterEach(async () => {
  await temp.cleanup();
});

describe("pipeline routes", () => {
  it("returns running immediately for a newly claimed run", async () => {
    const deferred = createDeferred();
    client = {
      ensureBookContext: async () => ({ fileUri: "files/fake-book", bookInteractionId: "fake-book" }),
      generateStyle: async () => {
        await deferred.promise;
        return { style: "ink wash", gemini: {} };
      }
    };
    app = createApp({ storage, sessionSecret: "test-secret", geminiClient: client });
    const agent = request.agent(app);
    const projectId = await signInAndCreateProject(agent);

    const response = await agent.post(`/api/projects/${projectId}/steps/STYLE/run`).send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      type: "running",
      project: { status: "CREATED", stepState: { status: "running", step: "STYLE" } }
    });

    deferred.resolve();
    await expect(waitForDetail(agent, projectId, (project) => project.status === "STYLE_DONE")).resolves.toMatchObject({
      status: "STYLE_DONE"
    });
  });

  it("polling project detail later sees failed state", async () => {
    client = createFakeGeminiClient({ failures: { generateStyle: "style failed" } });
    app = createApp({ storage, sessionSecret: "test-secret", geminiClient: client });
    const agent = request.agent(app);
    const projectId = await signInAndCreateProject(agent);

    const response = await agent.post(`/api/projects/${projectId}/steps/STYLE/run`).send({});
    const detail = await waitForDetail(agent, projectId, (project) => project.stepState.status === "failed");

    expect(response.body.type).toBe("running");
    expect(detail).toMatchObject({
      status: "CREATED",
      stepState: { status: "failed", step: "STYLE", error: { message: "style failed" } }
    });
  });

  it("duplicate run during async execution makes one fake Gemini call", async () => {
    const deferred = createDeferred();
    let generateStyleCalls = 0;
    client = {
      ensureBookContext: async () => ({ fileUri: "files/fake-book", bookInteractionId: "fake-book" }),
      generateStyle: async () => {
        generateStyleCalls += 1;
        await deferred.promise;
        return { style: "ink wash", gemini: {} };
      }
    };
    app = createApp({ storage, sessionSecret: "test-secret", geminiClient: client });
    const agent = request.agent(app);
    const projectId = await signInAndCreateProject(agent);

    const first = await agent.post(`/api/projects/${projectId}/steps/STYLE/run`).send({});
    const second = await agent.post(`/api/projects/${projectId}/steps/STYLE/run`).send({});

    expect(first.status).toBe(200);
    expect(first.body.type).toBe("running");
    expect(second.status).toBe(202);
    expect(second.body).toMatchObject({ type: "already_running", project: { stepState: { status: "running" } } });
    await waitForCondition(() => generateStyleCalls === 1);
    expect(generateStyleCalls).toBe(1);

    deferred.resolve();
    await waitForDetail(agent, projectId, (project) => project.status === "STYLE_DONE");
  });

  it("returns 404 for another user's project", async () => {
    const owner = request.agent(app);
    const other = request.agent(app);
    const projectId = await signInAndCreateProject(owner);
    await other.post("/api/session").send({ name: "Theo", email: "theo@example.com" });

    const response = await other.post(`/api/projects/${projectId}/steps/STYLE/run`).send({});

    expect(response.status).toBe(404);
  });

  it("rejects out-of-order steps with 409", async () => {
    const agent = request.agent(app);
    const projectId = await signInAndCreateProject(agent);

    const response = await agent.post(`/api/projects/${projectId}/steps/CHARACTERS/run`).send({});

    expect(response.status).toBe(409);
    expect(response.body.error.message).toBe("Step CHARACTERS is not the current step.");
  });

  it("rejects stale running steps on run and allows retry", async () => {
    const agent = request.agent(app);
    const projectId = await signInAndCreateProject(agent);
    app = createApp({
      storage,
      sessionSecret: "test-secret",
      geminiClient: client,
      now: () => new Date("2026-08-19T07:00:00.000Z"),
      staleTimeouts: { STYLE: 10 }
    });
    await storage.updateProject(projectId, (project) => ({
      ...project,
      stepState: {
        status: "running",
        step: "STYLE",
        runId: "old_run",
        startedAt: "2026-08-19T06:00:00.000Z",
        error: null
      }
    }));
    const staleAgent = request.agent(app);
    await staleAgent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });

    const run = await staleAgent.post(`/api/projects/${projectId}/steps/STYLE/run`).send({});
    const retry = await staleAgent.post(`/api/projects/${projectId}/steps/STYLE/retry`).send({});

    expect(run.status).toBe(409);
    expect(run.body.error.message).toBe("This step must be retried explicitly.");
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ type: "running", project: { stepState: { status: "running" } } });
    await expect(waitForDetail(staleAgent, projectId, (project) => project.status === "STYLE_DONE")).resolves.toMatchObject({
      status: "STYLE_DONE"
    });
  });

  it("requires a valid session", async () => {
    const response = await request(app).post(
      "/api/projects/project_00000000-0000-4000-8000-000000000001/steps/STYLE/run"
    );

    expect(response.status).toBe(401);
  });
});

async function signInAndCreateProject(agent) {
  await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });
  const created = await agent.post("/api/projects").send({
    title: "The Wind in the Willows",
    bookText: "The Mole had been working very hard all the morning."
  });
  return created.body.project.id;
}

async function waitForDetail(agent, projectId, predicate) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await agent.get(`/api/projects/${projectId}`);
    if (response.status === 200 && predicate(response.body.project)) {
      return response.body.project;
    }
    await delay(5);
  }

  throw new Error("Timed out waiting for project detail");
}

async function waitForCondition(predicate) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (predicate()) {
      return;
    }
    await delay(5);
  }

  throw new Error("Timed out waiting for condition");
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
