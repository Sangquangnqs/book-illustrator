import express from "express";
import multer from "multer";
import { ZodError } from "zod";
import { getDataDir, getSessionSecret } from "./config/env.js";
import { createProjectRouter } from "./routes/projectRoutes.js";
import { createSessionRouter } from "./routes/sessionRoutes.js";
import { ProjectStorage } from "./storage/projectStorage.js";

export function createApp(options = {}) {
  const storage = options.storage ?? new ProjectStorage({ dataDir: options.dataDir ?? getDataDir() });
  const sessionSecret = options.sessionSecret ?? getSessionSecret();
  const app = express();

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "book-illustrator-api" });
  });

  app.use("/api", createSessionRouter({ storage, sessionSecret }));
  app.use("/api", createProjectRouter({ storage, sessionSecret }));

  app.use((error, _req, res, _next) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "Uploaded file is too large."
          : "Invalid file upload.";

      return res.status(status).json({ error: { message } });
    }

    if (error instanceof ZodError) {
      return res.status(400).json({ error: { message: "Invalid request.", details: error.issues } });
    }

    if (error.status) {
      return res.status(error.status).json({ error: { message: error.message } });
    }

    return res.status(500).json({ error: { message: "Internal server error." } });
  });

  return app;
}
