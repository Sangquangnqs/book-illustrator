import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { ProjectCard } from "../components/ProjectCard.jsx";

export function ProjectList() {
  const [state, setState] = useState({ loading: true, projects: [], error: "" });

  useEffect(() => {
    let active = true;

    api
      .listProjects()
      .then(({ projects }) => {
        if (active) setState({ loading: false, projects, error: "" });
      })
      .catch((error) => {
        if (active) setState({ loading: false, projects: [], error: error.message });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="page">
      <section className="page-header split">
        <div>
          <p className="eyebrow">Projects</p>
          <h1>Your illustration workbench</h1>
          <p>Each project resumes from persisted backend state, including running or failed steps.</p>
        </div>
        <Link className="button primary" to="/projects/new">
          Create project
        </Link>
      </section>

      {state.loading ? <p className="quiet-panel">Loading projects...</p> : null}
      {state.error ? <p className="error-panel">{state.error}</p> : null}
      {!state.loading && !state.error && state.projects.length === 0 ? <EmptyState /> : null}
      {state.projects.length ? (
        <section className="project-grid" aria-label="Project list">
          {state.projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </section>
      ) : null}
    </main>
  );
}

function EmptyState() {
  return (
    <section className="empty-state">
      <div className="empty-orbit" aria-hidden="true" />
      <h2>No projects yet</h2>
      <p>Create a project from pasted text or a `.txt` upload, then run the five Gemini steps one at a time.</p>
      <Link className="button primary" to="/projects/new">
        Start the first project
      </Link>
    </section>
  );
}
