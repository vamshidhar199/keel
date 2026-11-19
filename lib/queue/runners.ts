import { syncGmail, syncSlack, syncSalesforce } from "../sync";
import { processRawEvent } from "../pipeline";
import { getMetaDb } from "../db";
import { composeDigest, writeDigest } from "../digest";
import { runWorkflow } from "../workflows";
import { enqueue } from "./enqueue";

type Runner = (payload: any) => Promise<void>;

export const runners: Record<string, Runner> = {
  sync_gmail: async (p) => {
    const result = await syncGmail(p.userId);
    console.log(`[queue] sync_gmail user=${p.userId} new=${result.newMessages}`);
    if (result.newMessages > 0) {
      await enqueue({ type: "extract_emails", userId: p.userId, limit: result.newMessages });
    }
  },

  sync_slack: async (p) => {
    const result = await syncSlack(p.userId);
    console.log(`[queue] sync_slack user=${p.userId} new=${result.newMessages}`);
    if (result.newMessages > 0) {
      await enqueue({ type: "extract_emails", userId: p.userId, limit: result.newMessages });
    }
  },

  sync_salesforce: async (p) => {
    const result = await syncSalesforce(p.userId);
    console.log(`[queue] sync_salesforce user=${p.userId} new=${result.newMessages}`);
    if (result.newMessages > 0) {
      await enqueue({ type: "extract_emails", userId: p.userId, limit: result.newMessages });
    }
  },

  extract_emails: async (p) => {
    const db = getMetaDb();
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM raw_events
       WHERE user_id = $1 AND extraction_status = 'pending'
       ORDER BY date_sent DESC NULLS LAST LIMIT $2`,
      [p.userId, p.limit ?? 20]
    );
    console.log(`[queue] extract_emails user=${p.userId} count=${rows.length}`);

    // Process in chunks of 2 concurrent events. With P1's ~6K tokens per
    // event, 2 in flight = ~12K burst — safe even at Tier 1 (30K Sonnet,
    // 50K Haiku ITPM). processRawEvent throws on rate-limit so Promise.all
    // fails fast → drain.ts retries the job with backoff while events stay
    // pending. Don't raise concurrency without adaptive throttling.
    const CONCURRENCY = 2;
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async ({ id }) => {
          const result = await processRawEvent(p.userId, id);
          console.log(
            `[queue] event=${id} status=${result.status} pages=${result.pagesWritten.length}${result.error ? ` error=${result.error.slice(0, 200)}` : ""}`
          );
        })
      );
    }
  },

  generate_daily_digest: async (p) => {
    console.log(`[queue] generate_daily_digest user=${p.userId} date=${p.localDate}`);
    const content = await composeDigest(p.userId, p.userEmail);
    await writeDigest(p.userId, p.localDate, content);
  },

  run_workflow: async (p) => {
    console.log(`[queue] run_workflow user=${p.userId} workflow=${p.workflowId}`);
    const result = await runWorkflow(p.userId, p.workflowId);
    console.log(`[queue] workflow=${p.workflowId} status=${result.status}`);
  },
};
