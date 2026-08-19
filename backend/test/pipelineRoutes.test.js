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
  it("runs the current step for the signed-in project owner", async () => {
    const agent = request.agent(app);
    const projectId = await signInAndCreateProject(agent);

    const response = await agent.post(`/api/projects/${projectId}/steps/STYLE/run`).send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      type: "completed",
      project: { status: "STYLE_DONE", currentStep: "CHARACTERS" }
    });
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
    expect(retry.body).toMatchObject({ type: "completed", project: { status: "STYLE_DONE" } });
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
