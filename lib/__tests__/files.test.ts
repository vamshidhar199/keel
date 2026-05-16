import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { getAdminDb, getMetaDb, withUser } from "../db";
import { parseFile, resolveMime, isSupportedMime } from "../file-parsers";
import { listFiles, deleteFile, getFile } from "../files";

let userId: string;

beforeAll(async () => {
  userId = randomUUID();
  await getAdminDb().query(
    `INSERT INTO users (id, email) VALUES ($1, $2)`,
    [userId, `files-test-${userId}@test`]
  );
});

afterAll(async () => {
  await withUser(userId, async (c) => {
    await c.query(`DELETE FROM files WHERE user_id = $1`, [userId]);
  });
  await getMetaDb().query(`DELETE FROM raw_events WHERE user_id = $1`, [userId]);
  await getAdminDb().query(`DELETE FROM users WHERE id = $1`, [userId]);
  await getAdminDb().end();
  await getMetaDb().end();
});

describe("resolveMime fallback", () => {
  test("uses extension when mime is octet-stream", () => {
    expect(resolveMime("application/octet-stream", "doc.pdf")).toBe("application/pdf");
    expect(resolveMime("application/octet-stream", "data.csv")).toBe("text/csv");
    expect(resolveMime("application/octet-stream", "notes.md")).toBe("text/markdown");
  });
  test("respects an already-valid mime", () => {
    expect(resolveMime("text/plain", "junk.bin")).toBe("text/plain");
  });
});

describe("isSupportedMime", () => {
  test("accepts the documented types", () => {
    expect(isSupportedMime("application/pdf")).toBe(true);
    expect(isSupportedMime("text/csv")).toBe(true);
    expect(isSupportedMime("text/markdown")).toBe(true);
  });
  test("rejects unknown types", () => {
    expect(isSupportedMime("image/png")).toBe(false);
    expect(isSupportedMime("application/zip")).toBe(false);
  });
});

describe("parseFile dispatch", () => {
  test("decodes text/plain", async () => {
    const bytes = Buffer.from("hello world\nsecond line", "utf-8");
    const out = await parseFile("text/plain", bytes);
    expect(out).toBe("hello world\nsecond line");
  });

  test("parses CSV into pipe-delimited lines", async () => {
    const bytes = Buffer.from("name,email\nAlice,a@x.com\nBob,b@x.com", "utf-8");
    const out = await parseFile("text/csv", bytes);
    expect(out).toContain("name | email");
    expect(out).toContain("Alice | a@x.com");
  });

  test("rejects unsupported mime", async () => {
    await expect(parseFile("image/png", Buffer.from(""))).rejects.toThrow(/Unsupported/);
  });
});

describe("files lifecycle (manual seed)", () => {
  test("listFiles returns rows for the user; deleteFile removes row + linked raw_event", async () => {
    // Seed a row via direct insert to avoid running the full parser pipeline
    // (which would require real PDF/DOCX bytes). The RLS isolation tests
    // separately confirm cross-tenant safety.
    const evRes = await getMetaDb().query<{ id: string }>(
      `INSERT INTO raw_events (user_id, source, source_ref, subject, from_addr, body_text)
       VALUES ($1, 'file', $2, 'enc', 'enc', 'enc')
       RETURNING id`,
      [userId, `seed-${randomUUID()}`]
    );
    const eventId = evRes.rows[0].id;
    const fRes = await withUser(userId, (c) =>
      c.query<{ id: string }>(
        `INSERT INTO files (user_id, filename, mime_type, byte_size, parse_status, raw_event_id)
         VALUES ($1, 'seed.txt', 'text/plain', 5, 'parsed', $2)
         RETURNING id`,
        [userId, eventId]
      )
    );
    const fileId = fRes.rows[0].id;

    const list = await listFiles(userId);
    expect(list.find((f) => f.id === fileId)).toBeTruthy();

    const got = await getFile(userId, fileId);
    expect(got?.filename).toBe("seed.txt");

    await deleteFile(userId, fileId);
    expect(await getFile(userId, fileId)).toBeNull();
    const evCheck = await getMetaDb().query(
      `SELECT 1 FROM raw_events WHERE id = $1`,
      [eventId]
    );
    expect(evCheck.rows.length).toBe(0);
  });
});
