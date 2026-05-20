// pdf-parse exports a default function (data: Buffer) => Promise<{ text: string }>.
// We import dynamically so the heavy native bindings aren't loaded unless we
// actually parse a PDF in this process.
export async function parsePdf(bytes: Buffer): Promise<string> {
  const mod = await import("pdf-parse");
  const pdfParse = (mod as { default?: (b: Buffer) => Promise<{ text: string }> }).default
    ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>);
  const result = await pdfParse(bytes);
  return (result.text ?? "").trim();
}
