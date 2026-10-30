import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { LiteParse } from "@llamaindex/liteparse";
export const SUPPORTED_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".xlsx",
  ".doc",
  ".xls",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".png",
  ".jpg",
  ".jpeg",
  ".tif",
  ".tiff",
  ".bmp",
  ".webp",
]);

export type FilePreparationResult =
  | { status: "prepared"; sourcePath: string; sourceName: string; textPath: string; markdown: string }
  | { status: "failed"; sourcePath: string; sourceName: string; textPath: null; error: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function uniqueMarkdownPath(outputDir: string, sourceName: string, reserved: Set<string>): Promise<string> {
  const base = path.basename(sourceName, path.extname(sourceName));
  let suffix = 1;
  while (true) {
    const name = `${base}${suffix === 1 ? "" : `-${suffix}`}.md`;
    const candidate = path.join(outputDir, name);
    if (!reserved.has(candidate.toLowerCase()) && !(await pathExists(candidate))) {
      reserved.add(candidate.toLowerCase());
      return candidate;
    }
    suffix += 1;
  }
}

export async function prepareFile(
  inputPath: string,
  outputDir: string,
  reservedPaths: Set<string> = new Set(),
): Promise<FilePreparationResult> {
  const sourcePath = path.resolve(inputPath);
  const sourceName = path.basename(sourcePath);

  try {
    const extension = path.extname(sourcePath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported file type: ${extension || "(no extension)"}`);
    }

    const info = await stat(sourcePath);
    if (!info.isFile()) throw new Error("The provided path is not a file.");

    // PDFs with a readable text layer should bypass LiteParse's failing OCR builder.
    const parser = new LiteParse({ outputFormat: "markdown", ocrEnabled: extension !== ".pdf", quiet: true });
    let markdown: string;
    try {
      const result = await parser.parse(new Uint8Array(await readFile(sourcePath)));
      markdown = result.text.trim();
    } finally {
      parser.close();
    }

    if (!markdown) throw new Error("No readable content was found.");

    await mkdir(outputDir, { recursive: true });
    const markdownPath = await uniqueMarkdownPath(outputDir, sourceName, reservedPaths);
    await writeFile(markdownPath, markdown, "utf8");

    return {
      status: "prepared",
      sourcePath,
      sourceName,
      textPath: path.relative(process.cwd(), markdownPath),
      markdown,
    };
  } catch (error) {
    return {
      status: "failed",
      sourcePath,
      sourceName,
      textPath: null,
      error: errorMessage(error),
    };
  }
}
