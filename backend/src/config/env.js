import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(currentDir, "../..");
const repoRoot = path.resolve(backendRoot, "..");

export function loadEnv() {
  dotenv.config({ path: path.join(repoRoot, ".env") });
  dotenv.config({ path: path.join(backendRoot, ".env") });
}

export function getDataDir() {
  return process.env.DATA_DIR || path.join(repoRoot, "data");
}

export function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret) {
    throw new Error("SESSION_SECRET is required");
  }

  return secret;
}

export function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required");
  }

  return apiKey;
}
