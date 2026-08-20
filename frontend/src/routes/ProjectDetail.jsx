import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client.js";
import { EntityCard } from "../components/EntityCard.jsx";
import { Stepper } from "../components/Stepper.jsx";
import { formatDate, projectStatusLabel, stepLabel } from "../domain/project.js";

export function ProjectDetail() {
  const { projectId } = useParams();
  const [project, setProject] = useState(null);
  const [bookText, setBookText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [style, setStyle] = useState("");
  const [bookOpen, setBookOpen] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  const refresh = useCallback(async () => {
    const [{ project: nextProject }, book] = await Promise.all([api.getProject(projectId), api.getBookText(projectId)]);
    setProject(nextProject);
    setBookText(book.bookText);
    return nextProject;
  }, [projectId]);

  useEffect(() => {
    let active = true;

    refresh()
      .then(() => {
        if (active) setError("");
      })
      .catch((apiError) => {
        if (active) setError(apiError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (project?.stepState.status !== "running") return undefined;

    const timer = window.setInterval(() => {
      refresh().catch((apiError) => setActionError(apiError.message));
    }, 1500);

    return () => window.clearInterval(timer);
  }, [project?.stepState.status, refresh]);

  const currentStep = project?.currentStep;
  const running = project?.stepState.status === "running";
  const failed = project?.stepState.status === "failed";
  const stale = project?.stepState.status === "stale";
  const done = project?.status === "DONE";
  const actionLabel = useMemo(() => {
    if (running) return `Generating ${stepLabel(project.stepState.step)}...`;
    if (failed || stale) return `Retry ${stepLabel(project.stepState.step)}`;
    if (currentStep) return `Generate ${stepLabel(currentStep)}`;
    return "Project complete";
  }, [currentStep, done, failed, project, running, stale]);

  async function runCurrentStep() {
    if (!currentStep || busyAction) return;
    setBusyAction(true);
    setActionError("");

    try {
      const input = currentStep === "STYLE" && style.trim() ? { style: style.trim() } : {};
      const result = await api.runStep(project.id, currentStep, input);
      setProject(result.project);
    } catch (apiError) {
      setActionError(apiError.message);
    } finally {
      setBusyAction(false);
    }
  }

  async function retryStep() {
    const step = project?.stepState.step;
    if (!step || busyAction) return;
    setBusyAction(true);
    setActionError("");

    try {
      const result = await api.retryStep(project.id, step);
      setProject(result.project);
    } catch (apiError) {
      setActionError(apiError.message);
    } finally {
      setBusyAction(false);
    }
  }

  if (loading) {
    return (
      <main className="page">
        <p className="quiet-panel">Loading project...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="page">
        <Link className="back-link" to="/projects">
          Back to projects
        </Link>
        <p className="error-panel">{error}</p>
      </main>
    );
  }

  return (
    <main className="workspace">
      <section className="workspace-header">
        <div>
          <Link className="back-link" to="/projects">
            Back to projects
          </Link>
          <p className="eyebrow">Illustration workspace</p>
          <h1>{project.title}</h1>
          <p>Created {formatDate(project.createdAt)}</p>
          <span className={`status-pill workspace-status ${statusTone(project.status)}`}>
            {projectStatusLabel(project.status)}
          </span>
        </div>
        <button className="button secondary" type="button" onClick={() => setBookOpen(true)}>
          Read book text
        </button>
      </section>

      <Stepper project={project} />

      <section className="workspace-grid">
        <div className="main-column">
          <ActionPanel
            project={project}
            actionLabel={actionLabel}
            actionError={actionError}
            busyAction={busyAction}
            failed={failed}
            running={running}
            stale={stale}
            style={style}
            setStyle={setStyle}
            runCurrentStep={runCurrentStep}
            retryStep={retryStep}
          />

          <Assets project={project} />
        </div>

        <aside className="side-column">
          <section className="summary-panel">
            <h2>Current style</h2>
            {project.style ? <p>{project.style}</p> : <p className="muted">Style appears after the first step.</p>}
          </section>
          <section className="summary-panel">
            <h2>Book text</h2>
            <p className="book-preview">{bookText}</p>
            <button className="button ghost" type="button" onClick={() => setBookOpen(true)}>
              Open full text
            </button>
          </section>
        </aside>
      </section>

      {bookOpen ? <BookDialog title={project.title} text={bookText} onClose={() => setBookOpen(false)} /> : null}
    </main>
  );
}

function ActionPanel({
  project,
  actionLabel,
  actionError,
  busyAction,
  failed,
  running,
  stale,
  style,
  setStyle,
  runCurrentStep,
  retryStep
}) {
  const done = project.status === "DONE";
  const runningStep = project.stepState.step;

  return (
    <section className={`action-panel ${failed || stale ? "needs-attention" : ""}`} aria-live="polite">
      <div>
        <p className="eyebrow">Current action</p>
        <h2>{done ? "All steps complete" : running ? runningHeading(runningStep) : actionLabel}</h2>
        {running ? (
          <p>
            Running {stepLabel(runningStep)} with Gemini. This page polls the backend state and will update when the
            step finishes.
          </p>
        ) : null}
        {failed ? <p>{friendlyStepError(project.stepState.error, project.stepState.step)}</p> : null}
        {stale ? <p>This step looks stranded after a server interruption. Retry it explicitly to continue.</p> : null}
        {!running && !failed && !stale && !done ? <p>Each step runs only when you click. The next step will not auto-start.</p> : null}
      </div>

      {project.currentStep === "STYLE" && !failed && !stale && !running ? (
        <label className="field compact">
          <span>Art style, optional</span>
          <input
            value={style}
            onChange={(event) => setStyle(event.target.value)}
          placeholder="Leave blank and let Gemini choose"
          />
        </label>
      ) : null}

      {actionError ? <p className="form-error">{actionError}</p> : null}

      {done ? (
        <p className="done-note">Final illustration workflow complete.</p>
      ) : (
        <button
          className={`button action-button ${running ? "is-running" : ""} ${failed || stale ? "secondary" : "primary"}`}
          type="button"
          disabled={running || busyAction}
          aria-label={running ? actionLabel : undefined}
          onClick={failed || stale ? retryStep : runCurrentStep}
        >
          {running ? (
            <>
              <span className="button-spinner" aria-hidden="true" />
              <span>Generating...</span>
            </>
          ) : (
            busyAction ? "Starting..." : actionLabel
          )}
        </button>
      )}
      <span className="action-meta">
        {running ? "You can safely refresh this page while generation continues." : "Your progress is saved after each step."}
      </span>
    </section>
  );
}

function runningHeading(step) {
  return {
    STYLE: "Generating visual style",
    CHARACTERS: "Finding main characters",
    PORTRAITS: "Generating character portraits",
    CHAPTERS: "Choosing chapter scene",
    ILLUSTRATIONS: "Generating final illustration"
  }[step] ?? "Generating project assets";
}

function statusTone(status) {
  if (status === "DONE") return "done";
  if (status === "CREATED") return "draft";
  return "active";
}

function friendlyStepError(error, step) {
  const code = error?.code;
  const message = typeof error?.message === "string" ? error.message : "";
  const normalized = `${code ?? ""} ${message}`.toUpperCase();

  if (code === "GEMINI_RATE_LIMIT" || normalized.includes("RESOURCE_EXHAUSTED") || normalized.includes("429")) {
    if (step === "PORTRAITS") {
      return "Portrait generation is unavailable because Gemini image quota or billing is not available. Retry after updating API quota or billing.";
    }

    return "Gemini quota or billing is currently unavailable. Check your API quota or billing, then retry this step.";
  }

  if (code === "GEMINI_BLOCKED") {
    return "Gemini could not generate the requested content. Adjust the book or prompt context, then retry this step.";
  }

  if (code === "GEMINI_INVALID_OUTPUT") {
    return "Gemini returned an invalid result. Retry this step to ask for a fresh response.";
  }

  if (code === "GEMINI_IMAGE_MISSING") {
    return "Gemini did not return an image. Retry this step to generate it again.";
  }

  if (code === "GEMINI_REQUEST_FAILED") {
    if (step === "PORTRAITS") {
      return "Portrait generation failed. Retry the Portraits step to try again.";
    }

    return "Gemini could not complete this request. Check the API status or settings, then retry this step.";
  }

  if (step === "PORTRAITS") {
    return "Portrait generation failed. Retry the Portraits step to try again.";
  }

  return "This step failed. Check your setup if needed, then retry this step.";
}

function Assets({ project }) {
  return (
    <section className="asset-stack">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Generated assets</p>
          <h2>Characters and scenes</h2>
        </div>
      </div>

      {project.characters.length === 0 && project.chapters.length === 0 ? (
        <div className="quiet-panel">Generated characters, portraits, and scenes will appear here as steps complete.</div>
      ) : null}

      {project.characters.length ? (
        <div className="gallery-section">
          <h3>Characters</h3>
          <div className="entity-grid">
            {project.characters.map((character) => (
              <EntityCard key={character.id} projectId={project.id} entity={character} type="character" />
            ))}
          </div>
        </div>
      ) : null}

      {project.chapters.length ? (
        <div className="gallery-section">
          <h3>Chapter illustration</h3>
          <div className="entity-grid single">
            {project.chapters.map((chapter) => (
              <EntityCard key={chapter.id} projectId={project.id} entity={chapter} type="chapter" />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function BookDialog({ title, text, onClose }) {
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="book-dialog" role="dialog" aria-modal="true" aria-labelledby="book-dialog-title">
        <header>
          <div>
            <p className="eyebrow">Book text</p>
            <h2 id="book-dialog-title">{title}</h2>
          </div>
          <button className="button ghost" type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <pre>{text}</pre>
      </section>
    </div>
  );
}
