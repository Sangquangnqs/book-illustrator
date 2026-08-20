import { Outlet, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.jsx";
import { GradionWordmark } from "./GradionWordmark.jsx";

export function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const initials = (user?.name ?? "?")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function handleSignOut() {
    await signOut();
    navigate("/signin", { replace: true });
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" to="/projects" aria-label="Projects">
            <GradionWordmark className="nav-wordmark" />
          </Link>
          <nav className="nav-links" aria-label="Main navigation">
            <Link to="/projects">Projects</Link>
            <Link to="/projects/new">New project</Link>
          </nav>
          <div className="user-chip">
            <span className="avatar">{initials}</span>
            <span className="user-name">{user?.name}</span>
            <button className="button ghost small" type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>
      <Outlet />
      <footer className="footer">
        <GradionWordmark className="footer-wordmark" />
      </footer>
    </>
  );
}
