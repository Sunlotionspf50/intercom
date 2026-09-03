import { readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const workerOutput = fileURLToPath(new URL("../dist/intercom/", import.meta.url));

let entries = [];
try {
  entries = await readdir(workerOutput);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

for (const entry of entries) {
  if (entry === ".env" || entry.startsWith(".env.") || entry === ".dev.vars" || entry.startsWith(".dev.vars.")) {
    await rm(new URL(`../dist/intercom/${entry}`, import.meta.url), { force: true });
  }
}
