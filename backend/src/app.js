import express from "express";

export function createApp() {
  const app = express();

  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "book-illustrator-api" });
  });

  return app;
}
