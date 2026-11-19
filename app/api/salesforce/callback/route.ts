import { NextRequest, NextResponse } from "next/server";
import { saveSalesforceTokens, getSalesforceAppCreds } from "@/lib/salesforce";

const PKCE_COOKIE = "sf_pkce";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?salesforce_error=${error}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?salesforce_error=missing_params`);
  }

  let userId: string;
  try {
    userId = Buffer.from(state, "base64url").toString("utf-8");
  } catch {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?salesforce_error=invalid_state`);
  }

  const pkceRaw = req.cookies.get(PKCE_COOKIE)?.value;
  if (!pkceRaw) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?salesforce_error=missing_pkce`);
  }
  let codeVerifier: string;
  let authHost: string;
  try {
    const parsed = JSON.parse(pkceRaw);
    codeVerifier = String(parsed.v ?? "");
    authHost = String(parsed.h ?? "");
    if (!codeVerifier || !authHost) throw new Error("missing fields");
  } catch {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?salesforce_error=invalid_pkce`);
  }

  const creds = await getSalesforceAppCreds(userId);
  if (!creds) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?salesforce_error=missing_credentials`);
  }

  const redirectUri = `${process.env.NEXTAUTH_URL}/api/salesforce/callback`;
  // Exchange code at the SAME host the authorize step used. Salesforce ties
  // the OAuth session to the host; using a different one returns invalid_grant.
  const res = await fetch(`https://${authHost}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.access_token || !data.refresh_token || !data.instance_url) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/sources?salesforce_error=${data.error ?? "token_exchange_failed"}`
    );
  }

  // `id` is a URL like https://login.salesforce.com/id/{orgId}/{userId};
  // last path segment is the SF user id, used as the unique upsert key.
  const sfUserId = String(data.id ?? "").split("/").filter(Boolean).pop() ?? "";
  if (!sfUserId) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?salesforce_error=missing_user_id`);
  }

  await saveSalesforceTokens(userId, {
    salesforceUserId: sfUserId,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    instance_url: data.instance_url,
    scope: data.scope ?? "",
  });

  const redirect = NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?salesforce_connected=1`);
  redirect.cookies.delete(PKCE_COOKIE);
  return redirect;
}
