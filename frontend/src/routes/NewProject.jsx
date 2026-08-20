import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client.js";

export function NewProject() {
  const navigate = useNavigate();
  const [source, setSource] = useState("paste");
  const [title, setTitle] = useState("");
  const [bookText, setBookText] = useState("");
  const [bookFile, setBookFile] = useState(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    const nextError = validate({ title, source, bookText, bookFile });

    if (nextError) {
      setError(nextError);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const { project } = await api.createProject({
        title: title.trim(),
        bookText: source === "paste" ? bookText.trim() : undefined,
        bookFile: source === "upload" ? bookFile : undefined
      });
      navigate(`/projects/${project.id}`);
    } catch (apiError) {
      setError(apiError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="page narrow">
      <Link className="back-link" to="/projects">
        Back to projects
      </Link>
      <section className="page-header">
        <p className="eyebrow">New project</p>
        <h1>Start with the book text</h1>
        <p>The backend stores the original text once and later reuses Gemini context between steps.</p>
      </section>
      <form className="form-card" onSubmit={handleSubmit} noValidate>
        <label className="field">
          <span>
            Project title <span className="req">*</span>
          </span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="The Wind in the Willows" />
        </label>

        <div className="segmented" role="radiogroup" aria-label="Book source">
          <button
            aria-pressed={source === "paste"}
            className={source === "paste" ? "selected" : ""}
            type="button"
            onClick={() => setSource("paste")}
          >
            Paste text
          </button>
          <button
            aria-pressed={source === "upload"}
            className={source === "upload" ? "selected" : ""}
            type="button"
            onClick={() => setSource("upload")}
          >
            Upload .txt
          </button>
        </div>

        {source === "paste" ? (
          <label className="field">
            <span>
              Book text <span className="req">*</span>
            </span>
            <textarea
              rows={9}
              value={bookText}
              onChange={(event) => setBookText(event.target.value)}
              placeholder="Paste a few chapters or the complete text here..."
            />
          </label>
        ) : (
          <label className={`upload-box ${bookFile ? "has-file" : ""}`}>
            <span>{bookFile ? bookFile.name : "Choose a .txt file"}</span>
            <small>Plain text only. Do not also paste text.</small>
            <input
              type="file"
              accept=".txt,text/plain"
              onChange={(event) => setBookFile(event.target.files?.[0] ?? null)}
            />
          </label>
        )}

        {error ? <p className="form-error">{error}</p> : null}
        <button className="button primary full" type="submit" disabled={submitting} aria-label="Create project">
          {submitting ? "Creating..." : "Create project"}
          {!submitting ? <span aria-hidden="true">-&gt;</span> : null}
        </button>
      </form>
    </main>
  );
}

function validate({ title, source, bookText, bookFile }) {
  if (!title.trim()) return "Give the project a title.";
  if (source === "paste" && !bookText.trim()) return "Paste book text or switch to upload.";
  if (source === "upload" && !bookFile) return "Choose a .txt file or switch to paste.";
  if (source === "upload" && !bookFile.name.toLowerCase().endsWith(".txt")) return "Only .txt uploads are supported.";
  return "";
}
