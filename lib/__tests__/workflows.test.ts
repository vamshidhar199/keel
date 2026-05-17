import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { getAdminDb, getMetaDb, withUser } from "../db";
import {
  CRON_PRESETS,
  createWorkflow,
  deleteWorkflow,
  getWorkflow,
  isCronPresetKey,
  isValidCustomTrigger,
  listDueWorkflows,
  listWorkflows,
  listWorkflowRuns,
  nextRunAtFor,
  nextRunAtFromPreset,
  parseWorkflowDraft,
  renderWorkflowOutput,
  updateWorkflow,
  WORKFLOW_TEMPLATES,
  type WorkflowSourceRef,
} from "../workflows";

let userId: string;

beforeAll(async () => {
  userId = randomUUID();
  await getAdminDb().query(
    `INSERT INTO users (id, email, timezone) VALUES ($1, $2, 'UTC')`,
    [userId, `wf-test-${userId}@test`]
  );
});

afterAll(async () => {
  await withUser(userId, async (c) => {
    await c.query(`DELETE FROM workflow_runs WHERE user_id = $1`, [userId]);
    await c.query(`DELETE FROM workflows WHERE user_id = $1`, [userId]);
  });
  await getAdminDb().query(`DELETE FROM users WHERE id = $1`, [userId]);
  await getAdminDb().end();
  await getMetaDb().end();
});

describe("cron presets", () => {
  test("isCronPresetKey accepts known keys", () => {
    expect(isCronPresetKey("daily_8am")).toBe(true);
    expect(isCronPresetKey("weekday_8am")).toBe(true);
    expect(isCronPresetKey("never")).toBe(false);
  });

  test("daily_8am next firing is in the future", () => {
    const next = nextRunAtFromPreset("daily_8am", "UTC", new Date());
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  test("friday_4pm next firing falls on a Friday (UTC)", () => {
    const next = nextRunAtFromPreset("friday_4pm", "UTC", new Date());
    // 5 = Friday in JS getUTCDay()
    expect(next.getUTCDay()).toBe(5);
    expect(next.getUTCHours()).toBe(16);
  });

  test("nextRunAtFromPreset moves forward when 'after' is exactly the firing time", () => {
    const noonUtc = new Date("2026-06-08T08:00:00Z"); // Monday 8AM UTC
    const next = nextRunAtFromPreset("daily_8am", "UTC", noonUtc);
    expect(next.getTime()).toBeGreaterThan(noonUtc.getTime());
    // Should be next day's 8AM, not the same one.
    expect(next.getUTCDate()).toBe(noonUtc.getUTCDate() + 1);
  });

  test("all presets are reachable in 8 days", () => {
    for (const key of Object.keys(CRON_PRESETS)) {
      const next = nextRunAtFromPreset(key as keyof typeof CRON_PRESETS, "UTC", new Date());
      const gap = next.getTime() - Date.now();
      expect(gap).toBeGreaterThan(0);
      // Within 8 days (most presets hit faster).
      expect(gap).toBeLessThan(8 * 24 * 60 * 60 * 1000);
    }
  });
});

describe("workflow CRUD", () => {
  test("create + read + update + delete lifecycle", async () => {
    const wf = await createWorkflow(
      userId,
      {
        name: "Test workflow",
        description: "lifecycle",
        trigger_cron: "daily_8am",
        filter_nl: "anything urgent",
        prompt_template: "Summarize the items.",
      },
      "UTC"
    );
    expect(wf.name).toBe("Test workflow");
    expect(wf.enabled).toBe(true);
    expect(wf.delivery_type).toBe("in_app");
    expect(new Date(wf.next_run_at).getTime()).toBeGreaterThan(Date.now());

    const fetched = await getWorkflow(userId, wf.id);
    expect(fetched?.id).toBe(wf.id);

    const list = await listWorkflows(userId);
    expect(list.find((w) => w.id === wf.id)).toBeTruthy();

    const updated = await updateWorkflow(
      userId,
      wf.id,
      { enabled: false, trigger_cron: "friday_4pm" },
      "UTC"
    );
    expect(updated?.enabled).toBe(false);
    expect(updated?.trigger_cron).toBe("friday_4pm");
    // next_run_at should recompute when trigger_cron changes
    expect(new Date(updated!.next_run_at).getUTCDay()).toBe(5);

    await deleteWorkflow(userId, wf.id);
    const after = await getWorkflow(userId, wf.id);
    expect(after).toBeNull();
  });
});

describe("listDueWorkflows", () => {
  test("returns enabled workflows past their next_run_at; skips disabled", async () => {
    const past = new Date(Date.now() - 60_000);
    const due = await createWorkflow(
      userId,
      {
        name: "Due workflow",
        trigger_cron: "daily_8am",
        prompt_template: "test",
      },
      "UTC"
    );
    // Force next_run_at to the past so it shows as due.
    await withUser(userId, (c) =>
      c.query(`UPDATE workflows SET next_run_at = $1 WHERE id = $2`, [past, due.id])
    );

    const notDue = await createWorkflow(
      userId,
      {
        name: "Future workflow",
        trigger_cron: "daily_8am",
        prompt_template: "test",
      },
      "UTC"
    );

    const disabled = await createWorkflow(
      userId,
      {
        name: "Disabled workflow",
        trigger_cron: "daily_8am",
        prompt_template: "test",
      },
      "UTC"
    );
    await withUser(userId, (c) =>
      c.query(
        `UPDATE workflows SET enabled = false, next_run_at = $1 WHERE id = $2`,
        [past, disabled.id]
      )
    );

    const dueRows = await listDueWorkflows();
    const ids = dueRows.map((r) => r.id);
    expect(ids).toContain(due.id);
    expect(ids).not.toContain(notDue.id);
    expect(ids).not.toContain(disabled.id);

    // Cleanup
    await deleteWorkflow(userId, due.id);
    await deleteWorkflow(userId, notDue.id);
    await deleteWorkflow(userId, disabled.id);
  });
});

describe("workflow_runs", () => {
  test("listWorkflowRuns is empty for a new workflow and parses source_refs", async () => {
    const wf = await createWorkflow(
      userId,
      {
        name: "Run history test",
        trigger_cron: "daily_8am",
        prompt_template: "test",
      },
      "UTC"
    );

    const empty = await listWorkflowRuns(userId, wf.id);
    expect(empty).toEqual([]);

    // Seed a synthetic run row.
    await withUser(userId, (c) =>
      c.query(
        `INSERT INTO workflow_runs (workflow_id, user_id, status, output_text, source_refs)
         VALUES ($1, $2, 'success', 'hello', $3::jsonb)`,
        [
          wf.id,
          userId,
          JSON.stringify([
            { ref: "thread-1", kind: "thread", label: "test thread" },
          ]),
        ]
      )
    );

    const seeded = await listWorkflowRuns(userId, wf.id);
    expect(seeded.length).toBe(1);
    expect(seeded[0].status).toBe("success");
    expect(seeded[0].source_refs[0].ref).toBe("thread-1");

    await deleteWorkflow(userId, wf.id);
  });
});

describe("templates", () => {
  test("each template has a valid cron preset key", () => {
    for (const t of WORKFLOW_TEMPLATES) {
      expect(isCronPresetKey(t.trigger_cron)).toBe(true);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.prompt_template.length).toBeGreaterThan(0);
    }
  });
});

describe("isValidCustomTrigger", () => {
  test("accepts a valid trigger", () => {
    expect(
      isValidCustomTrigger({ weekdays: [1, 2, 3, 4, 5], hour: 9, minute: 30 })
    ).toBe(true);
    expect(isValidCustomTrigger({ weekdays: [], hour: 0, minute: 0 })).toBe(true);
    expect(isValidCustomTrigger({ weekdays: [0, 6], hour: 23, minute: 59 })).toBe(true);
  });

  test("rejects bad weekdays", () => {
    expect(isValidCustomTrigger({ weekdays: [7], hour: 9, minute: 0 })).toBe(false);
    expect(isValidCustomTrigger({ weekdays: [-1], hour: 9, minute: 0 })).toBe(false);
    expect(isValidCustomTrigger({ weekdays: [1, 1], hour: 9, minute: 0 })).toBe(false);
    expect(isValidCustomTrigger({ weekdays: "mon", hour: 9, minute: 0 })).toBe(false);
  });

  test("rejects bad hour / minute", () => {
    expect(isValidCustomTrigger({ weekdays: [1], hour: 24, minute: 0 })).toBe(false);
    expect(isValidCustomTrigger({ weekdays: [1], hour: -1, minute: 0 })).toBe(false);
    expect(isValidCustomTrigger({ weekdays: [1], hour: 9, minute: 60 })).toBe(false);
    expect(isValidCustomTrigger({ weekdays: [1], hour: 9.5, minute: 0 })).toBe(false);
  });

  test("rejects non-objects", () => {
    expect(isValidCustomTrigger(null)).toBe(false);
    expect(isValidCustomTrigger("foo")).toBe(false);
    expect(isValidCustomTrigger([])).toBe(false);
  });
});

describe("nextRunAtFor (custom + preset)", () => {
  test("custom: Tuesday 3:30 PM UTC fires next on a Tuesday at 15:30", () => {
    const fri = new Date("2026-05-15T12:00:00Z");
    const next = nextRunAtFor(
      "custom",
      { weekdays: [2], hour: 15, minute: 30 },
      "UTC",
      fri
    );
    expect(next.getUTCDay()).toBe(2);
    expect(next.getUTCHours()).toBe(15);
    expect(next.getUTCMinutes()).toBe(30);
    expect(next.getTime()).toBeGreaterThan(fri.getTime());
  });

  test("custom with every day fires next day if already past today's time", () => {
    const today = new Date("2026-05-15T20:00:00Z"); // 8 PM UTC
    const next = nextRunAtFor(
      "custom",
      { weekdays: [], hour: 9, minute: 0 }, // 9 AM every day
      "UTC",
      today
    );
    expect(next.getUTCHours()).toBe(9);
    expect(next.getTime()).toBeGreaterThan(today.getTime());
    expect(next.getUTCDate()).toBe(today.getUTCDate() + 1);
  });

  test("falls back to preset path when trigger_cron is a preset key", () => {
    const presetNext = nextRunAtFromPreset("daily_8am", "UTC", new Date());
    const dispatcherNext = nextRunAtFor("daily_8am", null, "UTC", new Date());
    // Both within a few seconds.
    expect(Math.abs(presetNext.getTime() - dispatcherNext.getTime())).toBeLessThan(2000);
  });

  test("custom without trigger_custom falls back to 1h", () => {
    const now = new Date();
    const next = nextRunAtFor("custom", null, "UTC", now);
    expect(next.getTime() - now.getTime()).toBeGreaterThan(50 * 60 * 1000);
    expect(next.getTime() - now.getTime()).toBeLessThan(70 * 60 * 1000);
  });
});

describe("renderWorkflowOutput", () => {
  const refs: WorkflowSourceRef[] = [
    { ref: "projects/glean-role", kind: "page", label: "Glean Role" },
    { ref: "thread-abc123", kind: "thread", label: "Gabriel — Tech Lead Manager intro" },
    {
      ref: "12345678-1234-1234-1234-123456789abc",
      kind: "commitment",
      label: "Send updated resume to Gabriel",
    },
  ];

  test("converts a page ref into a markdown link", () => {
    const out = renderWorkflowOutput(
      "Check status on [projects/glean-role] next week.",
      refs
    );
    expect(out).toBe("Check status on [Glean Role](/pages/projects/glean-role) next week.");
  });

  test("replaces a commitment UUID with its short label", () => {
    const out = renderWorkflowOutput(
      "Top priority: [12345678-1234-1234-1234-123456789abc] before EOW.",
      refs
    );
    expect(out).toBe("Top priority: Send updated resume to Gabriel before EOW.");
  });

  test("replaces a thread ref with just its label (no link)", () => {
    const out = renderWorkflowOutput("Per [thread-abc123]", refs);
    expect(out).toBe("Per Gabriel — Tech Lead Manager intro");
  });

  test("preserves /ask-style [chunk:N] markers", () => {
    const out = renderWorkflowOutput("As noted [chunk:2] and [chunk:7].", refs);
    expect(out).toBe("As noted [chunk:2] and [chunk:7].");
  });

  test("strips unknown but internal-looking refs (slug or UUID)", () => {
    const out = renderWorkflowOutput(
      "Stale ref [projects/already-deleted] and orphan [aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee].",
      refs
    );
    expect(out).toBe("Stale ref  and orphan .");
  });

  test("leaves user-prose brackets alone (e.g. [TODO], [important])", () => {
    const out = renderWorkflowOutput(
      "Reminder [TODO]: discuss the [important] item.",
      refs
    );
    expect(out).toBe("Reminder [TODO]: discuss the [important] item.");
  });

  test("idempotent on already-clean text", () => {
    const clean = "Just plain prose with no brackets at all.";
    expect(renderWorkflowOutput(clean, refs)).toBe(clean);
  });

  test("handles empty input", () => {
    expect(renderWorkflowOutput("", refs)).toBe("");
  });
});

describe("parseWorkflowDraft (NL generator parser)", () => {
  test("parses a clean JSON response", () => {
    const text = JSON.stringify({
      name: "Friday recap",
      description: "Weekly status summary",
      trigger_cron: "friday_4pm",
      filter_nl: "anything that moved this week",
      prompt_template: "Write a 3-paragraph Friday recap.",
    });
    const draft = parseWorkflowDraft(text);
    expect(draft).not.toBeNull();
    expect(draft!.name).toBe("Friday recap");
    expect(draft!.trigger_cron).toBe("friday_4pm");
  });

  test("strips a markdown fence", () => {
    const text =
      "```json\n" +
      JSON.stringify({
        name: "Daily inbox",
        description: "Overnight emails summary",
        trigger_cron: "weekday_8am",
        filter_nl: "",
        prompt_template: "Summarize last night's emails.",
      }) +
      "\n```";
    const draft = parseWorkflowDraft(text);
    expect(draft).not.toBeNull();
    expect(draft!.trigger_cron).toBe("weekday_8am");
  });

  test("extracts JSON when surrounded by prose", () => {
    const text =
      "Sure! Here is the workflow you asked for:\n\n" +
      JSON.stringify({
        name: "Sunday prep",
        description: "Prep for the week",
        trigger_cron: "sunday_6pm",
        filter_nl: "open commitments",
        prompt_template: "Write the Sunday prep note.",
      }) +
      "\n\nHope that helps!";
    const draft = parseWorkflowDraft(text);
    expect(draft).not.toBeNull();
    expect(draft!.name).toBe("Sunday prep");
  });

  test("rejects when trigger_cron is unknown", () => {
    const text = JSON.stringify({
      name: "Bad",
      description: "x",
      trigger_cron: "every_other_tuesday",
      filter_nl: "",
      prompt_template: "x",
    });
    expect(parseWorkflowDraft(text)).toBeNull();
  });

  test("rejects when required fields are missing", () => {
    const text = JSON.stringify({
      trigger_cron: "daily_8am",
      prompt_template: "x",
      // missing name
    });
    expect(parseWorkflowDraft(text)).toBeNull();
  });

  test("returns null on garbage", () => {
    expect(parseWorkflowDraft("not json")).toBeNull();
    expect(parseWorkflowDraft("")).toBeNull();
    expect(parseWorkflowDraft("[1,2,3]")).toBeNull();
  });

  test("truncates oversized strings", () => {
    const longName = "x".repeat(200);
    const longPrompt = "p".repeat(3000);
    const text = JSON.stringify({
      name: longName,
      description: "ok",
      trigger_cron: "daily_8am",
      filter_nl: "",
      prompt_template: longPrompt,
    });
    const draft = parseWorkflowDraft(text);
    expect(draft).not.toBeNull();
    expect(draft!.name.length).toBeLessThanOrEqual(80);
    expect(draft!.prompt_template.length).toBeLessThanOrEqual(2000);
  });
});
