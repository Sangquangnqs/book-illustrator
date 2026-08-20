export const STEPS = [
  { key: "STYLE", label: "Style" },
  { key: "CHARACTERS", label: "Characters" },
  { key: "PORTRAITS", label: "Portraits" },
  { key: "CHAPTERS", label: "Chapters" },
  { key: "ILLUSTRATIONS", label: "Illustration" }
];

export function stepLabel(step) {
  return STEPS.find((candidate) => candidate.key === step)?.label ?? "Pipeline";
}

export function completedCountForStatus(status) {
  return {
    CREATED: 0,
    STYLE_DONE: 1,
    CHARACTERS_DONE: 2,
    PORTRAITS_DONE: 3,
    CHAPTERS_DONE: 4,
    DONE: 5
  }[status] ?? 0;
}

export function projectStatusLabel(status) {
  if (status === "CREATED") return "Draft";
  if (status === "DONE") return "Done";
  return "In progress";
}

export function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value)
  );
}
