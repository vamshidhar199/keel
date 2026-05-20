"use client";

import { useEffect, useRef, useState } from "react";

interface FileRecord {
  id: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  parse_status: "pending" | "parsing" | "parsed" | "failed";
  parse_error: string | null;
  raw_event_id: string | null;
  uploaded_at: string;
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusTone(s: FileRecord["parse_status"]): { fg: string; bg: string; label: string } {
  switch (s) {
    case "parsed":
      return { fg: "var(--c-stat3)", bg: "var(--c-stat3-icon)", label: "Extracted" };
    case "parsing":
      return { fg: "var(--c-primary)", bg: "var(--c-primary-m)", label: "Parsing…" };
    case "failed":
      return { fg: "#ef4444", bg: "rgba(239,68,68,0.12)", label: "Failed" };
    default:
      return { fg: "var(--c-subtle)", bg: "var(--c-row-hover)", label: "Pending" };
  }
}

export function FilesPanel() {
  const [files, setFiles] = useState<FileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    const r = await fetch("/api/files");
    const data = r.ok ? await r.json() : { files: [] };
    setFiles(data.files ?? []);
    setLoading(false);
  }

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, []);

  async function upload(file: File) {
    setUploading(true);
    setErrorMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/files/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body.error ?? "Upload failed");
        return;
      }
      await refresh();
    } finally {
      setUploading(false);
    }
  }

  async function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) await upload(file);
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) await upload(file);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function onDelete(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    await fetch(`/api/files/${id}`, { method: "DELETE" });
  }

  return (
    <div className="glass-card rounded-xl p-6 space-y-4 min-h-[220px]">
      <div className="flex items-center gap-3">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "var(--c-stat1-icon)", border: "1px solid var(--c-card-border)" }}
        >
          <span
            className="material-symbols-outlined text-xl leading-none"
            style={{ color: "var(--c-stat1)", fontVariationSettings: "'FILL' 1" }}
          >
            description
          </span>
        </div>
        <div>
          <h4 className="text-xl font-semibold" style={{ color: "var(--c-fg)" }}>
            Files
          </h4>
          <p className="text-sm" style={{ color: "var(--c-subtle)" }}>
            PDFs, Word, Excel, CSV, plain text, Markdown — up to 20 MB.
          </p>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className="rounded-xl p-6 text-center cursor-pointer transition-colors"
        style={{
          border: `1.5px dashed ${
            dragOver ? "var(--c-primary)" : "var(--c-card-border)"
          }`,
          background: dragOver ? "var(--c-row-hover)" : "transparent",
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.tsv,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/plain,text/markdown,text/tab-separated-values"
          className="hidden"
          onChange={onPick}
        />
        <p className="text-[13px] font-medium" style={{ color: "var(--c-fg)" }}>
          {uploading ? "Uploading…" : "Drop a file here or click to choose"}
        </p>
        <p className="text-[11px] mt-1" style={{ color: "var(--c-subtle)" }}>
          PDF · DOCX · XLSX · CSV · TXT · MD
        </p>
        {errorMsg && (
          <p className="text-[11px] mt-2" style={{ color: "#ef4444" }}>
            {errorMsg}
          </p>
        )}
      </div>

      {/* List */}
      {loading ? (
        <p className="text-[12px]" style={{ color: "var(--c-subtle)" }}>
          Loading…
        </p>
      ) : files.length === 0 ? (
        <p className="text-[12px]" style={{ color: "var(--c-subtle)" }}>
          No files uploaded yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {files.map((f) => {
            const tone = statusTone(f.parse_status);
            return (
              <li
                key={f.id}
                className="rounded-lg p-2.5 flex items-center gap-3 group"
                style={{ border: "1px solid var(--c-divider)" }}
              >
                <span
                  className="material-symbols-outlined text-[18px] leading-none shrink-0"
                  style={{ color: "var(--c-subtle)" }}
                >
                  draft
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[13px] font-medium truncate"
                    style={{ color: "var(--c-fg)" }}
                  >
                    {f.filename}
                  </p>
                  <p
                    className="text-[10px] mt-0.5"
                    style={{ color: "var(--c-subtle)" }}
                  >
                    {humanSize(f.byte_size)} · {new Date(f.uploaded_at).toLocaleString()}
                  </p>
                  {f.parse_status === "failed" && f.parse_error && (
                    <p className="text-[10px] mt-0.5" style={{ color: "#ef4444" }}>
                      {f.parse_error}
                    </p>
                  )}
                </div>
                <span
                  className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                  style={{ background: tone.bg, color: tone.fg }}
                >
                  {tone.label}
                </span>
                <button
                  type="button"
                  onClick={() => onDelete(f.id)}
                  aria-label="Delete file"
                  className="p-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:[background:var(--c-row-hover)]"
                  style={{ color: "var(--c-subtle)" }}
                >
                  <span className="material-symbols-outlined text-[14px] leading-none">
                    delete
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
