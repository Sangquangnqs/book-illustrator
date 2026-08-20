const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function request(path, options = {}) {
  const headers = options.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const response = await fetch(`${API_BASE}/api${path}`, {
    credentials: "include",
    ...options,
    headers: {
      ...headers,
      ...(options.headers ?? {})
    }
  });

  if (response.status === 204) {
    return null;
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(body.error?.message ?? "Request failed.");
    error.status = response.status;
    error.details = body.error?.details;
    throw error;
  }

  return body;
}

export const api = {
  getSession: () => request("/session"),
  signIn: (body) => request("/session", { method: "POST", body: JSON.stringify(body) }),
  signOut: () => request("/session", { method: "DELETE" }),
  listProjects: () => request("/projects"),
  getProject: (projectId) => request(`/projects/${projectId}`),
  getBookText: (projectId) => request(`/projects/${projectId}/book`),
  createProject: ({ title, bookText, bookFile }) => {
    if (bookFile) {
      const form = new FormData();
      form.append("title", title);
      form.append("bookFile", bookFile);
      return request("/projects", { method: "POST", body: form });
    }

    return request("/projects", {
      method: "POST",
      body: JSON.stringify({ title, bookText })
    });
  },
  runStep: (projectId, step, input = {}) =>
    request(`/projects/${projectId}/steps/${step}/run`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  retryStep: (projectId, step) =>
    request(`/projects/${projectId}/steps/${step}/retry`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  imageUrl: (projectId, imagePath) => {
    if (!imagePath) return "";
    const [kind, fileName] = imagePath.split("/");
    return `${API_BASE}/api/projects/${projectId}/images/${encodeURIComponent(kind)}/${encodeURIComponent(fileName)}`;
  }
};
