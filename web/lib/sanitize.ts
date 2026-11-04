export function sanitizeText(value: string): string {
  if (/\n\s*at\s+\S+|\b(?:Error|Exception):\s+.*\n\s*at\s+/i.test(value)) return "[details redacted]";
  return value
    .replace(/(?:[A-Za-z]:\\|\\\\[^\\\s]+\\[^\\\s]+|\/(?:data|app|home|tmp|Users|var|mnt)\/)[^\s"'<>]*/g, "[path redacted]")
    .replace(/\b(password|secret|token|api[_-]?key|credential)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]");
}

export function displayName(sourceName: string): string {
  return sanitizeText(sourceName.replace(/\\/g, "/").split("/").pop() || sourceName);
}
