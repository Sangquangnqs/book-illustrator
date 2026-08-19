export const PROJECT_STATUSES = [
  "CREATED",
  "STYLE_DONE",
  "CHARACTERS_DONE",
  "PORTRAITS_DONE",
  "CHAPTERS_DONE",
  "DONE"
];

export const PIPELINE_STEPS = [
  "STYLE",
  "CHARACTERS",
  "PORTRAITS",
  "CHAPTERS",
  "ILLUSTRATIONS"
];

const NEXT_STEP_BY_STATUS = {
  CREATED: "STYLE",
  STYLE_DONE: "CHARACTERS",
  CHARACTERS_DONE: "PORTRAITS",
  PORTRAITS_DONE: "CHAPTERS",
  CHAPTERS_DONE: "ILLUSTRATIONS",
  DONE: null
};

export function deriveCurrentStep(status) {
  if (!(status in NEXT_STEP_BY_STATUS)) {
    throw new Error(`Unknown project status: ${status}`);
  }

  return NEXT_STEP_BY_STATUS[status];
}

export function createInitialProject({
  id,
  userEmail,
  title,
  createdAt = new Date().toISOString()
}) {
  return {
    id,
    userEmail,
    title,
    createdAt,
    updatedAt: createdAt,
    status: "CREATED",
    currentStep: deriveCurrentStep("CREATED"),
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
  };
}

export function withDerivedCurrentStep(project) {
  return {
    ...project,
    currentStep: deriveCurrentStep(project.status)
  };
}
