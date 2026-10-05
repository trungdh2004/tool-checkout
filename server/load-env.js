import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve(".env");
if (existsSync(path)) {
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    process.env[key] ??= value;
  }
}
