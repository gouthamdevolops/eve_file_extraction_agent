import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { LiteParse } from "@llamaindex/liteparse";
import {
  DocumentsManifestSchema,
  type PreparedDocument,
} from "./documents-manifest-schema.js";

const supportedExtensions = new Set([
  ".pdf", ".docx", ".xlsx", ".doc", ".xls", ".pptx", ".odt", ".ods", ".odp",
  ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".webp",
]);

export async function prepareFolderStep(folderPath: string, sessionId: string) {
  "use step";
  async function exists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  const outputRoot = path.resolve(process.cwd(), "output");
  const sessionDir = path.resolve(outputRoot, sessionId);
  if (path.dirname(sessionDir) !== outputRoot) throw new Error("Invalid session ID.");

  const sourceFolder = path.resolve(folderPath);
  const folderInfo = await stat(sourceFolder);
  if (!folderInfo.isDirectory()) throw new Error("The provided path is not a folder.");

  const entries = await readdir(sourceFolder, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(sourceFolder, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));

  const documentsDir = path.join(sessionDir, "documents");
  await mkdir(documentsDir, { recursive: true });
  const reserved = new Set<string>();
  const documents: PreparedDocument[] = [];

  for (const filePath of files) {
    const sourcePath = path.resolve(filePath);
    const sourceName = path.basename(sourcePath);
    try {
      const extension = path.extname(sourcePath).toLowerCase();
      if (!supportedExtensions.has(extension)) {
        throw new Error(`Unsupported file type: ${extension || "(no extension)"}`);
      }

      const fileInfo = await stat(sourcePath);
      if (!fileInfo.isFile()) throw new Error("The provided path is not a file.");

      // Uploaded PDFs have a readable text layer; avoid LiteParse's failing OCR builder for them.
      const parser = new LiteParse({ outputFormat: "markdown", ocrEnabled: extension !== ".pdf", quiet: true });
      let markdown: string;
      try {
        markdown = (await parser.parse(new Uint8Array(await readFile(sourcePath)))).text.trim();
      } finally {
        parser.close();
      }
      if (!markdown) throw new Error("No readable content was found.");

      const base = path.basename(sourceName, path.extname(sourceName));
      let suffix = 1;
      let markdownPath: string;
      while (true) {
        const candidateName = `${base}${suffix === 1 ? "" : `-${suffix}`}.md`;
        const candidatePath = path.join(documentsDir, candidateName);
        const key = candidatePath.toLowerCase();
        if (!reserved.has(key) && !(await exists(candidatePath))) {
          reserved.add(key);
          markdownPath = candidatePath;
          break;
        }
        suffix += 1;
      }
      await writeFile(markdownPath, markdown, "utf8");
      documents.push({
        sourcePath,
        sourceName,
        status: "prepared",
        textPath: path.relative(process.cwd(), markdownPath),
        error: null,
      });
    } catch (error) {
      documents.push({
        sourcePath,
        sourceName,
        status: "failed",
        textPath: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const manifest = DocumentsManifestSchema.parse({ sessionId, documents });
  const manifestPath = path.join(sessionDir, "documents-manifest.json");
  const temporaryPath = `${manifestPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(manifest, null, 2), "utf8");
    await rename(temporaryPath, manifestPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  return manifest;
}
