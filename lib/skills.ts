import { withUser } from "./db";
import { callClaude, SONNET } from "./anthropic";

export interface Skill {
  id: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface SkillRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

function toSkill(r: SkillRow): Skill {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    instructions: r.instructions,
    enabled: r.enabled,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}

// Normalize a freeform name into a slug suitable for / command typeahead.
// Lowercase letters, digits, hyphens only; collapses runs.
export function slugifySkillName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    || "skill";
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listSkills(userId: string, onlyEnabled = false): Promise<Skill[]> {
  return withUser(userId, async (c) => {
    const r = await c.query<SkillRow>(
      `SELECT id, name, slug, description, instructions, enabled, created_at, updated_at
         FROM skills
        ${onlyEnabled ? `WHERE enabled = true` : ``}
        ORDER BY created_at DESC`
    );
    return r.rows.map(toSkill);
  });
}

export async function getSkill(userId: string, id: string): Promise<Skill | null> {
  return withUser(userId, async (c) => {
    const r = await c.query<SkillRow>(
      `SELECT id, name, slug, description, instructions, enabled, created_at, updated_at
         FROM skills WHERE id = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] ? toSkill(r.rows[0]) : null;
  });
}

export async function getSkillBySlug(userId: string, slug: string): Promise<Skill | null> {
  return withUser(userId, async (c) => {
    const r = await c.query<SkillRow>(
      `SELECT id, name, slug, description, instructions, enabled, created_at, updated_at
         FROM skills WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    return r.rows[0] ? toSkill(r.rows[0]) : null;
  });
}

export interface CreateSkillInput {
  name: string;
  slug?: string;
  description?: string;
  instructions: string;
}

// Auto-resolve a unique slug for the user if it would collide.
async function uniqueSlug(userId: string, desired: string): Promise<string> {
  return withUser(userId, async (c) => {
    let candidate = desired;
    for (let i = 0; i < 50; i++) {
      const r = await c.query(`SELECT 1 FROM skills WHERE slug = $1 LIMIT 1`, [candidate]);
      if (r.rows.length === 0) return candidate;
      candidate = `${desired}-${i + 2}`;
    }
    return `${desired}-${Date.now()}`;
  });
}

export async function createSkill(userId: string, input: CreateSkillInput): Promise<Skill> {
  const name = input.name.trim().slice(0, 80);
  const description = (input.description ?? "").trim().slice(0, 200);
  const instructions = input.instructions.trim().slice(0, 4000);
  if (!name) throw new Error("name is required");
  if (!instructions) throw new Error("instructions are required");

  const baseSlug = slugifySkillName(input.slug?.trim() || name);
  const slug = await uniqueSlug(userId, baseSlug);

  return withUser(userId, async (c) => {
    const r = await c.query<SkillRow>(
      `INSERT INTO skills (user_id, name, slug, description, instructions)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, slug, description, instructions, enabled, created_at, updated_at`,
      [userId, name, slug, description, instructions]
    );
    return toSkill(r.rows[0]);
  });
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  instructions?: string;
  enabled?: boolean;
}

export async function updateSkill(
  userId: string,
  id: string,
  input: UpdateSkillInput
): Promise<Skill | null> {
  return withUser(userId, async (c) => {
    const r = await c.query<SkillRow>(
      `UPDATE skills SET
         name         = COALESCE($1, name),
         description  = COALESCE($2, description),
         instructions = COALESCE($3, instructions),
         enabled      = COALESCE($4, enabled),
         updated_at   = now()
       WHERE id = $5
       RETURNING id, name, slug, description, instructions, enabled, created_at, updated_at`,
      [
        input.name?.trim().slice(0, 80) ?? null,
        input.description?.trim().slice(0, 200) ?? null,
        input.instructions?.trim().slice(0, 4000) ?? null,
        typeof input.enabled === "boolean" ? input.enabled : null,
        id,
      ]
    );
    return r.rows[0] ? toSkill(r.rows[0]) : null;
  });
}

export async function deleteSkill(userId: string, id: string): Promise<void> {
  await withUser(userId, async (c) => {
    await c.query(`DELETE FROM skills WHERE id = $1`, [id]);
  });
}

// ── NL drafter ───────────────────────────────────────────────────────────────

export interface SkillDraft {
  name: string;
  slug: string;
  description: string;
  instructions: string;
}

const NL_GENERATOR_SYSTEM = `You convert natural-language "I want a skill that does X" requests into a Keel skill spec.

A skill is a named, reusable system-prompt addendum the user can invoke in chat.
The instructions you produce will be injected on top of the default assistant
behavior whenever the user picks this skill. Write the instructions in second
person (addressed to the AI), e.g. "Always quote dollar amounts" or "Reply in
bullet points, three at a time."

Return STRICT JSON ONLY (no prose, no markdown fences) with this shape:
{
  "name": string,               // 2-5 words, descriptive
  "slug": string,               // lowercase letters + hyphens, <=40 chars (will become /slug for quick invoke)
  "description": string,        // <=140 chars, one sentence the user sees in a picker
  "instructions": string        // 2-6 sentences telling the AI how to behave
}

Guidance:
- Do NOT include data-filtering directives or retrieval hints — skills only
  change behavior, not data scope (v1 limitation).
- Keep instructions concrete. Reject vague phrasing.
- Slug must be unique-ish but the server will rename if it collides.`;

// Robust JSON extraction — handles plain JSON, fenced JSON, and prose-wrapped JSON.
export function parseSkillDraft(text: string): SkillDraft | null {
  const obj = extractFirstJsonObject(text);
  if (!obj) return null;

  const name = typeof obj.name === "string" ? obj.name.trim().slice(0, 80) : "";
  const description =
    typeof obj.description === "string" ? obj.description.trim().slice(0, 200) : "";
  const instructions =
    typeof obj.instructions === "string" ? obj.instructions.trim().slice(0, 4000) : "";
  const rawSlug = typeof obj.slug === "string" ? obj.slug : name;
  const slug = slugifySkillName(rawSlug || name);

  if (!name || !instructions || !slug) return null;
  return { name, slug, description, instructions };
}

function extractFirstJsonObject(text: string): Record<string, unknown> | null {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const v = JSON.parse(cleaned);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    const i = cleaned.indexOf("{");
    const j = cleaned.lastIndexOf("}");
    if (i >= 0 && j > i) {
      try {
        const v = JSON.parse(cleaned.slice(i, j + 1));
        return typeof v === "object" && v !== null && !Array.isArray(v)
          ? (v as Record<string, unknown>)
          : null;
      } catch {}
    }
    return null;
  }
}

export async function generateSkillFromNL(
  userId: string,
  request: string
): Promise<SkillDraft | null> {
  const trimmed = request.trim().slice(0, 600);
  if (!trimmed) return null;

  let text: string;
  try {
    text = await callClaude(
      userId,
      SONNET,
      [{ role: "user", content: trimmed }],
      { system: NL_GENERATOR_SYSTEM, maxTokens: 600 }
    );
  } catch (err) {
    console.error(
      "[skills] generate failed:",
      String((err as Error)?.message ?? err).slice(0, 200)
    );
    return null;
  }
  return parseSkillDraft(text);
}
