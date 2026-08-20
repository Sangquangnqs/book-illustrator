import { Link } from "react-router-dom";
import { completedCountForStatus, projectStatusLabel } from "../domain/project.js";

export function ProjectCard({ project }) {
  const completed = project.progress?.completed ?? completedCountForStatus(project.status);

  return (
    <Link className="project-card" to={`/projects/${project.id}`}>
      <div className="project-mark" aria-hidden="true">
        <span>{Math.max(1, completed)}</span>
      </div>
      <div className="project-card-main">
        <span className={`status-pill ${statusTone(project.status)}`}>{projectStatusLabel(project.status)}</span>
        <h2>{project.title}</h2>
        <p>
          Created {formatDate(project.createdAt)}
          {project.updatedAt && project.updatedAt !== project.createdAt ? (
            <>
              {" "}
              &middot; Updated {formatDate(project.updatedAt)}
            </>
          ) : null}
        </p>
      </div>
      <div className="project-progress-block">
        <span>{completed} / 5 complete</span>
        <div className="mini-progress" aria-label={`${completed} of 5 steps complete`}>
          {Array.from({ length: 5 }, (_, index) => (
            <span className={index < completed ? "filled" : ""} key={index} />
          ))}
        </div>
      </div>
    </Link>
  );
}

function statusTone(status) {
  if (status === "DONE") return "done";
  if (status === "CREATED") return "draft";
  return "active";
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value)
  );
}
