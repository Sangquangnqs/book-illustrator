import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { GradionWordmark } from "../components/GradionWordmark.jsx";
import { useAuth } from "../auth/AuthContext.jsx";

export function Identity() {
  const { user, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) {
    return <Navigate to="/projects" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const nextError = validate(form);

    if (nextError) {
      setError(nextError);
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await signIn(form);
      navigate("/projects", { replace: true });
    } catch (apiError) {
      setError(apiError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="center-page auth-page">
      <div className="auth-layout">
        <section className="auth-story" aria-label="Book illustration studio preview">
          <GradionWordmark className="auth-story-wordmark" />
          <div className="story-copy">
            <p className="eyebrow">Book Illustration Studio</p>
            <h2>Turn stories into illustrated worlds</h2>
            <p>
              Upload or paste a book, then guide a five-step Gemini workflow from style to final chapter art.
            </p>
          </div>
          <div className="studio-preview" aria-hidden="true">
            <div className="paper-sheet sheet-back" />
            <div className="paper-sheet sheet-front">
              <span className="story-line wide" />
              <span className="story-line" />
              <span className="story-line short" />
              <div className="thumbnail-row">
                <span />
                <span />
              </div>
            </div>
            <div className="ink-frame">
              <span className="sun" />
              <span className="hill" />
              <span className="figure" />
            </div>
          </div>
        </section>

        <section className="auth-card" aria-labelledby="identity-title">
          <div className="logo-row">
            <GradionWordmark className="auth-wordmark" />
          </div>
          <h1 id="identity-title">Book Illustration Studio</h1>
          <p className="lede">Enter your details to start or resume an illustration project.</p>
          <form onSubmit={handleSubmit} noValidate>
            <label className="field">
              <span>
                Full name <span className="req">*</span>
              </span>
              <input
                autoComplete="name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Mira Hassan"
              />
            </label>
            <label className="field">
              <span>
                Email <span className="req">*</span>
              </span>
              <input
                autoComplete="email"
                type="email"
                value={form.email}
                onChange={(event) => setForm({ ...form, email: event.target.value })}
                placeholder="mira@example.com"
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <button className="button primary full auth-submit" type="submit" disabled={submitting} aria-label="Continue">
              <span>{submitting ? "Signing in..." : "Continue"}</span>
              {!submitting ? <span className="button-arrow" aria-hidden="true">&rarr;</span> : null}
            </button>
            <p className="auth-note">
              No password. This lightweight identity check uses your email to resume your own saved projects.
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}

function validate(form) {
  if (!form.name.trim()) return "Enter your name to continue.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Enter a valid email address.";
  return "";
}
