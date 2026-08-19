import { PIPELINE_STEPS } from "../domain/projectState.js";
import { DEFAULT_STALE_TIMEOUTS } from "./staleTimeouts.js";

export function isPipelineStep(step) {
  return PIPELINE_STEPS.includes(step);
}

export function isStepStale(stepState, { now = new Date(), staleTimeouts = DEFAULT_STALE_TIMEOUTS } = {}) {
  if (stepState.status !== "running" || !stepState.step || !stepState.startedAt) {
    return false;
  }

  const startedAt = new Date(stepState.startedAt).getTime();
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const timeoutMs = staleTimeouts[stepState.step] ?? DEFAULT_STALE_TIMEOUTS[stepState.step];

  return Number.isFinite(startedAt) && nowMs - startedAt > timeoutMs;
}

export function withVisibleStepState(
  project,
  { now = new Date(), staleTimeouts = DEFAULT_STALE_TIMEOUTS } = {}
) {
  if (!isStepStale(project.stepState, { now, staleTimeouts })) {
    return project;
  }

  return {
    ...project,
    stepState: {
      ...project.stepState,
      status: "stale",
      error: {
        message: "This step appears to be stuck and can be retried.",
        code: "STALE_STEP"
      }
    }
  };
}
