import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);

export function imageMimeType(name) {
  return extname(name).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
}

export async function prepareImageFolder(input) {
  if (!input || !isAbsolute(input)) {
    throw new Error("imageFolder must be an absolute path");
  }
  await mkdir(resolve(input), { recursive: true });
  return realpath(resolve(input));
}

export async function listImages(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const images = [];
  for (const entry of entries) {
    if (!entry.isFile() || !IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      continue;
    }
    const details = await stat(join(folder, entry.name));
    images.push({ name: entry.name, size: details.size, updatedAt: details.mtime.toISOString() });
  }
  return images.sort((a, b) => a.name.localeCompare(b.name));
}

export async function randomImage(folder, random = Math.random) {
  const images = await listImages(folder);
  if (images.length === 0) {
    throw new Error("folder does not contain a jpg, jpeg, or png image");
  }
  const selected = images[Math.floor(random() * images.length)];
  return {
    ...selected,
    path: join(folder, selected.name),
    bytes: await readFile(join(folder, selected.name)),
    mimeType: imageMimeType(selected.name),
  };
}

export function hasImageSignature(buffer) {
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return jpeg || png;
}

export async function saveUploadedImage(folder, file) {
  if (!hasImageSignature(file.buffer)) {
    throw new Error(`${file.originalname} is not a valid JPEG or PNG image`);
  }
  const extension = file.buffer[0] === 0xff ? ".jpg" : ".png";
  const stem = basename(file.originalname, extname(file.originalname))
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "image";
  const filename = `${stem}-${Date.now()}-${randomBytes(4).toString("hex")}${extension}`;
  await writeFile(join(folder, filename), file.buffer, { flag: "wx" });
  return filename;
}
