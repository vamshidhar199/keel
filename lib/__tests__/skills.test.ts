import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { getAdminDb, getMetaDb, withUser } from "../db";
import {
  createSkill,
  deleteSkill,
  getSkill,
  getSkillBySlug,
  listSkills,
  parseSkillDraft,
  slugifySkillName,
  updateSkill,
} from "../skills";

let userId: string;

beforeAll(async () => {
  userId = randomUUID();
  await getAdminDb().query(
    `INSERT INTO users (id, email) VALUES ($1, $2)`,
    [userId, `skills-test-${userId}@test`]
  );
});

afterAll(async () => {
  await withUser(userId, async (c) => {
    await c.query(`DELETE FROM skills WHERE user_id = $1`, [userId]);
  });
  await getAdminDb().query(`DELETE FROM users WHERE id = $1`, [userId]);
  await getAdminDb().end();
  await getMetaDb().end();
});

describe("slugifySkillName", () => {
  test("lowercases + hyphenates", () => {
    expect(slugifySkillName("Brief on Acme")).toBe("brief-on-acme");
  });
  test("strips emojis + non-alphanumeric", () => {
    expect(slugifySkillName("Reply!  ✉️ in 3 bullets")).toBe("reply-in-3-bullets");
  });
  test("collapses runs and caps at 40", () => {
    const long = "x".repeat(80);
    expect(slugifySkillName(long).length).toBeLessThanOrEqual(40);
  });
  test("falls back to 'skill' for fully-stripped input", () => {
    expect(slugifySkillName("!!!")).toBe("skill");
  });
});

describe("parseSkillDraft", () => {
  test("parses clean JSON", () => {
    const text = JSON.stringify({
      name: "Brief on Acme",
      slug: "brief-on-acme",
      description: "Summarize Acme threads.",
      instructions: "Always lead with what's open.",
    });
    const draft = parseSkillDraft(text);
    expect(draft).not.toBeNull();
    expect(draft!.slug).toBe("brief-on-acme");
  });

  test("strips a markdown fence", () => {
    const text =
      "```json\n" +
      JSON.stringify({
        name: "Numbers",
        description: "Highlight dollar amounts.",
        instructions: "Always quote dollar amounts when mentioned.",
      }) +
      "\n```";
    const draft = parseSkillDraft(text);
    expect(draft).not.toBeNull();
    expect(draft!.name).toBe("Numbers");
  });

  test("extracts JSON when surrounded by prose", () => {
    const text =
      "Sure!\n" +
      JSON.stringify({
        name: "Three bullets",
        description: "Reply in three bullets.",
        instructions: "Reply in three bullets — no more, no less.",
      }) +
      "\nHope that helps!";
    expect(parseSkillDraft(text)).not.toBeNull();
  });

  test("rejects when required fields missing", () => {
    expect(parseSkillDraft(JSON.stringify({ name: "x" }))).toBeNull();
  });

  test("returns null on garbage", () => {
    expect(parseSkillDraft("not json")).toBeNull();
    expect(parseSkillDraft("")).toBeNull();
    expect(parseSkillDraft("[1,2,3]")).toBeNull();
  });

  test("auto-derives slug if missing", () => {
    const text = JSON.stringify({
      name: "Always Bullet",
      description: "x",
      instructions: "Reply in bullets.",
    });
    const draft = parseSkillDraft(text);
    expect(draft).not.toBeNull();
    expect(draft!.slug).toBe("always-bullet");
  });
});

describe("skills CRUD lifecycle", () => {
  test("create + read + update + delete", async () => {
    const s = await createSkill(userId, {
      name: "Test Skill",
      description: "test",
      instructions: "Always reply briefly.",
    });
    expect(s.slug).toBe("test-skill");
    expect(s.enabled).toBe(true);

    const fetched = await getSkill(userId, s.id);
    expect(fetched?.id).toBe(s.id);

    const bySlug = await getSkillBySlug(userId, "test-skill");
    expect(bySlug?.id).toBe(s.id);

    const list = await listSkills(userId);
    expect(list.find((x) => x.id === s.id)).toBeTruthy();

    const updated = await updateSkill(userId, s.id, { enabled: false });
    expect(updated?.enabled).toBe(false);

    await deleteSkill(userId, s.id);
    expect(await getSkill(userId, s.id)).toBeNull();
  });

  test("slug collisions auto-resolve", async () => {
    const a = await createSkill(userId, {
      name: "Collide",
      instructions: "x",
    });
    const b = await createSkill(userId, {
      name: "Collide",
      instructions: "x",
    });
    expect(a.slug).toBe("collide");
    expect(b.slug).toMatch(/^collide-/);
    expect(b.slug).not.toBe(a.slug);
    await deleteSkill(userId, a.id);
    await deleteSkill(userId, b.id);
  });

  test("listSkills(true) filters disabled", async () => {
    const a = await createSkill(userId, { name: "Enabled A", instructions: "x" });
    const b = await createSkill(userId, { name: "Disabled B", instructions: "x" });
    await updateSkill(userId, b.id, { enabled: false });
    const enabled = await listSkills(userId, true);
    const ids = enabled.map((s) => s.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
    await deleteSkill(userId, a.id);
    await deleteSkill(userId, b.id);
  });
});
