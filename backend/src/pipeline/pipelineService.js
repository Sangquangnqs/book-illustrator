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

class SupersededRunError extends Error {
  constructor() {
    super("Pipeline run was superseded.");
    this.code = "RUN_SUPERSEDED";
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

    this.#startClaimedStep({ projectId, step, runId: claim.runId, input });
    return { type: "running", project: claim.project };
  }

  async retryStep({ projectId, userEmail, step, input = {} }) {
    const claim = await this.#claimStep({ projectId, userEmail, step, mode: "retry" });
    this.#startClaimedStep({ projectId, step, runId: claim.runId, input });
    return { type: "running", project: claim.project };
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

  #startClaimedStep({ projectId, step, runId, input }) {
    void this.#executeClaimedStep({ projectId, step, runId, input }).catch(() => {});
  }

  async #executeClaimedStep({ projectId, step, runId, input }) {
    try {
      let project;

      if (step === "STYLE") {
        const projectWithContext = await this.#ensureBookContext(projectId, runId);
        const result = await this.geminiClient.generateStyle({
          project: projectWithContext,
          style: input.style?.trim()
        });
        await this.#requireCurrentRun(projectId, runId);
        const style = z.string().trim().min(1).parse(result.style);

        project = await this.#completeSuccess(projectId, runId, step, (current) => ({
          ...current,
          status: "STYLE_DONE",
          stepState: idleStepState,
          gemini: mergeGemini(current.gemini, result.gemini),
          style
        }));
      } else if (step === "CHARACTERS") {
        const projectWithContext = await this.#ensureBookContext(projectId, runId);
        const result = await this.geminiClient.generateCharacters({
          project: projectWithContext
        });
        await this.#requireCurrentRun(projectId, runId);
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
        await this.#ensureBookContext(projectId, runId);
        await this.#ensureImageContext(projectId, runId);
        await this.#generateImages({
          projectId,
          runId,
          step,
          listKey: "characters",
          kind: "portraits",
          fileNameFor: (item, currentRunId, extension) => `${item.id}_${currentRunId}${extension}`,
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
        const projectWithContext = await this.#ensureBookContext(projectId, runId);
        const result = await this.geminiClient.generateChapters({
          project: projectWithContext
        });
        await this.#requireCurrentRun(projectId, runId);
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
        await this.#ensureBookContext(projectId, runId);
        await this.#generateImages({
          projectId,
          runId,
          step,
          listKey: "chapters",
          kind: "chapters",
          fileNameFor: (item, currentRunId, extension) => `${item.id}_${currentRunId}${extension}`,
          prepare: (current, item) => this.#ensureChapterImageContext(projectId, runId, current, item),
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
      if (error instanceof SupersededRunError) {
        return { type: "superseded" };
      }

      const project = await this.#completeFailure(projectId, runId, step, error);
      return { type: "failed", project: this.viewProject(project) };
    }
  }

  async #ensureBookContext(projectId, runId) {
    const current = await this.#requireCurrentRun(projectId, runId);

    if (current.gemini.fileUri && current.gemini.bookInteractionId) {
      return current;
    }

    const result = await this.geminiClient.ensureBookContext({
      project: current,
      bookText: await this.storage.readBookText(projectId)
    });

    await this.#requireCurrentRun(projectId, runId);

    const updated = await this.storage.updateProject(projectId, (project) => {
      if (project.stepState.runId !== runId) {
        return project;
      }

      if (project.gemini.fileUri && project.gemini.bookInteractionId) {
        return project;
      }

      return {
        ...project,
        gemini: mergeGemini(project.gemini, {
          fileUri: result.fileUri,
          bookInteractionId: result.bookInteractionId
        })
      };
    });

    if (updated.stepState.runId !== runId) {
      throw new SupersededRunError();
    }

    return updated;
  }

  async #ensureImageContext(projectId, runId) {
    const current = await this.#requireCurrentRun(projectId, runId);

    if (current.gemini.charactersImageInteractionId) {
      return current;
    }

    const result = await this.geminiClient.ensureImageContext({
      project: current
    });

    await this.#requireCurrentRun(projectId, runId);

    const updated = await this.storage.updateProject(projectId, (project) => {
      if (project.stepState.runId !== runId) {
        return project;
      }

      if (project.gemini.charactersImageInteractionId) {
        return project;
      }

      return {
        ...project,
        gemini: mergeGemini(project.gemini, {
          charactersImageInteractionId: result.charactersImageInteractionId,
          latestImageInteractionId: result.latestImageInteractionId ?? result.charactersImageInteractionId
        })
      };
    });

    if (updated.stepState.runId !== runId) {
      throw new SupersededRunError();
    }

    return updated;
  }

  async #ensureChapterImageContext(projectId, runId, current, chapter) {
    await this.#requireCurrentRun(projectId, runId);

    const result = await this.geminiClient.ensureChapterImageContext({
      project: current,
      chapter
    });

    await this.#requireCurrentRun(projectId, runId);

    const updated = await this.storage.updateProject(projectId, (project) => {
      if (project.stepState.runId !== runId) {
        return project;
      }

      return {
        ...project,
        gemini: mergeGemini(project.gemini, {
          latestImageInteractionId: result.latestImageInteractionId
        })
      };
    });

    if (updated.stepState.runId !== runId) {
      throw new SupersededRunError();
    }

    return updated;
  }

  async #generateImages({ projectId, runId, step, listKey, kind, fileNameFor, prepare, generate }) {
    let current = await this.#requireCurrentRun(projectId, runId);

    for (const item of current[listKey]) {
      if (item.image?.status === "done" && item.image.path) {
        continue;
      }

      current = await this.#updateImageItem(projectId, runId, listKey, item.id, {
        status: "running",
        path: item.image?.path ?? null,
        error: null
      });

      if (current.stepState.runId !== runId) {
        throw new SupersededRunError();
      }

      const latestItem = current[listKey].find((candidate) => candidate.id === item.id);

      try {
        await this.#requireCurrentRun(projectId, runId);
        if (prepare) {
          current = await prepare(current, latestItem);
        }
        await this.#requireCurrentRun(projectId, runId);
        const result = await generate(current, latestItem);
        await this.#requireCurrentRun(projectId, runId);
        const image = normalizeImageResult(result);
        const path = await this.storage.writeProjectImage(
          projectId,
          kind,
          fileNameFor(latestItem, runId, image.extension),
          image.bytes
        );

        current = await this.#updateImageItem(projectId, runId, listKey, item.id, {
          status: "done",
          path,
          error: null,
          geminiInteractionId: result.geminiInteractionId
        }, result.gemini);
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

  async #updateImageItem(projectId, runId, listKey, itemId, image, gemini = {}) {
    return this.storage.updateProject(projectId, (current) => {
      if (current.stepState.runId !== runId) {
        return current;
      }

      return {
        ...current,
        gemini: mergeGemini(current.gemini, gemini),
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

  async #requireCurrentRun(projectId, runId) {
    const project = await this.storage.readProject(projectId);

    if (project.stepState.runId !== runId) {
      throw new SupersededRunError();
    }

    return project;
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

function normalizeImageResult(result) {
  let bytes;

  if (Buffer.isBuffer(result?.bytes)) {
    bytes = result.bytes;
  } else if (typeof result?.bytes === "string") {
    bytes = Buffer.from(result.bytes);
  } else if (typeof result?.base64 === "string") {
    bytes = Buffer.from(result.base64, "base64");
  }

  if (!bytes) {
    throw new PipelineError("Gemini did not return image bytes.", {
      status: 502,
      code: "GEMINI_IMAGE_MISSING"
    });
  }

  const extension = extensionForMimeType(result.mimeType);

  return { bytes, extension };
}

function extensionForMimeType(mimeType) {
  const extension = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp"
  }[mimeType];

  if (!extension) {
    throw new PipelineError(`Unsupported Gemini image MIME type: ${mimeType || "missing"}.`, {
      status: 502,
      code: "GEMINI_INVALID_OUTPUT"
    });
  }

  return extension;
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
