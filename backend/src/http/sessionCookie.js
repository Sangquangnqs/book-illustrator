import { createHmac, timingSafeEqual } from "node:crypto";
import { parse, serialize } from "cookie";

const COOKIE_NAME = "bi_session";

export function createSessionCookie(email, secret) {
  return serialize(COOKIE_NAME, signEmail(email, secret), {
    httpOnly: true,
    sameSite: "lax",
    path: "/"
  });
}

export function createClearedSessionCookie() {
  return serialize(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0
  });
}

export function readSignedEmailCookie(cookieHeader, secret) {
  const cookies = parse(cookieHeader || "");
  const value = cookies[COOKIE_NAME];

  if (!value) {
    return null;
  }

  return verifySignedEmail(value, secret);
}

function signEmail(email, secret) {
  const payload = Buffer.from(email, "utf8").toString("base64url");
  const signature = hmac(payload, secret);
  return `${payload}.${signature}`;
}

function verifySignedEmail(value, secret) {
  const parts = value.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [payload, signature] = parts;

  if (!payload || !signature) {
    return null;
  }

  const expected = hmac(payload, secret);
  const signatureBuffer = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    return Buffer.from(payload, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function hmac(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
