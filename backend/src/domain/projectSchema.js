import { z } from "zod";
import { PIPELINE_STEPS, PROJECT_STATUSES, withDerivedCurrentStep } from "./projectState.js";

const isoDateString = z.string().datetime({ offset: true });

const nullablePipelineStepSchema = z.enum(PIPELINE_STEPS).nullable();

const stepErrorSchema = z
  .object({
    message: z.string().min(1),
    code: z.string().min(1).optional()
  })
  .strict();

const stepStateSchema = z
  .object({
    status: z.enum(["idle", "running", "failed"]),
    step: nullablePipelineStepSchema,
    runId: z.string().min(1).nullable(),
    startedAt: isoDateString.nullable(),
    error: stepErrorSchema.nullable()
  })
  .strict()
  .superRefine((state, ctx) => {
    if (state.status === "running") {
      if (!state.step) {
        ctx.addIssue({
          code: "custom",
          path: ["step"],
          message: "running step state requires a step"
        });
      }
      if (!state.runId) {
        ctx.addIssue({
          code: "custom",
          path: ["runId"],
          message: "running step state requires a runId"
        });
      }
      if (!state.startedAt) {
        ctx.addIssue({
          code: "custom",
          path: ["startedAt"],
          message: "running step state requires startedAt"
        });
      }
    }

    if (state.status === "idle" && (state.step || state.runId || state.startedAt || state.error)) {
      ctx.addIssue({
        code: "custom",
        message: "idle step state must not keep step, runId, startedAt, or error"
      });
    }

    if (state.status === "failed" && (!state.step || !state.error)) {
      ctx.addIssue({
        code: "custom",
        message: "failed step state requires a step and error"
      });
    }
  });

const imageStateSchema = z
  .object({
    status: z.enum(["pending", "running", "done", "failed"]),
    path: z.string().min(1).nullable(),
    error: stepErrorSchema.nullable(),
    geminiInteractionId: z.string().min(1).optional()
  })
  .strict();

const characterSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    prompt: z.string().min(1),
    image: imageStateSchema.optional()
  })
  .strict();

const chapterSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    prompt: z.string().min(1),
    image: imageStateSchema.optional()
  })
  .strict();

export const projectSchema = z
  .object({
    id: z.string().min(1),
    userEmail: z.string().email(),
    title: z.string().min(1),
    createdAt: isoDateString,
    updatedAt: isoDateString,
    status: z.enum(PROJECT_STATUSES),
    currentStep: nullablePipelineStepSchema,
    stepState: stepStateSchema,
    gemini: z
      .object({
        fileUri: z.string().min(1).optional(),
        bookInteractionId: z.string().min(1).optional(),
        styleInteractionId: z.string().min(1).optional(),
        charactersInteractionId: z.string().min(1).optional(),
        chaptersInteractionId: z.string().min(1).optional()
      })
      .strict(),
    style: z.string().min(1).nullable(),
    characters: z.array(characterSchema).max(2),
    chapters: z.array(chapterSchema).max(1)
  })
  .strict()
  .superRefine((project, ctx) => {
    const expectedStep = withDerivedCurrentStep(project).currentStep;
    if (project.currentStep !== expectedStep) {
      ctx.addIssue({
        code: "custom",
        path: ["currentStep"],
        message: `currentStep must be derived from status ${project.status}`
      });
    }
  });

export function parseProject(value) {
  return projectSchema.parse(value);
}
