// Plain text + Markdown — UTF-8 decode and return as-is.
export function parseText(bytes: Buffer): string {
  return bytes.toString("utf-8").trim();
}
