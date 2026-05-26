// Constructs a Gmail web URL that opens a specific thread for a specific user.
//
// Two problems with the naive `https://mail.google.com/mail/u/0/#inbox/<id>`:
//   1. `u/0` = "first signed-in account in this browser session", which is NOT
//      necessarily the Mettrie user's Google account if they have multiple
//      Gmail tabs open. Use `authuser=<email>` instead — Gmail resolves it
//      to the correct account by email.
//   2. `#inbox/<id>` only finds the thread if it currently sits in Inbox.
//      Archived / Sent / labeled-but-removed-from-Inbox threads fall back to
//      the inbox listing. `#all/<id>` searches all mail folders.
export function gmailThreadUrl(
  userEmail: string | null | undefined,
  threadRef: string | null | undefined
): string | null {
  if (!threadRef) return null;
  const params = userEmail ? `?authuser=${encodeURIComponent(userEmail)}` : "";
  return `https://mail.google.com/mail/${params}#all/${threadRef}`;
}
