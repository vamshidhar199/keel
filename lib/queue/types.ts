export type JobType =
  | "sync_gmail"
  | "sync_slack"
  | "sync_salesforce"
  | "extract_emails"
  | "generate_daily_digest"
  | "run_workflow";

export type JobInput =
  | { type: "sync_gmail"; userId: string }
  | { type: "sync_slack"; userId: string }
  | { type: "sync_salesforce"; userId: string }
  | { type: "extract_emails"; userId: string; limit: number }
  | { type: "generate_daily_digest"; userId: string; userEmail: string; localDate: string }
  | { type: "run_workflow"; userId: string; workflowId: string };

export interface Job {
  id: string;
  type: string;
  payload: { userId: string; [k: string]: unknown };
  attempts: number;
  max_attempts: number;
}
