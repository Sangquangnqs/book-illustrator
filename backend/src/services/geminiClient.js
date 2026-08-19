import { GoogleGenAI } from "@google/genai";
import {
  chapterResponseFormat,
  characterResponseFormat,
  parseChaptersJson,
  parseCharactersJson
} from "./geminiSchemas.js";

export const GEMINI_TEXT_MODEL = "gemini-3.7-flash";
export const GEMINI_IMAGE_MODEL = "gemini-3.1-flash-lite-image";

const imageResponseFormat = {
  type: "image",
  mime_type: "image/jpeg",
  delivery: "inline"
};

export class GeminiClientError extends Error {
  constructor(message, code, options = {}) {
    super(message);
    this.code = code;
    this.status = options.status;
    this.cause = options.cause;
  }
}

export function createGeminiClient({ apiKey, ai } = {}) {
  const client =
    ai ??
    new GoogleGenAI({
      apiKey,
      httpOptions: {
        retryOptions: { attempts: 1 }
      }
    });

  return {
    async ensureBookContext({ project, bookText }) {
      if (project.gemini.fileUri && project.gemini.bookInteractionId) {
        return {
          fileUri: project.gemini.fileUri,
          bookInteractionId: project.gemini.bookInteractionId
        };
      }

      return withGeminiErrors(async () => {
        const file = await client.files.upload({
          file: new Blob([bookText], { type: "text/plain" }),
          config: { mimeType: "text/plain" }
        });

        if (!file.uri) {
          throw new GeminiClientError("Gemini did not return a file URI.", "GEMINI_REQUEST_FAILED");
        }

        const interaction = await createInteraction(client, {
          model: GEMINI_TEXT_MODEL,
          input: [
            {
              type: "text",
              text:
                "This document is the complete book text for a book illustration workflow. " +
                "Remember it as the source material for the following style, character, and chapter prompt steps."
            },
            {
              type: "document",
              uri: file.uri,
              mime_type: file.mimeType ?? "text/plain"
            }
          ]
        });

        return {
          fileUri: file.uri,
          bookInteractionId: interaction.id
        };
      });
    },

    async generateStyle({ project, style }) {
      return withGeminiErrors(async () => {
        const interaction = await createInteraction(client, {
          model: GEMINI_TEXT_MODEL,
          previous_interaction_id: requireId(project.gemini.bookInteractionId, "bookInteractionId"),
          input: style
            ? `Use this exact art direction for the book illustrations: ${style}. Return a concise style description.`
            : "Define a concise visual art style for illustrating this book. Return only the style description."
        });

        return {
          style: requireText(interaction),
          gemini: { styleInteractionId: interaction.id }
        };
      });
    },

    async generateCharacters({ project }) {
      return withGeminiErrors(async () => {
        const interaction = await createInteraction(client, {
          model: GEMINI_TEXT_MODEL,
          previous_interaction_id: requireId(project.gemini.styleInteractionId, "styleInteractionId"),
          response_format: characterResponseFormat,
          input:
            "Identify the main adult characters in the book. Return at most 2 characters. " +
            "For each character, return a name and a detailed Nano Banana portrait prompt. " +
            "Do not include children or more than 2 items."
        });

        return {
          characters: parseCharactersJson(requireText(interaction)),
          gemini: { charactersInteractionId: interaction.id }
        };
      });
    },

    async generatePortrait({ project, character }) {
      return withGeminiErrors(async () => {
        const interaction = await createInteraction(client, {
          model: GEMINI_IMAGE_MODEL,
          previous_interaction_id: requireId(project.gemini.latestImageInteractionId, "latestImageInteractionId"),
          response_format: imageResponseFormat,
          input:
            `Create a character portrait for ${character.name}. ` +
            `Use this prompt: ${character.prompt}. ` +
            "Portrait only, no text, no labels, no frame."
        });

        return {
          bytes: imageBytes(interaction),
          geminiInteractionId: interaction.id,
          gemini: {
            latestImageInteractionId: interaction.id
          }
        };
      });
    },

    async ensureImageContext({ project }) {
      if (project.gemini.charactersImageInteractionId) {
        return {
          charactersImageInteractionId: project.gemini.charactersImageInteractionId,
          latestImageInteractionId:
            project.gemini.latestImageInteractionId ?? project.gemini.charactersImageInteractionId
        };
      }

      return withGeminiErrors(async () => {
        const interaction = await createImageContextInteraction(client, project);

        return {
          charactersImageInteractionId: interaction.id,
          latestImageInteractionId: interaction.id
        };
      });
    },

    async generateChapters({ project }) {
      return withGeminiErrors(async () => {
        const interaction = await createInteraction(client, {
          model: GEMINI_TEXT_MODEL,
          previous_interaction_id: requireId(project.gemini.charactersInteractionId, "charactersInteractionId"),
          response_format: chapterResponseFormat,
          input:
            "Create at most 1 chapter illustration prompt for this book. " +
            "The prompt should reference the generated adult characters and match the established style. " +
            "Return only the JSON array."
        });

        return {
          chapters: parseChaptersJson(requireText(interaction)),
          gemini: { chaptersInteractionId: interaction.id }
        };
      });
    },

    async generateIllustration({ project, chapter }) {
      return withGeminiErrors(async () => {
        const starter = await createInteraction(client, {
          model: GEMINI_IMAGE_MODEL,
          previous_interaction_id: requireId(project.gemini.latestImageInteractionId, "latestImageInteractionId"),
          input:
            "Next, create the final chapter illustration using the established character appearances. " +
            `Chapter: ${chapter.name}. Prompt: ${chapter.prompt}.`
        });
        const interaction = await createInteraction(client, {
          model: GEMINI_IMAGE_MODEL,
          previous_interaction_id: starter.id,
          response_format: imageResponseFormat,
          input:
            `Create the final scene illustration for ${chapter.name}. ` +
            `Use this prompt: ${chapter.prompt}. No text, no captions, no labels.`
        });

        return {
          bytes: imageBytes(interaction),
          geminiInteractionId: interaction.id,
          gemini: { latestImageInteractionId: interaction.id }
        };
      });
    }
  };
}

async function createImageContextInteraction(client, project) {
  return createInteraction(client, {
    model: GEMINI_IMAGE_MODEL,
    input:
      "Start an image-generation chain for this book's character portraits. " +
      `Use this art style consistently: ${project.style}. ` +
      "Keep character appearance consistent across later interactions. No text in images."
  });
}

async function createInteraction(client, params) {
  const interaction = await client.interactions.create({
    store: true,
    ...params
  });
  assertInteractionOk(interaction);
  return interaction;
}

function assertInteractionOk(interaction) {
  if (!interaction?.id) {
    throw new GeminiClientError("Gemini did not return an interaction ID.", "GEMINI_REQUEST_FAILED");
  }

  if (["failed", "cancelled", "incomplete", "budget_exceeded"].includes(interaction.status)) {
    const message = interaction.errors?.[0]?.message ?? `Gemini interaction ${interaction.status}.`;
    throw new GeminiClientError(message, classifyMessage(message), { status: interaction.status });
  }
}

function requireText(interaction) {
  if (!interaction.output_text?.trim()) {
    throw new GeminiClientError("Gemini did not return text output.", "GEMINI_INVALID_OUTPUT");
  }

  return interaction.output_text.trim();
}

function imageBytes(interaction) {
  const data = interaction.output_image?.data;

  if (!data) {
    throw new GeminiClientError("Gemini did not return image data.", "GEMINI_IMAGE_MISSING");
  }

  return Buffer.from(data, "base64");
}

function requireId(value, name) {
  if (!value) {
    throw new GeminiClientError(`Missing Gemini ${name}.`, "GEMINI_REQUEST_FAILED");
  }

  return value;
}

async function withGeminiErrors(callback) {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof GeminiClientError) {
      throw error;
    }

    throw normalizeGeminiError(error);
  }
}

function normalizeGeminiError(error) {
  const status = error?.status ?? error?.code;
  const message = error?.message || "Gemini request failed.";

  if (status === 429 || String(message).includes("429")) {
    return new GeminiClientError(message, "GEMINI_RATE_LIMIT", { status, cause: error });
  }

  return new GeminiClientError(message, classifyMessage(message), { status, cause: error });
}

function classifyMessage(message) {
  const normalized = message.toLowerCase();

  if (normalized.includes("safety") || normalized.includes("blocked") || normalized.includes("policy")) {
    return "GEMINI_BLOCKED";
  }

  if (normalized.includes("json") || normalized.includes("schema") || normalized.includes("output")) {
    return "GEMINI_INVALID_OUTPUT";
  }

  return "GEMINI_REQUEST_FAILED";
}
