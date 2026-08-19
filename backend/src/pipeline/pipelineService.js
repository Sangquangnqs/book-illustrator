import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PIPELINE_STEPS } from "../domain/projectState.js";
import { DEFAULT_STALE_TIMEOUTS } from "./staleTimeouts.js";
import { isStepStale, withVisibleStepState } from "./stepGuards.js";

const idleStepState = {
  status: "idle",
  step: null,
  runId: null,
  startedAt: null,
  error: null
};

const characterOutputSchema = z
  .array(
    z
      .object({
        name: z.string().trim().min(1),
        prompt: z.string().trim().min(1)
      })
      .strict()
  )
  .max(2);

const chapterOutputSchema = z
  .array(
    z
      .object({
        name: z.string().trim().min(1),
        prompt: z.string().trim().min(1)
      })
      .strict()
  )
  .max(1);

export class PipelineError extends Error {
  constructor(message, { status = 409, code = "PIPELINE_ERROR" } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class PipelineService {
  constructor({
    storage,
    geminiClient,
    now = () => new Date(),
    staleTimeouts = DEFAULT_STALE_TIMEOUTS,
    runIdFactory = () => randomUUID()
  }) {
    this.storage = storage;
    this.geminiClient = geminiClient;
    this.now = now;
    this.staleTimeouts = staleTimeouts;
    this.runIdFactory = runIdFactory;
  }

  async runStep({ projectId, userEmail, step, input = {} }) {
    const claim = await this.#claimStep({ projectId, userEmail, step, mode: "run" });

    if (claim.type !== "claimed") {
      return claim;
    }

    return this.#executeClaimedStep({ projectId, step, runId: claim.runId, input });
  }

  async retryStep({ projectId, userEmail, step, input = {} }) {
    const claim = await this.#claimStep({ projectId, userEmail, step, mode: "retry" });
    return this.#executeClaimedStep({ projectId, step, runId: claim.runId, input });
  }

  viewProject(project) {
    return withVisibleStepState(project, {
      now: this.now(),
      staleTimeouts: this.staleTimeouts
    });
  }

  async #claimStep({ projectId, userEmail, step, mode }) {
    let claim = null;
    const project = await this.storage.updateProject(projectId, (current) => {
      assertOwned(current, userEmail);
      assertKnownStep(step);

      if (current.currentStep !== step) {
        throw new PipelineError(`Step ${step} is not the current step.`, {
          status: 409,
          code: "STEP_OUT_OF_ORDER"
        });
      }

      const stale = isStepStale(current.stepState, {
        now: this.now(),
        staleTimeouts: this.staleTimeouts
      });

      if (mode === "run") {
        if (current.stepState.status === "running" && !stale) {
          claim = { type: "already_running" };
          return current;
        }

        if (current.stepState.status === "failed" || stale) {
          throw new PipelineError("This step must be retried explicitly.", {
            status: 409,
            code: stale ? "STALE_RETRY_REQUIRED" : "FAILED_RETRY_REQUIRED"
          });
        }
      }

      if (mode === "retry") {
        if (current.stepState.status !== "failed" && !stale) {
          throw new PipelineError("Only failed or stale steps can be retried.", {
            status: 409,
            code: "RETRY_NOT_ALLOWED"
          });
        }
      }

      const runId = this.runIdFactory();
      claim = { type: "claimed", runId };

      return {
        ...current,
        stepState: {
          status: "running",
          step,
          runId,
          startedAt: this.now().toISOString(),
          error: null
        }
      };
    });

    if (claim.type === "already_running") {
      return { type: "already_running", project: this.viewProject(project) };
    }

    return { ...claim, project: this.viewProject(project) };
  }

  async #executeClaimedStep({ projectId, step, runId, input }) {
    try {
      let project;

      if (step === "STYLE") {
        let style = input.style?.trim();
        let gemini = {};

        if (!style) {
          const result = await this.geminiClient.generateStyle({
            project: await this.storage.readProject(projectId),
            bookText: await this.storage.readBookText(projectId)
          });
          style = z.string().trim().min(1).parse(result.style);
          gemini = result.gemini;
        }

        project = await this.#completeSuccess(projectId, runId, step, (current) => ({
          ...current,
          status: "STYLE_DONE",
          stepState: idleStepState,
          gemini: mergeGemini(current.gemini, gemini),
          style
        }));
      } else if (step === "CHARACTERS") {
        const result = await this.geminiClient.generateCharacters({
          project: await this.storage.readProject(projectId)
        });
        const characters = characterOutputSchema.parse(result.characters).map((character, index) => ({
          id: `char_${index + 1}`,
          name: character.name,
          prompt: character.prompt,
          image: {
            status: "pending",
            path: null,
            error: null
          }
        }));

        project = await this.#completeSuccess(projectId, runId, step, (current) => ({
          ...current,
          status: "CHARACTERS_DONE",
          stepState: idleStepState,
          gemini: mergeGemini(current.gemini, result.gemini),
          characters
        }));
      } else if (step === "PORTRAITS") {
        await this.#generateImages({
          projectId,
          runId,
          step,
          listKey: "characters",
          kind: "portraits",
          fileNameFor: (item) => `${item.id}.png`,
          generate: (current, item) =>
            this.geminiClient.generatePortrait({
              project: current,
              character: item
            })
        });

        project = await this.#completeSuccess(projectId, runId, step, (current) => ({
          ...current,
          status: "PORTRAITS_DONE",
          stepState: idleStepState
        }));
      } else if (step === "CHAPTERS") {
        const result = await this.geminiClient.generateChapters({
          project: await this.storage.readProject(projectId)
        });
        const chapters = chapterOutputSchema.parse(result.chapters).map((chapter, index) => ({
          id: `chapter_${index + 1}`,
          name: chapter.name,
          prompt: chapter.prompt,
          image: {
            status: "pending",
            path: null,
            error: null
          }
        }));

        project = await this.#completeSuccess(projectId, runId, step, (current) => ({
          ...current,
          status: "CHAPTERS_DONE",
          stepState: idleStepState,
          gemini: mergeGemini(current.gemini, result.gemini),
          chapters
        }));
      } else if (step === "ILLUSTRATIONS") {
        await this.#generateImages({
          projectId,
          runId,
          step,
          listKey: "chapters",
          kind: "chapters",
          fileNameFor: (item) => `${item.id}.png`,
          generate: (current, item) =>
            this.geminiClient.generateIllustration({
              project: current,
              chapter: item
            })
        });

        project = await this.#completeSuccess(projectId, runId, step, (current) => ({
          ...current,
          status: "DONE",
          stepState: idleStepState
        }));
      }

      return { type: "completed", project: this.viewProject(project) };
    } catch (error) {
      const project = await this.#completeFailure(projectId, runId, step, error);
      return { type: "failed", project: this.viewProject(project) };
    }
  }

  async #generateImages({ projectId, runId, step, listKey, kind, fileNameFor, generate }) {
    let current = await this.storage.readProject(projectId);

    for (const item of current[listKey]) {
      if (item.image?.status === "done" && item.image.path) {
        continue;
      }

      current = await this.#updateImageItem(projectId, runId, listKey, item.id, {
        status: "running",
        path: item.image?.path ?? null,
        error: null
      });

      const latestItem = current[listKey].find((candidate) => candidate.id === item.id);

      try {
        const result = await generate(current, latestItem);
        const path = await this.storage.writeProjectImage(
          projectId,
          kind,
          fileNameFor(latestItem),
          normalizeImageBytes(result)
        );

        current = await this.#updateImageItem(projectId, runId, listKey, item.id, {
          status: "done",
          path,
          error: null,
          geminiInteractionId: result.geminiInteractionId
        });
      } catch (error) {
        await this.#updateImageItem(projectId, runId, listKey, item.id, {
          status: "failed",
          path: latestItem.image?.path ?? null,
          error: toStepError(error)
        });
        throw error;
      }
    }
  }

  async #updateImageItem(projectId, runId, listKey, itemId, image) {
    return this.storage.updateProject(projectId, (current) => {
      if (current.stepState.runId !== runId) {
        return current;
      }

      return {
        ...current,
        [listKey]: current[listKey].map((item) =>
          item.id === itemId
            ? {
                ...item,
                image: removeUndefined({
                  ...item.image,
                  ...image
                })
              }
            : item
        )
      };
    });
  }

  async #completeSuccess(projectId, runId, _step, applySuccess) {
    return this.storage.updateProject(projectId, (current) => {
      if (current.stepState.runId !== runId) {
        return current;
      }

      return applySuccess(current);
    });
  }

  async #completeFailure(projectId, runId, step, error) {
    return this.storage.updateProject(projectId, (current) => {
      if (current.stepState.runId !== runId) {
        return current;
      }

      return {
        ...current,
        stepState: {
          status: "failed",
          step,
          runId,
          startedAt: current.stepState.startedAt,
          error: toStepError(error)
        }
      };
    });
  }
}

function assertOwned(project, userEmail) {
  if (project.userEmail !== userEmail) {
    throw new PipelineError("Project not found.", { status: 404, code: "PROJECT_NOT_FOUND" });
  }
}

function assertKnownStep(step) {
  if (!PIPELINE_STEPS.includes(step)) {
    throw new PipelineError("Unknown pipeline step.", { status: 400, code: "UNKNOWN_STEP" });
  }
}

function mergeGemini(existing, next = {}) {
  return {
    ...existing,
    ...removeUndefined(next)
  };
}

function normalizeImageBytes(result) {
  if (Buffer.isBuffer(result)) {
    return result;
  }

  if (Buffer.isBuffer(result?.bytes)) {
    return result.bytes;
  }

  if (typeof result?.bytes === "string") {
    return Buffer.from(result.bytes);
  }

  if (typeof result?.base64 === "string") {
    return Buffer.from(result.base64, "base64");
  }

  throw new PipelineError("Gemini did not return image bytes.", {
    status: 502,
    code: "INVALID_IMAGE_OUTPUT"
  });
}

function toStepError(error) {
  return {
    message: error?.message || "Pipeline step failed.",
    code: error?.code || (error instanceof z.ZodError ? "INVALID_GEMINI_OUTPUT" : "STEP_FAILED")
  };
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
