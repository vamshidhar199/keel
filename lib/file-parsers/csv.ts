// Decode CSV/TSV with the sync parser, then re-render as a pipe-delimited
// text block. Keeps row structure visible to the extraction LLM without
// needing it to handle CSV syntax.
export async function parseCsv(bytes: Buffer): Promise<string> {
  const { parse } = await import("csv-parse/sync");
  const records: string[][] = parse(bytes, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });
  return records
    .map((row) => row.map((cell) => String(cell ?? "")).join(" | "))
    .filter((line) => line.trim().length > 0)
    .join("\n");
}
