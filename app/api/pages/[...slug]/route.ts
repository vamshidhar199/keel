import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withUser } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { parseFrontmatter } from "@/lib/compose";
import { gmailThreadUrl } from "@/lib/gmail-url";

export interface PageDrawerSource {
  ref: string;
  thread_ref: string | null;
  from_addr: string;
  subject: string;
  date_sent: string | null;
  is_from_user: boolean;
  // Pre-built Gmail URL pinned to the logged-in user's account.
  gmail_url: string | null;
}

export interface PageDrawerFact {
  key: string;        // raw frontmatter key, e.g. "company"
  label: string;      // pretty label, e.g. "Company"
  value: string;      // resolved display value, e.g. "Mosaic"
  link?: string;      // when the value was a slug we resolved, link to that page's slug
}

export interface PageDrawerPayload {
  slug: string;
  title: string;
  type: string | null;
  kind: string | null;
  facts: PageDrawerFact[];
  body: string;        // raw markdown — drawer hides behind a "More context" toggle
  updated_at: string;
  sources: PageDrawerSource[];
}

// Frontmatter keys we render structurally (others fall into the unlabeled "extras" bucket
// if they look useful, or are skipped entirely).
const FACT_LABELS: Record<string, string> = {
  company: "Company",
  hiring_manager: "Hiring manager",
  recruiter: "Recruiter",
  role: "Role",
  level: "Level",
  discipline: "Discipline",
  location: "Location",
  compensation: "Compensation",
  salary: "Salary",
  posted_date: "Posted",
  status: "Status",
  contact: "Contact",
  email: "Email",
  needs_po: "Needs PO",
  next_step: "Next step",
};

// Internal / structural keys we never surface as facts.
const SKIP_KEYS = new Set(["title", "type", "kind", "slug", "evidence", "candidate"]);

// Strings that look like internal slugs (people/foo, companies/bar, etc.).
const SLUG_RE = /^(people|companies|projects|topics)\/[a-z0-9-]+$/;

function isSlugRef(v: unknown): v is string {
  return typeof v === "string" && SLUG_RE.test(v);
}

function prettyLabel(key: string): string {
  return FACT_LABELS[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function valueToText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string[] }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug: parts } = await params;
  const slug = (parts ?? []).join("/");
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const payload = await withUser(session.user.id, async (c) => {
    const pageRes = await c.query<{
      id: string;
      slug: string;
      title: string;
      type: string | null;
      kind: string | null;
      compiled_truth: string;
      updated_at: Date;
    }>(
      `SELECT id, slug, title, type, kind, compiled_truth, updated_at
         FROM pages WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    const row = pageRes.rows[0];
    if (!row) return null;

    const { frontmatter, body } = parseFrontmatter(row.compiled_truth ?? "");

    // Collect referenced slugs across all frontmatter values so we can resolve
    // them to readable titles in one query.
    const referenced = new Set<string>();
    for (const [k, v] of Object.entries(frontmatter)) {
      if (SKIP_KEYS.has(k)) continue;
      if (isSlugRef(v)) referenced.add(v);
      if (Array.isArray(v)) {
        for (const item of v) if (isSlugRef(item)) referenced.add(item);
      }
    }
    const titleBySlug = new Map<string, string>();
    if (referenced.size > 0) {
      const r = await c.query<{ slug: string; title: string }>(
        `SELECT slug, title FROM pages WHERE slug = ANY($1)`,
        [[...referenced]]
      );
      for (const row of r.rows) titleBySlug.set(row.slug, row.title);
    }

    const facts: PageDrawerFact[] = [];
    for (const [k, v] of Object.entries(frontmatter)) {
      if (SKIP_KEYS.has(k)) continue;
      if (v == null || v === "") continue;
      if (isSlugRef(v)) {
        facts.push({
          key: k,
          label: prettyLabel(k),
          value: titleBySlug.get(v) ?? v,
          link: v,
        });
      } else if (Array.isArray(v)) {
        // Skip giant arrays — only render small ones of strings/slug-refs
        if (v.length === 0 || v.length > 6) continue;
        const parts: string[] = [];
        for (const item of v) {
          if (isSlugRef(item)) parts.push(titleBySlug.get(item) ?? item);
          else parts.push(valueToText(item));
        }
        facts.push({ key: k, label: prettyLabel(k), value: parts.filter(Boolean).join(", ") });
      } else {
        const txt = valueToText(v);
        if (!txt) continue;
        facts.push({ key: k, label: prettyLabel(k), value: txt });
      }
    }

    // Sources: every raw_event linked via page_sources, decrypted for display.
    const sourceRes = await c.query<{
      ref: string;
      thread_ref: string | null;
      from_addr: string | null;
      subject: string | null;
      date_sent: Date | null;
      is_from_user: boolean;
    }>(
      `SELECT r.source_ref AS ref, r.thread_ref, r.from_addr, r.subject,
              r.date_sent, r.is_from_user
         FROM page_sources ps
         JOIN raw_events r ON r.id = ps.raw_event_id
        WHERE ps.page_id = $1
        ORDER BY r.date_sent DESC NULLS LAST
        LIMIT 20`,
      [row.id]
    );

    const sources: PageDrawerSource[] = sourceRes.rows.map((s) => ({
      ref: s.ref,
      thread_ref: s.thread_ref,
      from_addr: decrypt(s.from_addr ?? null) ?? "",
      subject: decrypt(s.subject ?? null) ?? "(no subject)",
      date_sent: s.date_sent?.toISOString() ?? null,
      is_from_user: s.is_from_user,
      gmail_url: gmailThreadUrl(session.user.email, s.thread_ref),
    }));

    const out: PageDrawerPayload = {
      slug: row.slug,
      title: row.title,
      type: row.type,
      kind: row.kind,
      facts,
      body,
      updated_at: row.updated_at.toISOString(),
      sources,
    };
    return out;
  });

  if (!payload) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(payload);
}
