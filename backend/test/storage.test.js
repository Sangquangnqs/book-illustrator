import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStorage } from "../src/storage/projectStorage.js";
import { writeJsonAtomic } from "../src/storage/jsonFile.js";
import { createTempDataDir } from "./helpers/tempDataDir.js";

let temp;

beforeEach(async () => {
  temp = await createTempDataDir();
});

afterEach(async () => {
  await temp.cleanup();
});

describe("ProjectStorage", () => {
  it("creates and reads project state in a temporary data directory", async () => {
    const storage = new ProjectStorage({ dataDir: temp.dataDir });

    const project = await storage.createProject({
      id: "project_1",
      userEmail: "Mira@Example.com",
      title: "The Wind in the Willows",
      bookText: "The Mole had been working very hard all the morning."
    });

    expect(project).toMatchObject({
      id: "project_1",
      userEmail: "mira@example.com",
      title: "The Wind in the Willows",
      status: "CREATED",
      currentStep: "STYLE"
    });

    await expect(storage.readBookText("project_1")).resolves.toBe(
      "The Mole had been working very hard all the morning."
    );
    await expect(storage.readProject("project_1")).resolves.toMatchObject({
      id: "project_1",
      currentStep: "STYLE"
    });
  });

  it("creates the local data directory and project folder", async () => {
    const storage = new ProjectStorage({ dataDir: temp.dataDir });

    await storage.createProject({
      id: "project_1",
      userEmail: "mira@example.com",
      title: "The Wind in the Willows",
      bookText: "Book text"
    });

    await expect(readFile(path.join(temp.dataDir, "users.json"), "utf8")).resolves.toContain(
      "mira@example.com"
    );
    await expect(
      readFile(path.join(temp.dataDir, "projects", "project_1", "project.json"), "utf8")
    ).resolves.toContain("The Wind in the Willows");
    await expect(
      readFile(path.join(temp.dataDir, "projects", "project_1", "book.txt"), "utf8")
    ).resolves.toBe("Book text");
  });

  it("writes JSON atomically without leaving temp files after success", async () => {
    const target = path.join(temp.dataDir, "project.json");

    await writeJsonAtomic(target, { value: 1 });
    await writeJsonAtomic(target, { value: 2 });

    await expect(readFile(target, "utf8")).resolves.toContain('"value": 2');
    const files = await import("node:fs/promises").then(({ readdir }) => readdir(temp.dataDir));

    expect(files.filter((file) => file.includes(".tmp"))).toEqual([]);
  });

  it("reads persisted state after recreating the storage service", async () => {
    const firstStorage = new ProjectStorage({ dataDir: temp.dataDir });
    await firstStorage.createProject({
      id: "project_1",
      userEmail: "mira@example.com",
      title: "The Wind in the Willows",
      bookText: "Book text"
    });

    const secondStorage = new ProjectStorage({ dataDir: temp.dataDir });

    await expect(secondStorage.readProject("project_1")).resolves.toMatchObject({
      id: "project_1",
      status: "CREATED",
      currentStep: "STYLE"
    });
  });

  it("serializes overlapping updates for the same project", async () => {
    const storage = new ProjectStorage({ dataDir: temp.dataDir });
    await storage.createProject({
      id: "project_1",
      userEmail: "mira@example.com",
      title: "Initial",
      bookText: "Book text"
    });

    const events = [];
    const firstUpdate = storage.updateProject("project_1", async (project) => {
      events.push("first-start");
      await delay(40);
      events.push("first-end");
      return { ...project, title: "First update" };
    });
    const secondUpdate = storage.updateProject("project_1", async (project) => {
      events.push("second-start");
      return { ...project, title: `${project.title} then second update` };
    });

    await Promise.all([firstUpdate, secondUpdate]);

    expect(events).toEqual(["first-start", "first-end", "second-start"]);
    await expect(storage.readProject("project_1")).resolves.toMatchObject({
      title: "First update then second update"
    });
  });

  it("rejects invalid project state from disk", async () => {
    const storage = new ProjectStorage({ dataDir: temp.dataDir });
    await mkdir(storage.projectDir("project_bad"), { recursive: true });
    await writeFile(
      storage.projectPath("project_bad"),
      JSON.stringify({
        id: "project_bad",
        userEmail: "not-an-email",
        title: "",
        createdAt: "2026-08-19T06:00:00.000Z",
        updatedAt: "2026-08-19T06:00:00.000Z",
        status: "CREATED",
        currentStep: "STYLE",
        stepState: {
          status: "idle",
          step: null,
          runId: null,
          startedAt: null,
          error: null
        },
        gemini: {},
        style: null,
        characters: [],
        chapters: []
      }),
      "utf8"
    );

    await expect(storage.readProject("project_bad")).rejects.toThrow();
  });
});

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
