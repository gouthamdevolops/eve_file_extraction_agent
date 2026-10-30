// Reads the markdownfil sidecars and saves the classification results as json 
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function readMarkdownSidecar(sessionId: string, textPath: string): Promise<string> {
  "use step";
  const outputRoot = path.resolve(process.cwd(), "output");
  const sessionDir = path.resolve(outputRoot, sessionId);
  if (path.dirname(sessionDir) !== outputRoot) {
    throw new Error("The manifest contains an invalid session ID.");
  }
  const documentsDir = path.resolve(sessionDir, "documents");
  const sidecarPath = path.resolve(process.cwd(), textPath);
  const relativePath = path.relative(documentsDir, sidecarPath);
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    throw new Error("The Markdown path is outside this session's documents folder.");
  }

  const info = await stat(sidecarPath);
  if (!info.isFile()) throw new Error("The Markdown sidecar is not a file.");
  return readFile(sidecarPath, "utf8");
}

export async function savePipelineResults(sessionId: string, results: unknown): Promise<string> {
  "use step";
  const outputRoot = path.resolve(process.cwd(), "output");
  const sessionDir = path.resolve(outputRoot, sessionId);
  if (path.dirname(sessionDir) !== outputRoot) {
    throw new Error("The manifest contains an invalid session ID.");
  }
  await mkdir(sessionDir, { recursive: true });

  const resultPath = path.join(sessionDir, "pipeline-results.json");
  const temporaryPath = `${resultPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(results, null, 2), "utf8");
    await rename(temporaryPath, resultPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return path.relative(process.cwd(), resultPath);
}

export async function saveClassificationResults(sessionId: string, results: unknown): Promise<string> {
  "use step";
  const outputRoot = path.resolve(process.cwd(), "output");
  const sessionDir = path.resolve(outputRoot, sessionId);
  if (path.dirname(sessionDir) !== outputRoot) {
    throw new Error("The manifest contains an invalid session ID.");
  }
  await mkdir(sessionDir, { recursive: true });

  const resultPath = path.join(sessionDir, "classification-results.json");
  const temporaryPath = `${resultPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(results, null, 2), "utf8");
    await rename(temporaryPath, resultPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return path.relative(process.cwd(), resultPath);
}
