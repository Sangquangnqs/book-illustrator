import { beforeEach, describe, expect, it, vi } from "vitest";

const googleGenAIConstructor = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: googleGenAIConstructor
}));

const { createGeminiClient, GEMINI_IMAGE_MODEL, GEMINI_TEXT_MODEL } = await import(
  "../src/services/geminiClient.js"
);
const { parseChaptersJson, parseCharactersJson } = await import("../src/services/geminiSchemas.js");

beforeEach(() => {
  googleGenAIConstructor.mockReset();
});

describe("Gemini client", () => {
  it("constructs the SDK with one request attempt", () => {
    googleGenAIConstructor.mockReturnValue(createMockAi());

    createGeminiClient({ apiKey: "test-key" });

    expect(googleGenAIConstructor).toHaveBeenCalledWith({
      apiKey: "test-key",
      httpOptions: {
        retryOptions: { attempts: 1 }
      }
    });
  });

  it("uploads the book once and creates a reusable book interaction", async () => {
    const ai = createMockAi({
      uploadedFile: { uri: "files/book-uri", mimeType: "text/plain" },
      interactions: [{ id: "book-int", status: "completed", output_text: "ok" }]
    });
    const client = createGeminiClient({ ai });

    const result = await client.ensureBookContext({
      project: project({ gemini: {} }),
      bookText: "Book text"
    });

    expect(result).toEqual({ fileUri: "files/book-uri", bookInteractionId: "book-int" });
    expect(ai.files.upload).toHaveBeenCalledTimes(1);
    expect(ai.interactions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: GEMINI_TEXT_MODEL,
        store: true,
        input: expect.arrayContaining([
          expect.objectContaining({ type: "document", uri: "files/book-uri", mime_type: "text/plain" })
        ])
      })
    );
  });

  it("always creates a style interaction chained from the book interaction", async () => {
    const ai = createMockAi({
      interactions: [{ id: "style-int", status: "completed", output_text: "ink wash" }]
    });
    const client = createGeminiClient({ ai });

    const result = await client.generateStyle({
      project: project({ gemini: { bookInteractionId: "book-int" } }),
      style: "ink wash"
    });

    expect(result).toEqual({
      style: "ink wash",
      gemini: { styleInteractionId: "style-int" }
    });
    expect(ai.interactions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: GEMINI_TEXT_MODEL,
        previous_interaction_id: "book-int"
      })
    );
  });

  it("creates character JSON from the style interaction with maxItems schema", async () => {
    const ai = createMockAi({
      interactions: [
        {
          id: "characters-int",
          status: "completed",
          output_text: JSON.stringify([{ name: "Mole", prompt: "Mole prompt" }])
        }
      ]
    });
    const client = createGeminiClient({ ai });

    const result = await client.generateCharacters({
      project: project({ gemini: { styleInteractionId: "style-int" } })
    });

    expect(result).toMatchObject({
      characters: [{ name: "Mole", prompt: "Mole prompt" }],
      gemini: { charactersInteractionId: "characters-int" }
    });
    expect(ai.interactions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        previous_interaction_id: "style-int",
        response_format: expect.objectContaining({
          type: "text",
          mime_type: "application/json",
          schema: expect.objectContaining({ maxItems: 2 })
        })
      })
    );
  });

  it("creates and reuses the separate image interaction chain for portraits", async () => {
    const ai = createMockAi({
      interactions: [
        { id: "image-context", status: "completed", output_text: "ready" },
        {
          id: "portrait-1",
          status: "completed",
          output_image: { type: "image", data: Buffer.from("portrait").toString("base64"), mime_type: "image/jpeg" }
        }
      ]
    });
    const client = createGeminiClient({ ai });

    const context = await client.ensureImageContext({
      project: project({ style: "ink wash", gemini: {} })
    });
    const portrait = await client.generatePortrait({
      project: project({
        gemini: {
          charactersImageInteractionId: context.charactersImageInteractionId,
          latestImageInteractionId: context.latestImageInteractionId
        }
      }),
      character: { id: "char_1", name: "Mole", prompt: "Mole prompt" }
    });

    expect(context).toEqual({
      charactersImageInteractionId: "image-context",
      latestImageInteractionId: "image-context"
    });
    expect(portrait.bytes.toString()).toBe("portrait");
    expect(portrait).toMatchObject({
      geminiInteractionId: "portrait-1",
      gemini: { latestImageInteractionId: "portrait-1" }
    });
    expect(ai.interactions.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: GEMINI_IMAGE_MODEL,
        previous_interaction_id: "image-context",
        response_format: expect.objectContaining({ type: "image" })
      })
    );
  });

  it("creates chapter JSON from charactersInteractionId with maxItems schema", async () => {
    const ai = createMockAi({
      interactions: [
        {
          id: "chapters-int",
          status: "completed",
          output_text: JSON.stringify([{ name: "Riverbank", prompt: "Scene prompt" }])
        }
      ]
    });
    const client = createGeminiClient({ ai });

    const result = await client.generateChapters({
      project: project({ gemini: { charactersInteractionId: "characters-int" } })
    });

    expect(result).toMatchObject({
      chapters: [{ name: "Riverbank", prompt: "Scene prompt" }],
      gemini: { chaptersInteractionId: "chapters-int" }
    });
    expect(ai.interactions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        previous_interaction_id: "characters-int",
        response_format: expect.objectContaining({
          type: "text",
          mime_type: "application/json",
          schema: expect.objectContaining({ maxItems: 1 })
        })
      })
    );
  });

  it("chains the final chapter illustration from the latest image interaction through a starter", async () => {
    const ai = createMockAi({
      interactions: [
        { id: "chapter-image-starter", status: "completed", output_text: "ready" },
        {
          id: "final-image",
          status: "completed",
          output_image: { type: "image", data: Buffer.from("scene").toString("base64"), mime_type: "image/jpeg" }
        }
      ]
    });
    const client = createGeminiClient({ ai });

    const result = await client.generateIllustration({
      project: project({ gemini: { latestImageInteractionId: "portrait-2" } }),
      chapter: { id: "chapter_1", name: "Riverbank", prompt: "Scene prompt" }
    });

    expect(ai.interactions.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ previous_interaction_id: "portrait-2" })
    );
    expect(ai.interactions.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        previous_interaction_id: "chapter-image-starter",
        response_format: expect.objectContaining({ type: "image" })
      })
    );
    expect(result.bytes.toString()).toBe("scene");
    expect(result).toMatchObject({
      geminiInteractionId: "final-image",
      gemini: { latestImageInteractionId: "final-image" }
    });
  });

  it("normalizes rate limit and missing image errors", async () => {
    const rateLimited = createGeminiClient({
      ai: createMockAi({ error: Object.assign(new Error("too many requests"), { status: 429 }) })
    });
    await expect(
      rateLimited.generateStyle({ project: project({ gemini: { bookInteractionId: "book-int" } }) })
    ).rejects.toMatchObject({ code: "GEMINI_RATE_LIMIT" });

    const missingImage = createGeminiClient({
      ai: createMockAi({ interactions: [{ id: "image-int", status: "completed" }] })
    });
    await expect(
      missingImage.generatePortrait({
        project: project({ gemini: { latestImageInteractionId: "image-context" } }),
        character: { id: "char_1", name: "Mole", prompt: "Mole prompt" }
      })
    ).rejects.toMatchObject({ code: "GEMINI_IMAGE_MISSING" });
  });

  it("rejects invalid or oversized structured JSON before pipeline persistence", () => {
    expect(() =>
      parseCharactersJson(
        JSON.stringify([
          { name: "One", prompt: "One prompt" },
          { name: "Two", prompt: "Two prompt" },
          { name: "Three", prompt: "Three prompt" }
        ])
      )
    ).toThrow();
    expect(() =>
      parseChaptersJson(JSON.stringify([{ name: "One", prompt: "One prompt" }, { name: "Two", prompt: "Two prompt" }]))
    ).toThrow();
  });
});

function createMockAi({ uploadedFile, interactions = [], error } = {}) {
  let interactionIndex = 0;

  return {
    files: {
      upload: vi.fn(async () => {
        if (error) {
          throw error;
        }
        return uploadedFile ?? { uri: "files/fake", mimeType: "text/plain" };
      })
    },
    interactions: {
      create: vi.fn(async () => {
        if (error) {
          throw error;
        }
        return interactions[interactionIndex++] ?? { id: "interaction", status: "completed", output_text: "ok" };
      })
    }
  };
}

function project(overrides = {}) {
  return {
    id: "project_1",
    userEmail: "mira@example.com",
    title: "Book",
    style: "warm watercolor",
    characters: [],
    chapters: [],
    gemini: {},
    ...overrides
  };
}
