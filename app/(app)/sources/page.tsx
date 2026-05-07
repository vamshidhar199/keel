import { auth } from "@/auth";
import { hasGmailScope } from "@/lib/gmail";
import { hasSlackConnected } from "@/lib/slack";
import { getGmailStatus, getSlackStatus } from "@/lib/sync";
import { getExtractionStatus } from "@/lib/pipeline";
import { GmailPanel } from "../../gmail-panel";
import { SlackPanel } from "../../slack-panel";
import { ExtractionPanel } from "../../extraction-panel";

export default async function SourcesPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const [gmailConnected, slackConnected, extractionStatus] = await Promise.all([
    hasGmailScope(userId),
    hasSlackConnected(userId),
    getExtractionStatus(userId),
  ]);

  const [gmailStatus, slackStatus] = await Promise.all([
    gmailConnected
      ? getGmailStatus(userId)
      : { connected: false, lastSyncedAt: null, nextSyncAt: null, messageCount: 0, syncIntervalHours: 24 },
    slackConnected
      ? getSlackStatus(userId)
      : { connected: false, teamName: null, lastSyncedAt: null, nextSyncAt: null, messageCount: 0, syncIntervalHours: 24 },
  ]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="header-glass sticky top-0 h-16 flex items-center px-6 z-30">
        <h1 className="text-2xl font-bold" style={{ color: "var(--c-fg)" }}>Sources</h1>
      </header>

      <div className="px-6 py-8 space-y-6">
        {/* Extraction analytics */}
        <ExtractionPanel
          pending={extractionStatus.pending}
          extracted={extractionStatus.extracted}
          skipped={extractionStatus.skipped}
          failed={extractionStatus.failed}
          pagesCreated={extractionStatus.pagesCreated}
        />

        {/* Integration source cards */}
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-widest mb-4" style={{ color: "var(--c-subtle)" }}>Connected Sources</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            <GmailPanel
              connected={gmailConnected}
              lastSyncedAt={gmailStatus.lastSyncedAt}
              nextSyncAt={gmailStatus.nextSyncAt ?? null}
              messageCount={gmailStatus.messageCount}
              syncIntervalHours={gmailStatus.syncIntervalHours}
            />
            <SlackPanel
              connected={slackConnected}
              teamName={slackStatus.teamName ?? null}
              lastSyncedAt={slackStatus.lastSyncedAt}
              nextSyncAt={slackStatus.nextSyncAt ?? null}
              messageCount={slackStatus.messageCount}
              syncIntervalHours={slackStatus.syncIntervalHours}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
