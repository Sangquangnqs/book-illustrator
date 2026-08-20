import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell.jsx";
import { AuthProvider, useAuth } from "./auth/AuthContext.jsx";
import { GradionWordmark } from "./components/GradionWordmark.jsx";
import { Identity } from "./routes/Identity.jsx";
import { NewProject } from "./routes/NewProject.jsx";
import { ProjectDetail } from "./routes/ProjectDetail.jsx";
import { ProjectList } from "./routes/ProjectList.jsx";

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/signin" element={<Identity />} />
        <Route element={<RequireSession />}>
          <Route element={<AppShell />}>
            <Route path="/projects" element={<ProjectList />} />
            <Route path="/projects/new" element={<NewProject />} />
            <Route path="/projects/:projectId" element={<ProjectDetail />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </AuthProvider>
  );
}

function RequireSession() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="center-page">
        <section className="auth-card" aria-live="polite">
          <div className="logo-row">
            <GradionWordmark className="auth-wordmark" />
          </div>
          <h1>Book Illustration Studio</h1>
          <p className="lede">Restoring your workspace...</p>
        </section>
      </main>
    );
  }

  return user ? <Outlet /> : <Navigate to="/signin" replace />;
}
