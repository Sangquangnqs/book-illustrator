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
            {submitting ? "Signing in..." : "Continue"}
            {!submitting ? <span aria-hidden="true">-&gt;</span> : null}
          </button>
          <p className="auth-note">
            No password. This lightweight identity check uses your email to resume your own saved projects.
          </p>
        </form>
      </section>
    </main>
  );
}

function validate(form) {
  if (!form.name.trim()) return "Enter your name to continue.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "Enter a valid email address.";
  return "";
}
