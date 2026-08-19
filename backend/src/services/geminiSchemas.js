import { z } from "zod";

export const characterResultSchema = z
  .array(
    z
      .object({
        name: z.string().trim().min(1),
        prompt: z.string().trim().min(1)
      })
      .strict()
  )
  .max(2);

export const chapterResultSchema = z
  .array(
    z
      .object({
        name: z.string().trim().min(1),
        prompt: z.string().trim().min(1)
      })
      .strict()
  )
  .max(1);

export const characterResponseFormat = {
  type: "text",
  mime_type: "application/json",
  schema: {
    type: "array",
    maxItems: 2,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["name", "prompt"],
      properties: {
        name: { type: "string" },
        prompt: { type: "string" }
      }
    }
  }
};

export const chapterResponseFormat = {
  type: "text",
  mime_type: "application/json",
  schema: {
    type: "array",
    maxItems: 1,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["name", "prompt"],
      properties: {
        name: { type: "string" },
        prompt: { type: "string" }
      }
    }
  }
};

export function parseCharactersJson(text) {
  return characterResultSchema.parse(JSON.parse(text));
}

export function parseChaptersJson(text) {
  return chapterResultSchema.parse(JSON.parse(text));
}
