import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTempDataDir() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "book-illustrator-"));

  return {
    dataDir,
    cleanup: () => rm(dataDir, { recursive: true, force: true })
  };
}
