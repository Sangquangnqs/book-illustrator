import { createReadStream } from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { requireSession } from "../middleware/session.js";
import { withVisibleStepState } from "../pipeline/stepGuards.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 2 * 1024 * 1024
  }
});

const createProjectJsonSchema = z
  .object({
    title: z.string().trim().min(1),
    bookText: z.string().trim().min(1)
  })
  .strict();

const projectParamsSchema = z
  .object({
    projectId: z.string().regex(/^project_[a-f0-9-]{36}$/)
  })
  .strict();

const imageParamsSchema = z
  .object({
    projectId: projectParamsSchema.shape.projectId,
    kind: z.enum(["portraits", "chapters"]),
    fileName: z.string().regex(/^[a-zA-Z0-9_.-]+$/)
  })
  .strict();

export function createProjectRouter({ storage, sessionSecret }) {
  const router = Router();
  const requireCurrentSession = requireSession({ storage, sessionSecret });

  router.use(requireCurrentSession);

  router.get("/projects", async (req, res, next) => {
    try {
      const projects = await storage.listProjectsForUser(req.currentUserEmail);
      res.json({ projects: projects.map(projectSummary) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/projects", upload.single("bookFile"), async (req, res, next) => {
    try {
      const { title, bookText } = parseCreateProjectRequest(req);
      const project = await storage.createProject({
        userEmail: req.currentUserEmail,
        title,
        bookText
      });

      res.status(201).json({ project: projectDetail(project) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/projects/:projectId", async (req, res, next) => {
    try {
      const { projectId } = projectParamsSchema.parse(req.params);
      const project = await readOwnedProject(storage, projectId, req.currentUserEmail);

      if (!project) {
        return res.status(404).json({ error: { message: "Project not found." } });
      }

      return res.json({ project: projectDetail(project) });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/projects/:projectId/book", async (req, res, next) => {
    try {
      const { projectId } = projectParamsSchema.parse(req.params);
      const project = await readOwnedProject(storage, projectId, req.currentUserEmail);

      if (!project) {
        return res.status(404).json({ error: { message: "Project not found." } });
      }

      const bookText = await storage.readBookText(project.id);
      return res.json({ bookText });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/projects/:projectId/images/:kind/:fileName", async (req, res, next) => {
    try {
      const params = imageParamsSchema.parse(req.params);
      const project = await readOwnedProject(storage, params.projectId, req.currentUserEmail);

      if (!project) {
        return res.status(404).json({ error: { message: "Project not found." } });
      }

      const imagePath = path.join(storage.projectDir(project.id), "images", params.kind, params.fileName);
      const expectedRoot = path.join(storage.projectDir(project.id), "images", params.kind);
      const resolvedImagePath = path.resolve(imagePath);

      if (!resolvedImagePath.startsWith(path.resolve(expectedRoot) + path.sep)) {
        return res.status(400).json({ error: { message: "Invalid image path." } });
      }

      return createReadStream(resolvedImagePath)
        .on("error", () => {
          if (!res.headersSent) {
            res.status(404).json({ error: { message: "Image not found." } });
          }
        })
        .pipe(res);
    } catch (error) {
      return next(error);
    }
  });

  return router;
}

function parseCreateProjectRequest(req) {
  const hasFile = Boolean(req.file);
  const rawBookText = typeof req.body.bookText === "string" ? req.body.bookText : "";
  const hasPastedText = rawBookText.trim().length > 0;

  if (hasFile && hasPastedText) {
    throw badRequest("Provide either pasted book text or a .txt upload, not both.");
  }

  if (!hasFile && !hasPastedText) {
    throw badRequest("Provide pasted book text or upload a .txt file.");
  }

  if (hasFile) {
    const extension = path.extname(req.file.originalname).toLowerCase();
    if (extension !== ".txt") {
      throw badRequest("Only .txt uploads are supported.");
    }

    return {
      title: z.string().trim().min(1).parse(req.body.title),
      bookText: z.string().trim().min(1).parse(req.file.buffer.toString("utf8"))
    };
  }

  return createProjectJsonSchema.parse({
    title: req.body.title,
    bookText: rawBookText
  });
}

async function readOwnedProject(storage, projectId, userEmail) {
  try {
    const project = await storage.readProject(projectId);
    return project.userEmail === userEmail ? project : null;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function projectSummary(project) {
  return {
    id: project.id,
    title: project.title,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    status: project.status,
    currentStep: project.currentStep,
    progress: {
      completed: completedCount(project.status),
      total: 5
    }
  };
}

function projectDetail(project) {
  const visibleProject = withVisibleStepState(project);

  return {
    id: visibleProject.id,
    userEmail: visibleProject.userEmail,
    title: visibleProject.title,
    createdAt: visibleProject.createdAt,
    updatedAt: visibleProject.updatedAt,
    status: visibleProject.status,
    currentStep: visibleProject.currentStep,
    stepState: visibleProject.stepState,
    gemini: visibleProject.gemini,
    style: visibleProject.style,
    characters: visibleProject.characters,
    chapters: visibleProject.chapters
  };
}

function completedCount(status) {
  return {
    CREATED: 0,
    STYLE_DONE: 1,
    CHARACTERS_DONE: 2,
    PORTRAITS_DONE: 3,
    CHAPTERS_DONE: 4,
    DONE: 5
  }[status];
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}
