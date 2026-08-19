import { Router } from "express";
import { z } from "zod";
import { createClearedSessionCookie, createSessionCookie, readSignedEmailCookie } from "../http/sessionCookie.js";

const sessionBodySchema = z
  .object({
    name: z.string().trim().min(1),
    email: z.string().trim().toLowerCase().email()
  })
  .strict();

export function createSessionRouter({ storage, sessionSecret }) {
  const router = Router();

  router.post("/session", async (req, res, next) => {
    try {
      const body = sessionBodySchema.parse(req.body);
      const user = await storage.createUser(body);

      res.setHeader("Set-Cookie", createSessionCookie(user.email, sessionSecret));
      res.status(200).json({ user: publicUser(user) });
    } catch (error) {
      next(error);
    }
  });

  router.get("/session", async (req, res, next) => {
    try {
      const email = readSignedEmailCookie(req.headers.cookie, sessionSecret);

      if (!email) {
        return res.status(401).json({ error: { message: "Sign in required." } });
      }

      const user = await storage.readUser(email);

      if (!user) {
        return res.status(401).json({ error: { message: "Sign in required." } });
      }

      return res.json({ user: publicUser(user) });
    } catch (error) {
      return next(error);
    }
  });

  router.delete("/session", (_req, res) => {
    res.setHeader("Set-Cookie", createClearedSessionCookie());
    res.status(204).end();
  });

  return router;
}

function publicUser(user) {
  return {
    name: user.name,
    email: user.email
  };
}
