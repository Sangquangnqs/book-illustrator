import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createInitialProject, withDerivedCurrentStep } from "../domain/projectState.js";
import { parseProject } from "../domain/projectSchema.js";
import { readJson, writeJsonAtomic } from "./jsonFile.js";
import { ProjectMutex } from "./projectMutex.js";

const USERS_FILE = "users.json";
const PROJECTS_DIR = "projects";

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export class ProjectStorage {
  constructor({ dataDir, mutex = new ProjectMutex() }) {
    if (!dataDir) {
      throw new Error("ProjectStorage requires dataDir");
    }

    this.dataDir = dataDir;
    this.mutex = mutex;
  }

  get usersPath() {
    return path.join(this.dataDir, USERS_FILE);
  }

  projectDir(projectId) {
    return path.join(this.dataDir, PROJECTS_DIR, projectId);
  }

  projectPath(projectId) {
    return path.join(this.projectDir(projectId), "project.json");
  }

  bookPath(projectId) {
    return path.join(this.projectDir(projectId), "book.txt");
  }

  async ensureReady() {
    await mkdir(path.join(this.dataDir, PROJECTS_DIR), { recursive: true });

    try {
      await readJson(this.usersPath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await writeJsonAtomic(this.usersPath, { users: {} });
    }
  }

  async readUsers() {
    await this.ensureReady();
    return readJson(this.usersPath);
  }

  async createUser({ name, email }) {
    await this.ensureReady();
    const normalizedEmail = normalizeEmail(email);
    const usersState = await readJson(this.usersPath);

    usersState.users[normalizedEmail] = usersState.users[normalizedEmail] ?? {
      name,
      email: normalizedEmail,
      projectIds: []
    };
    usersState.users[normalizedEmail].name = name;

    await writeJsonAtomic(this.usersPath, usersState);
    return usersState.users[normalizedEmail];
  }

  async createProject({ userEmail, title, bookText, id = `project_${randomUUID()}` }) {
    await this.ensureReady();
    const normalizedEmail = normalizeEmail(userEmail);
    const project = parseProject(
      createInitialProject({
        id,
        userEmail: normalizedEmail,
        title
      })
    );

    await mkdir(this.projectDir(id), { recursive: true });
    await writeJsonAtomic(this.projectPath(id), project);
    await writeFileUtf8(this.bookPath(id), bookText);

    const usersState = await readJson(this.usersPath);
    usersState.users[normalizedEmail] = usersState.users[normalizedEmail] ?? {
      name: "",
      email: normalizedEmail,
      projectIds: []
    };
    if (!usersState.users[normalizedEmail].projectIds.includes(id)) {
      usersState.users[normalizedEmail].projectIds.unshift(id);
    }
    await writeJsonAtomic(this.usersPath, usersState);

    return project;
  }

  async readProject(projectId) {
    const project = await readJson(this.projectPath(projectId));
    return parseProject(project);
  }

  async readBookText(projectId) {
    return readFile(this.bookPath(projectId), "utf8");
  }

  async updateProject(projectId, updater) {
    return this.mutex.runExclusive(projectId, async () => {
      const current = await this.readProject(projectId);
      const updated = await updater(current);
      const parsed = parseProject(
        withDerivedCurrentStep({
          ...updated,
          updatedAt: updated.updatedAt ?? new Date().toISOString()
        })
      );

      await writeJsonAtomic(this.projectPath(projectId), parsed);
      return parsed;
    });
  }
}

async function writeFileUtf8(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}
