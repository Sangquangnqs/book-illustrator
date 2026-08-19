import { Router } from "express";
import { z } from "zod";
import { requireSession } from "../middleware/session.js";
import { PipelineError } from "../pipeline/pipelineService.js";

const pipelineParamsSchema = z
  .object({
    projectId: z.string().regex(/^project_[a-f0-9-]{36}$/),
    step: z.enum(["STYLE", "CHARACTERS", "PORTRAITS", "CHAPTERS", "ILLUSTRATIONS"])
  })
  .strict();

const runBodySchema = z
  .object({
    style: z.string().trim().min(1).optional()
  })
  .strict();

export function createPipelineRouter({ storage, sessionSecret, pipelineService }) {
  const router = Router();
  const requireCurrentSession = requireSession({ storage, sessionSecret });

  router.use(requireCurrentSession);

  router.post("/projects/:projectId/steps/:step/run", async (req, res, next) => {
    try {
      const params = pipelineParamsSchema.parse(req.params);
      const input = runBodySchema.parse(req.body ?? {});
      const result = await pipelineService.runStep({
        projectId: params.projectId,
        userEmail: req.currentUserEmail,
        step: params.step,
        input
      });

      return res.status(result.type === "already_running" ? 202 : 200).json(result);
    } catch (error) {
      return next(mapMissingProject(error));
    }
  });

  router.post("/projects/:projectId/steps/:step/retry", async (req, res, next) => {
    try {
      const params = pipelineParamsSchema.parse(req.params);
      const input = runBodySchema.parse(req.body ?? {});
      const result = await pipelineService.retryStep({
        projectId: params.projectId,
        userEmail: req.currentUserEmail,
        step: params.step,
        input
      });

      return res.json(result);
    } catch (error) {
      return next(mapMissingProject(error));
    }
  });

  return router;
}

function mapMissingProject(error) {
  if (error?.code === "ENOENT") {
    return new PipelineError("Project not found.", { status: 404, code: "PROJECT_NOT_FOUND" });
  }

  return error;
}
