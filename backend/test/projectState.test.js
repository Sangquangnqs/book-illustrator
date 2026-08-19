import { describe, expect, it } from "vitest";
import { createInitialProject, deriveCurrentStep, withDerivedCurrentStep } from "../src/domain/projectState.js";
import { parseProject } from "../src/domain/projectSchema.js";

describe("project state", () => {
  it("derives the next pipeline step from persisted status", () => {
    expect(deriveCurrentStep("CREATED")).toBe("STYLE");
    expect(deriveCurrentStep("STYLE_DONE")).toBe("CHARACTERS");
    expect(deriveCurrentStep("CHARACTERS_DONE")).toBe("PORTRAITS");
    expect(deriveCurrentStep("PORTRAITS_DONE")).toBe("CHAPTERS");
    expect(deriveCurrentStep("CHAPTERS_DONE")).toBe("ILLUSTRATIONS");
    expect(deriveCurrentStep("DONE")).toBeNull();
  });

  it("creates a valid initial project", () => {
    const project = createInitialProject({
      id: "project_1",
      userEmail: "mira@example.com",
      title: "The Wind in the Willows",
      createdAt: "2026-08-19T06:00:00.000Z"
    });

    expect(parseProject(project)).toEqual(project);
  });

  it("can derive currentStep before persisting an updated status", () => {
    const project = createInitialProject({
      id: "project_1",
      userEmail: "mira@example.com",
      title: "The Wind in the Willows",
      createdAt: "2026-08-19T06:00:00.000Z"
    });

    const updated = withDerivedCurrentStep({
      ...project,
      status: "STYLE_DONE"
    });

    expect(updated.currentStep).toBe("CHARACTERS");
    expect(parseProject(updated).currentStep).toBe("CHARACTERS");
  });

  it("rejects invalid persisted project state", () => {
    const project = createInitialProject({
      id: "project_1",
      userEmail: "mira@example.com",
      title: "The Wind in the Willows",
      createdAt: "2026-08-19T06:00:00.000Z"
    });

    expect(() =>
      parseProject({
        ...project,
        status: "STYLE_DONE",
        currentStep: "STYLE"
      })
    ).toThrow();

    expect(() =>
      parseProject({
        ...project,
        characters: [
          { id: "char_1", name: "A", prompt: "Prompt" },
          { id: "char_2", name: "B", prompt: "Prompt" },
          { id: "char_3", name: "C", prompt: "Prompt" }
        ]
      })
    ).toThrow();
  });
});
