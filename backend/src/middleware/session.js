import { readSignedEmailCookie } from "../http/sessionCookie.js";

export function requireSession({ storage, sessionSecret }) {
  return async (req, res, next) => {
    try {
      const email = readSignedEmailCookie(req.headers.cookie, sessionSecret);

      if (!email) {
        return res.status(401).json({ error: { message: "Sign in required." } });
      }

      const user = await storage.readUser(email);

      if (!user) {
        return res.status(401).json({ error: { message: "Sign in required." } });
      }

      req.currentUser = user;
      req.currentUserEmail = user.email;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
