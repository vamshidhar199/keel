// Flatten every sheet's cells to a row-per-line text block. Good enough for
// extraction to pick up names, dates, dollar amounts, etc. without us having
// to design a sheet-aware schema.
export async function parseXlsx(bytes: Buffer): Promise<string> {
  const xlsx = await import("xlsx");
  const wb = xlsx.read(bytes, { type: "buffer" });
  const blocks: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows: unknown[][] = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    const lines = rows
      .map((row) => row.map((cell) => String(cell ?? "").trim()).filter(Boolean).join(" | "))
      .filter((line) => line.length > 0);
    if (lines.length === 0) continue;
    blocks.push(`# Sheet: ${sheetName}\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n").trim();
}
