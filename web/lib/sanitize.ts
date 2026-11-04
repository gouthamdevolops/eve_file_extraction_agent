export function sanitizeText(value: string): string {
  if (/\n\s*at\s+\S+|\b(?:Error|Exception):\s+.*\n\s*at\s+/i.test(value)) return "[details redacted]";
  return value
    .replace(/(?:[A-Za-z]:\\|\\\\[^\\\s]+\\[^\\\s]+|\/(?:data|app|home|tmp|Users|var|mnt)\/)[^\s"'<>]*/g, "[path redacted]")
    .replace(/\b(password|secret|token|api[_-]?key|credential)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

export function sanitizeResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeResult);
  if (typeof value === "string") return sanitizeText(value);
  if (!value || typeof value !== "object") return value;
  const hidden = new Set(["sourcepath", "sourcepaths", "sourcefile", "textpath", "resultpath", "resultpaths", "uploaddirectory", "rawsourcetext", "documenttext", "fulltext", "markdown", "excerpt", "evidence", "stack", "stacktrace"]);
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (hidden.has(normalized) || normalized.endsWith("path") || normalized.endsWith("paths") || /(password|secret|token|credential|apikey|username)/.test(normalized)) return [];
    return [[key, sanitizeResult(item)]];
  }));
}

export function displayName(sourceName: string): string {
  return sanitizeText(sourceName.replace(/\\/g, "/").split("/").pop() || sourceName);
}
