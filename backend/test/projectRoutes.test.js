import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ProjectStorage } from "../src/storage/projectStorage.js";
import { createTempDataDir } from "./helpers/tempDataDir.js";

let temp;
let storage;
let app;

beforeEach(async () => {
  temp = await createTempDataDir();
  storage = new ProjectStorage({ dataDir: temp.dataDir });
  app = createApp({ storage, sessionSecret: "test-secret" });
});

afterEach(async () => {
  await temp.cleanup();
});

describe("project routes", () => {
  it("rejects malformed project IDs before project lookup", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });

    const detail = await agent.get("/api/projects/not-a-safe-id");
    const book = await agent.get("/api/projects/not-a-safe-id/book");
    const image = await agent.get("/api/projects/not-a-safe-id/images/portraits/char_1.png");

    expect(detail.status).toBe(400);
    expect(book.status).toBe(400);
    expect(image.status).toBe(400);
  });

  it("rejects traversal-like project IDs before project lookup", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });

    const detail = await agent.get("/api/projects/..%2Fproject_123");
    const book = await agent.get("/api/projects/..%2Fproject_123/book");
    const image = await agent.get("/api/projects/..%2Fproject_123/images/portraits/char_1.png");

    expect(detail.status).toBe(400);
    expect(book.status).toBe(400);
    expect(image.status).toBe(400);
  });

  it("lists only the signed-in user's projects", async () => {
    const mira = request.agent(app);
    const theo = request.agent(app);

    await mira.post("/api/session").send({ name: "Mira", email: "mira@example.com" });
    await theo.post("/api/session").send({ name: "Theo", email: "theo@example.com" });
    await mira.post("/api/projects").send({ title: "Mira Book", bookText: "Mira text" });
    await theo.post("/api/projects").send({ title: "Theo Book", bookText: "Theo text" });

    const response = await mira.get("/api/projects");

    expect(response.status).toBe(200);
    expect(response.body.projects).toHaveLength(1);
    expect(response.body.projects[0]).toMatchObject({
      title: "Mira Book",
      status: "CREATED",
      currentStep: "STYLE",
      progress: { completed: 0, total: 5 }
    });
  });

  it("creates a project from pasted book text", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });

    const response = await agent.post("/api/projects").send({
      title: "The Wind in the Willows",
      bookText: "The Mole had been working very hard all the morning."
    });

    expect(response.status).toBe(201);
    expect(response.body.project).toMatchObject({
      title: "The Wind in the Willows",
      userEmail: "mira@example.com",
      status: "CREATED",
      currentStep: "STYLE"
    });
    await expect(storage.readBookText(response.body.project.id)).resolves.toBe(
      "The Mole had been working very hard all the morning."
    );
  });

  it("creates a project from a .txt upload", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });

    const response = await agent
      .post("/api/projects")
      .field("title", "Uploaded Book")
      .attach("bookFile", Buffer.from("Uploaded book text"), "book.txt");

    expect(response.status).toBe(201);
    expect(response.body.project.title).toBe("Uploaded Book");
    await expect(storage.readBookText(response.body.project.id)).resolves.toBe("Uploaded book text");
  });

  it("requires exactly one of pasted bookText or uploaded .txt", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });

    const neither = await agent.post("/api/projects").send({ title: "No text" });
    const both = await agent
      .post("/api/projects")
      .field("title", "Too much")
      .field("bookText", "Pasted")
      .attach("bookFile", Buffer.from("Uploaded"), "book.txt");

    expect(neither.status).toBe(400);
    expect(both.status).toBe(400);
  });

  it("rejects non-.txt uploads", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });

    const response = await agent
      .post("/api/projects")
      .field("title", "Bad upload")
      .attach("bookFile", Buffer.from("Nope"), "book.pdf");

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Only .txt uploads are supported.");
  });

  it("rejects empty .txt uploads after trimming", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });

    const response = await agent
      .post("/api/projects")
      .field("title", "Empty upload")
      .attach("bookFile", Buffer.from("   \n\t  "), "book.txt");

    expect(response.status).toBe(400);
  });

  it("maps oversized uploads to a client error", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });

    const response = await agent
      .post("/api/projects")
      .field("title", "Too large")
      .attach("bookFile", Buffer.alloc(2 * 1024 * 1024 + 1), "book.txt");

    expect(response.status).toBe(413);
    expect(response.body.error.message).toBe("Uploaded file is too large.");
  });

  it("maps unexpected upload fields to a client error", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });

    const response = await agent
      .post("/api/projects")
      .field("title", "Wrong field")
      .attach("otherFile", Buffer.from("Book text"), "book.txt");

    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe("Invalid file upload.");
  });

  it("returns 404 when requesting another user's image", async () => {
    const mira = request.agent(app);
    const theo = request.agent(app);

    await mira.post("/api/session").send({ name: "Mira", email: "mira@example.com" });
    await theo.post("/api/session").send({ name: "Theo", email: "theo@example.com" });
    const created = await mira.post("/api/projects").send({
      title: "Image Book",
      bookText: "Image text"
    });
    const projectId = created.body.project.id;
    const imageDir = path.join(storage.projectDir(projectId), "images", "portraits");
    await mkdir(imageDir, { recursive: true });
    await writeFile(path.join(imageDir, "char_1.png"), "fake image bytes");

    const response = await theo.get(`/api/projects/${projectId}/images/portraits/char_1.png`);

    expect(response.status).toBe(404);
  });

  it("loads owned project detail and book text", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });
    const created = await agent.post("/api/projects").send({
      title: "Detail Book",
      bookText: "Full detail text"
    });

    const detail = await agent.get(`/api/projects/${created.body.project.id}`);
    const book = await agent.get(`/api/projects/${created.body.project.id}/book`);

    expect(detail.status).toBe(200);
    expect(detail.body.project.title).toBe("Detail Book");
    expect(book.status).toBe(200);
    expect(book.body.bookText).toBe("Full detail text");
  });

  it("returns 404 for projects not owned by the signed-in user", async () => {
    const mira = request.agent(app);
    const theo = request.agent(app);

    await mira.post("/api/session").send({ name: "Mira", email: "mira@example.com" });
    await theo.post("/api/session").send({ name: "Theo", email: "theo@example.com" });
    const created = await mira.post("/api/projects").send({
      title: "Private Book",
      bookText: "Private text"
    });

    const response = await theo.get(`/api/projects/${created.body.project.id}`);

    expect(response.status).toBe(404);
  });

  it("serves owned image files from safe project-scoped paths", async () => {
    const agent = request.agent(app);
    await agent.post("/api/session").send({ name: "Mira", email: "mira@example.com" });
    const created = await agent.post("/api/projects").send({
      title: "Image Book",
      bookText: "Image text"
    });
    const projectId = created.body.project.id;
    const imageDir = path.join(storage.projectDir(projectId), "images", "portraits");
    await mkdir(imageDir, { recursive: true });
    await writeFile(path.join(imageDir, "char_1.png"), "fake image bytes");

    const response = await agent.get(`/api/projects/${projectId}/images/portraits/char_1.png`);
    const traversal = await agent.get(`/api/projects/${projectId}/images/portraits/..%2Fbook.txt`);

    expect(response.status).toBe(200);
    expect(response.text).toBe("fake image bytes");
    expect(traversal.status).toBe(400);
  });

  it("requires a valid session for project routes", async () => {
    const response = await request(app).get("/api/projects");

    expect(response.status).toBe(401);
  });
});
