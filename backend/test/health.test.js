import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("health endpoint", () => {
  it("reports that the API is running", async () => {
    const response = await request(createApp({ sessionSecret: "test-secret" })).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      ok: true,
      service: "book-illustrator-api"
    });
  });
});
