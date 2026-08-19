import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { ProjectStorage } from "../src/storage/projectStorage.js";
import { createTempDataDir } from "./helpers/tempDataDir.js";

let temp;
let storage;
let app;

beforeEach(async () => {
  temp = await createTempDataDir();
  storage = new ProjectStorage({ dataDir: temp.dataDir });
  app = createApp({ storage, sessionSecret: "test-secret" });
});

afterEach(async () => {
  await temp.cleanup();
});

describe("session routes", () => {
  it("creates a signed HttpOnly session cookie", async () => {
    const response = await request(app).post("/api/session").send({
      name: "Mira Hassan",
      email: "Mira@Example.com"
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      user: {
        name: "Mira Hassan",
        email: "mira@example.com"
      }
    });
    expect(response.headers["set-cookie"][0]).toContain("bi_session=");
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"][0]).toContain("SameSite=Lax");
    expect(response.headers["set-cookie"][0]).toContain("Path=/");
  });

  it("recognizes an existing signed-in user", async () => {
    const agent = request.agent(app);

    await agent.post("/api/session").send({
      name: "Mira Hassan",
      email: "mira@example.com"
    });
    const response = await agent.get("/api/session");

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe("mira@example.com");
  });

  it("returns 401 for missing or tampered session cookies", async () => {
    await request(app).post("/api/session").send({
      name: "Mira Hassan",
      email: "mira@example.com"
    });

    const missing = await request(app).get("/api/session");
    const tampered = await request(app)
      .get("/api/session")
      .set("Cookie", "bi_session=bWlyYUBleGFtcGxlLmNvbQ.invalid");

    expect(missing.status).toBe(401);
    expect(tampered.status).toBe(401);
  });

  it("returns 401 when a signed cookie has extra segments", async () => {
    const signIn = await request(app).post("/api/session").send({
      name: "Mira Hassan",
      email: "mira@example.com"
    });
    const validCookie = signIn.headers["set-cookie"][0].split(";")[0];

    const response = await request(app)
      .get("/api/session")
      .set("Cookie", `${validCookie}.extra`);

    expect(response.status).toBe(401);
  });

  it("clears the session cookie on sign out", async () => {
    const response = await request(app).delete("/api/session");

    expect(response.status).toBe(204);
    expect(response.headers["set-cookie"][0]).toContain("Max-Age=0");
  });
});
