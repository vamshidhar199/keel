import { auth } from "@/auth";
import { hasGmailScope } from "@/lib/gmail";
import { getGmailStatus } from "@/lib/sync";
import { getExtractionStatus } from "@/lib/pipeline";
import { PageHeader } from "../../components/page-header";
import { GmailPanel } from "../../gmail-panel";
import { ExtractionPanel } from "../../extraction-panel";

export default async function SourcesPage() {
  const session = await auth();
  const userId = session!.user!.id;

  const [gmailConnected, extractionStatus] = await Promise.all([
    hasGmailScope(userId),
    getExtractionStatus(userId),
  ]);
  const gmailStatus = gmailConnected
    ? await getGmailStatus(userId)
    : { connected: false, lastSyncedAt: null, nextSyncAt: null, messageCount: 0, syncIntervalHours: 24 };

  return (
    <div>
      <PageHeader title="Sources" subtitle="Manage your data connections and extraction" />

      <div className="max-w-5xl mx-auto px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          <GmailPanel
            connected={gmailConnected}
            lastSyncedAt={gmailStatus.lastSyncedAt}
            nextSyncAt={gmailStatus.nextSyncAt ?? null}
            messageCount={gmailStatus.messageCount}
            syncIntervalHours={gmailStatus.syncIntervalHours}
          />

          <ExtractionPanel
            pending={extractionStatus.pending}
            extracted={extractionStatus.extracted}
            skipped={extractionStatus.skipped}
            failed={extractionStatus.failed}
            pagesCreated={extractionStatus.pagesCreated}
          />
        </div>
      </div>
    </div>
  );
}
