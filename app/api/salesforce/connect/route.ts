import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { auth } from "@/auth";
import { saveSalesforceAppCreds, getSalesforceAppCreds } from "@/lib/salesforce";

// `api` = read/write data; `refresh_token offline_access` = long-lived refresh token.
const SF_SCOPES = "api refresh_token offline_access";

// Salesforce External Client / Connected Apps with Web Server flow enforce
// PKCE. We generate a random verifier, stash it (alongside the chosen auth
// host) in an HTTP-only cookie scoped to the callback path, and send the
// SHA-256 challenge to the authorize endpoint. The callback reads the
// verifier + host back out of the cookie.
const PKCE_COOKIE = "sf_pkce";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Resolve the OAuth host for this connect attempt.
//
//   domain blank, sandbox=false → login.salesforce.com   (most production users)
//   domain blank, sandbox=true  → test.salesforce.com    (most sandbox users)
//   domain="acme"               → acme.my.salesforce.com (subdomain shorthand)
//   domain="acme.my.salesforce.com" or any full host     → passed through
//
// Anything with a protocol prefix is normalized; trailing paths and the
// `-setup` suffix that appears on Salesforce Setup URLs are also stripped.
function resolveAuthHost(domain: string | null, sandbox: boolean): string {
  if (!domain || !domain.trim()) {
    return sandbox ? "test.salesforce.com" : "login.salesforce.com";
  }
  let host = domain.trim().toLowerCase();
  host = host.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  host = host.replace(/\.salesforce-setup\.com$/, ".salesforce.com");
  if (!host.includes(".")) {
    host = `${host}.my.salesforce.com`;
  }
  return host;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const consumerKey = String(form.get("consumerKey") ?? "").trim();
  const consumerSecret = String(form.get("consumerSecret") ?? "").trim();
  const domain = String(form.get("domain") ?? "").trim();
  const sandbox = form.get("sandbox") === "1" || form.get("sandbox") === "on";

  // Allow Connect-only flow once creds are saved: if the form omits creds
  // but we already have them in DB, reuse those. Otherwise require both.
  if (!consumerKey || !consumerSecret) {
    const existing = await getSalesforceAppCreds(session.user.id);
    if (!existing) {
      return NextResponse.redirect(
        `${process.env.NEXTAUTH_URL}/sources?salesforce_error=missing_credentials`,
        { status: 303 }
      );
    }
  } else {
    await saveSalesforceAppCreds(session.user.id, consumerKey, consumerSecret);
  }

  const creds = await getSalesforceAppCreds(session.user.id);
  if (!creds) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/sources?salesforce_error=missing_credentials`,
      { status: 303 }
    );
  }

  const authHost = resolveAuthHost(domain, sandbox);
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  const state = Buffer.from(session.user.id).toString("base64url");
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/salesforce/callback`;

  const url = new URL(`https://${authHost}/services/oauth2/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", SF_SCOPES);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  // 303 ensures the browser follows with a GET to the Salesforce authorize URL.
  const res = NextResponse.redirect(url.toString(), { status: 303 });
  res.cookies.set(PKCE_COOKIE, JSON.stringify({ v: codeVerifier, h: authHost }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/salesforce/callback",
    maxAge: 600,
  });
  return res;
}
