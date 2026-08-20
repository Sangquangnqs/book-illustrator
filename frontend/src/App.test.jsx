import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "./App.jsx";

const user = { name: "Mira Hassan", email: "mira@example.com" };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("frontend flow", () => {
  it("validates identity before sign in", async () => {
    mockApi({ sessionStatus: 401 });
    renderApp("/signin");

    await screen.findByRole("heading", { name: "Book Illustration Studio" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByText("Enter your name to continue.")).toBeInTheDocument();
  });

  it("restores an existing session and shows an empty project list", async () => {
    mockApi({ projects: [] });
    renderApp("/projects");

    expect(await screen.findByText("Mira Hassan")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "No projects yet" })).toBeInTheDocument();
  });

  it("renders project status and five-step progress", async () => {
    mockApi({
      projects: [
        projectSummary({
          title: "The Wind in the Willows",
          status: "CHARACTERS_DONE",
          currentStep: "PORTRAITS",
          progress: { completed: 2, total: 5 }
        })
      ]
    });
    renderApp("/projects");

    expect(await screen.findByRole("heading", { name: "The Wind in the Willows" })).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByLabelText("2 of 5 steps complete")).toBeInTheDocument();
  });

  it("validates new project input", async () => {
    mockApi();
    renderApp("/projects/new");

    await screen.findByRole("heading", { name: "Start with the book text" });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(screen.getByText("Give the project a title.")).toBeInTheDocument();
  });

  it("shows the project detail current step and optional style action", async () => {
    mockApi({ project: detailProject({ status: "CREATED", currentStep: "STYLE" }) });
    renderApp("/projects/project_00000000-0000-4000-8000-000000000001");

    expect(await screen.findByRole("heading", { name: "Smoke Test Book" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Style" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pipeline progress")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Leave blank and let Gemini choose")).toBeInTheDocument();
  });

  it("shows a named running state", async () => {
    mockApi({
      project: detailProject({
        status: "CHARACTERS_DONE",
        currentStep: "PORTRAITS",
        stepState: runningState("PORTRAITS")
      })
    });
    renderApp("/projects/project_00000000-0000-4000-8000-000000000001");

    expect(await screen.findByText(/Running Portraits/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generating Portraits..." })).toBeDisabled();
  });

  it("shows failed retry state with a concise message", async () => {
    mockApi({
      project: detailProject({
        status: "CREATED",
        currentStep: "STYLE",
        stepState: {
          status: "failed",
          step: "STYLE",
          runId: "run_1",
          startedAt: "2026-08-19T06:00:00.000Z",
          error: {
            message:
              '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","message":"Quota exceeded. See https://ai.google.dev/gemini-api/docs/rate-limits"}}',
            code: "GEMINI_RATE_LIMIT"
          }
        }
      })
    });
    renderApp("/projects/project_00000000-0000-4000-8000-000000000001");

    expect(
      await screen.findByText(
        "Gemini quota or billing is currently unavailable. Check your API quota or billing, then retry this step."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/RESOURCE_EXHAUSTED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ai\.google\.dev/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Quota exceeded/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Style" })).toBeInTheDocument();
  });

  it("shows stale retry state", async () => {
    mockApi({
      project: detailProject({
        status: "CREATED",
        currentStep: "STYLE",
        stepState: {
          status: "stale",
          step: "STYLE",
          runId: "run_old",
          startedAt: "2026-08-19T06:00:00.000Z",
          error: null
        }
      })
    });
    renderApp("/projects/project_00000000-0000-4000-8000-000000000001");

    expect(await screen.findByText(/looks stranded/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Style" })).toBeInTheDocument();
  });

  it("renders partial portrait progress", async () => {
    mockApi({
      project: detailProject({
        status: "CHARACTERS_DONE",
        currentStep: "PORTRAITS",
        stepState: runningState("PORTRAITS"),
        characters: [
          character({ id: "char_1", name: "The Mole", image: doneImage("portraits/char_1.jpg") }),
          character({ id: "char_2", name: "The Water Rat", image: { status: "running", path: null, error: null } })
        ]
      })
    });
    renderApp("/projects/project_00000000-0000-4000-8000-000000000001");

    expect(await screen.findByAltText("Portrait for The Mole")).toHaveAttribute(
      "src",
      "/api/projects/project_00000000-0000-4000-8000-000000000001/images/portraits/char_1.jpg"
    );
    expect(screen.getByText("Generating portrait...")).toBeInTheDocument();
  });

  it("hides raw Gemini portrait errors in failed character cards", async () => {
    mockApi({
      project: detailProject({
        status: "CHARACTERS_DONE",
        currentStep: "PORTRAITS",
        stepState: {
          status: "failed",
          step: "PORTRAITS",
          runId: "run_1",
          startedAt: "2026-08-19T06:00:00.000Z",
          error: {
            message:
              "429 RESOURCE_EXHAUSTED Quota exceeded for metric generativelanguage.googleapis.com/generate_content_free_tier_requests, model: gemini-3.1-flash-image. See https://ai.google.dev/gemini-api/docs/rate-limits",
            code: "GEMINI_RATE_LIMIT"
          }
        },
        characters: [
          character({
            id: "char_1",
            name: "The Mole",
            image: {
              status: "failed",
              path: null,
              error: {
                message:
                  "429 RESOURCE_EXHAUSTED Quota exceeded for metric generativelanguage.googleapis.com/generate_content_free_tier_requests, model: gemini-3.1-flash-image. See https://ai.google.dev/gemini-api/docs/rate-limits",
                code: "GEMINI_RATE_LIMIT"
              }
            }
          }),
          character({ id: "char_2", name: "The Water Rat" })
        ]
      })
    });
    renderApp("/projects/project_00000000-0000-4000-8000-000000000001");

    const friendlyMessage =
      "Portrait generation is unavailable because Gemini image quota or billing is not available. Retry after updating API quota or billing.";

    expect(await screen.findAllByText(friendlyMessage)).toHaveLength(2);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.queryByText(/RESOURCE_EXHAUSTED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/generate_content_free_tier_requests/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ai\.google\.dev/)).not.toBeInTheDocument();
    expect(screen.queryByText(/gemini-3\.1-flash-image/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Portraits" })).toBeInTheDocument();
  });

  it("renders generated portrait and chapter illustration", async () => {
    mockApi({
      project: detailProject({
        status: "DONE",
        currentStep: null,
        characters: [character({ name: "The Mole", image: doneImage("portraits/char_1.jpg") })],
        chapters: [chapter({ image: doneImage("chapters/chapter_1.jpg") })]
      })
    });
    renderApp("/projects/project_00000000-0000-4000-8000-000000000001");

    expect(await screen.findByAltText("Portrait for The Mole")).toBeInTheDocument();
    expect(screen.getByAltText("Scene for Riverbank")).toBeInTheDocument();
    expect(screen.getByText("Final illustration workflow complete.")).toBeInTheDocument();
  });
});

function renderApp(route) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppRoutes />
    </MemoryRouter>
  );
}

function mockApi({ sessionStatus = 200, projects = [], project = detailProject(), bookText = "A short book text." } = {}) {
  global.fetch = vi.fn(async (url, options = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, "");
    const method = options.method ?? "GET";

    if (path === "/api/session" && method === "GET") {
      return json(sessionStatus, sessionStatus === 200 ? { user } : { error: { message: "Sign in required." } });
    }

    if (path === "/api/session" && method === "POST") {
      return json(200, { user });
    }

    if (path === "/api/projects" && method === "GET") {
      return json(200, { projects });
    }

    if (path === "/api/projects" && method === "POST") {
      return json(201, { project });
    }

    if (path.endsWith("/book") && method === "GET") {
      return json(200, { bookText });
    }

    if (path.includes("/api/projects/") && method === "GET") {
      return json(200, { project });
    }

    if (path.includes("/steps/") && method === "POST") {
      return json(200, { type: "running", project: { ...project, stepState: runningState(project.currentStep) } });
    }

    return json(404, { error: { message: `Unhandled ${method} ${path}` } });
  });
}

function json(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function projectSummary(overrides = {}) {
  return {
    id: "project_00000000-0000-4000-8000-000000000001",
    title: "Smoke Test Book",
    createdAt: "2026-08-19T06:00:00.000Z",
    updatedAt: "2026-08-19T06:00:00.000Z",
    status: "CREATED",
    currentStep: "STYLE",
    progress: { completed: 0, total: 5 },
    ...overrides
  };
}

function detailProject(overrides = {}) {
  return {
    ...projectSummary(),
    userEmail: user.email,
    stepState: idleState(),
    gemini: {},
    style: null,
    characters: [],
    chapters: [],
    ...overrides
  };
}

function idleState() {
  return { status: "idle", step: null, runId: null, startedAt: null, error: null };
}

function runningState(step) {
  return {
    status: "running",
    step,
    runId: "run_1",
    startedAt: "2026-08-19T06:00:00.000Z",
    error: null
  };
}

function doneImage(path) {
  return { status: "done", path, error: null, geminiInteractionId: "interaction_1" };
}

function character(overrides = {}) {
  return {
    id: "char_1",
    name: "The Mole",
    prompt: "A gentle adult character portrait prompt.",
    image: { status: "pending", path: null, error: null },
    ...overrides
  };
}

function chapter(overrides = {}) {
  return {
    id: "chapter_1",
    name: "Riverbank",
    prompt: "A scene with the characters by the river.",
    image: { status: "pending", path: null, error: null },
    ...overrides
  };
}
