// mammoth extracts plain text from .docx files. The library accepts a Buffer
// directly via the `buffer` option.
export async function parseDocx(bytes: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: bytes });
  return (result.value ?? "").trim();
}
