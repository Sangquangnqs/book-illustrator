import { api } from "../api/client.js";

export function EntityCard({ projectId, entity, type }) {
  const image = entity.image;
  const imageUrl = image?.path ? api.imageUrl(projectId, image.path) : "";
  const done = image?.status === "done" && imageUrl;
  const title = type === "chapter" ? "Scene" : "Portrait";

  return (
    <article className={`entity-card ${type}`}>
      <div className={`art-frame ${image?.status ?? "pending"}`}>
        {done ? (
          <img src={imageUrl} alt={`${title} for ${entity.name}`} />
        ) : (
          <ImagePlaceholder status={image?.status ?? "pending"} title={title} />
        )}
      </div>
      <div className="entity-body">
        <div className="entity-heading">
          <h3>{entity.name}</h3>
          <span className={`image-status ${image?.status ?? "pending"}`}>{statusLabel(image?.status)}</span>
        </div>
        <p className="prompt-label">{type === "chapter" ? "Scene prompt" : "Portrait prompt"}</p>
        <p className="prompt-text">{entity.prompt}</p>
        {image?.status === "failed" ? <ImageFailureCallout error={image.error} type={type} /> : null}
      </div>
    </article>
  );
}

function ImageFailureCallout({ error, type }) {
  return (
    <div className="image-error-callout" role="alert">
      <span className="image-error-icon" aria-hidden="true">
        !
      </span>
      <div>
        <p className="image-error-title">{failureTitle(type)}</p>
        <p className="image-error-copy">{friendlyImageError(error, type)}</p>
      </div>
    </div>
  );
}

function ImagePlaceholder({ status, title }) {
  if (status === "running") {
    return (
      <div className="placeholder-stack" aria-live="polite">
        <span className="spinner" />
        <span>Generating {title.toLowerCase()}...</span>
      </div>
    );
  }

  if (status === "failed") {
    return <span className="placeholder-label">Generation failed</span>;
  }

  return <span className="placeholder-label">{title} pending</span>;
}

function statusLabel(status) {
  return {
    done: "Done",
    running: "Running",
    failed: "Failed",
    pending: "Pending"
  }[status ?? "pending"];
}

function failureTitle(type) {
  return type === "chapter" ? "Illustration generation unavailable" : "Portrait generation unavailable";
}

function friendlyImageError(error, type) {
  const code = error?.code;
  const message = typeof error?.message === "string" ? error.message : "";
  const normalized = `${code ?? ""} ${message}`.toUpperCase();
  const label = type === "chapter" ? "Illustration" : "Portrait";

  if (code === "GEMINI_RATE_LIMIT" || normalized.includes("RESOURCE_EXHAUSTED") || normalized.includes("429")) {
    return `${label} generation is unavailable because Gemini image quota or billing is not available. Retry after updating API quota or billing.`;
  }

  if (code === "GEMINI_BLOCKED") {
    return `${label} generation was blocked by Gemini. Review the prompt context, then retry the step.`;
  }

  if (code === "GEMINI_INVALID_OUTPUT") {
    return `${label} generation returned an invalid result. Retry the step to ask Gemini again.`;
  }

  if (code === "GEMINI_IMAGE_MISSING") {
    return `${label} generation did not return an image. Retry the step to try again.`;
  }

  return `${label} generation failed. Retry the ${type === "chapter" ? "Illustrations" : "Portraits"} step to try again.`;
}
