import { parsePdf } from "./pdf";
import { parseDocx } from "./docx";
import { parseXlsx } from "./xlsx";
import { parseCsv } from "./csv";
import { parseText } from "./text";

export type SupportedMime =
  | "application/pdf"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  | "application/vnd.ms-excel"
  | "text/csv"
  | "application/csv"
  | "text/tab-separated-values"
  | "text/plain"
  | "text/markdown";

// Some clients send `application/octet-stream` for files dragged in from the
// file manager — fall back to the filename extension when mime is generic.
export function resolveMime(rawMime: string, filename: string): string {
  if (rawMime && rawMime !== "application/octet-stream") return rawMime;
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    txt: "text/plain",
    md: "text/markdown",
    markdown: "text/markdown",
  };
  return map[ext] ?? rawMime;
}

export function isSupportedMime(mime: string): boolean {
  switch (mime) {
    case "application/pdf":
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/msword":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.ms-excel":
    case "text/csv":
    case "application/csv":
    case "text/tab-separated-values":
    case "text/plain":
    case "text/markdown":
      return true;
    default:
      return false;
  }
}

// Single dispatcher — decoded plain text out, mime+bytes in.
export async function parseFile(mime: string, bytes: Buffer): Promise<string> {
  switch (mime) {
    case "application/pdf":
      return parsePdf(bytes);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/msword":
      return parseDocx(bytes);
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    case "application/vnd.ms-excel":
      return parseXlsx(bytes);
    case "text/csv":
    case "application/csv":
    case "text/tab-separated-values":
      return parseCsv(bytes);
    case "text/plain":
    case "text/markdown":
      return parseText(bytes);
    default:
      throw new Error(`Unsupported mime type: ${mime}`);
  }
}
