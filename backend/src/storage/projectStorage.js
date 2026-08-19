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
    this.usersTail = Promise.resolve();
    this.readyPromise = null;
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
    this.readyPromise = this.readyPromise ?? this.#ensureReady();

    try {
      await this.readyPromise;
    } catch (error) {
      this.readyPromise = null;
      throw error;
    }
  }

  async #ensureReady() {
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
    return this.updateUsers(async (usersState) => {
      const normalizedEmail = normalizeEmail(email);

      usersState.users[normalizedEmail] = usersState.users[normalizedEmail] ?? {
        name,
        email: normalizedEmail,
        projectIds: []
      };
      usersState.users[normalizedEmail].name = name;

      return {
        usersState,
        result: usersState.users[normalizedEmail]
      };
    });
  }

  async readUser(email) {
    const normalizedEmail = normalizeEmail(email);
    const usersState = await this.readUsers();
    return usersState.users[normalizedEmail] ?? null;
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

    await this.updateUsers(async (usersState) => {
      usersState.users[normalizedEmail] = usersState.users[normalizedEmail] ?? {
        name: "",
        email: normalizedEmail,
        projectIds: []
      };
      if (!usersState.users[normalizedEmail].projectIds.includes(id)) {
        usersState.users[normalizedEmail].projectIds.unshift(id);
      }

      return { usersState };
    });

    return project;
  }

  async readProject(projectId) {
    const project = await readJson(this.projectPath(projectId));
    return parseProject(project);
  }

  async readBookText(projectId) {
    return readFile(this.bookPath(projectId), "utf8");
  }

  async listProjectsForUser(userEmail) {
    const user = await this.readUser(userEmail);
    if (!user) {
      return [];
    }

    const projects = await Promise.all(
      user.projectIds.map(async (projectId) => {
        try {
          return await this.readProject(projectId);
        } catch (error) {
          if (error.code === "ENOENT") {
            return null;
          }
          throw error;
        }
      })
    );

    return projects.filter(Boolean);
  }

  async updateProject(projectId, updater) {
    return this.mutex.runExclusive(projectId, async () => {
      const current = await this.readProject(projectId);
      const updated = await updater(current);
      const parsed = parseProject(
        withDerivedCurrentStep({
          ...updated,
          updatedAt: new Date().toISOString()
        })
      );

      await writeJsonAtomic(this.projectPath(projectId), parsed);
      return parsed;
    });
  }

  async updateUsers(updater) {
    const previous = this.usersTail;

    let release;
    this.usersTail = new Promise((resolve) => {
      release = resolve;
    });

    await previous.catch(() => {});

    try {
      await this.ensureReady();
      const usersState = await readJson(this.usersPath);
      const update = await updater(usersState);
      const nextUsersState = update?.usersState ?? usersState;

      await writeJsonAtomic(this.usersPath, nextUsersState);
      return update?.result;
    } finally {
      release();
    }
  }
}

async function writeFileUtf8(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}
