import { NextRequest, NextResponse } from "next/server";
import { saveSlackTokens } from "@/lib/slack";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?slack_error=${error}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?slack_error=missing_params`);
  }

  // Recover userId from state.
  let userId: string;
  try {
    userId = Buffer.from(state, "base64url").toString("utf-8");
  } catch {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?slack_error=invalid_state`);
  }

  // Exchange code for tokens.
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/slack/callback`;
  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID!,
      client_secret: process.env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const data = await res.json();
  if (!data.ok || !data.authed_user?.access_token) {
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL}/sources?slack_error=${data.error ?? "token_exchange_failed"}`
    );
  }

  await saveSlackTokens(
    userId,
    {
      id: data.authed_user.id,
      access_token: data.authed_user.access_token,
      scope: data.authed_user.scope ?? "",
    },
    data.team?.id ?? ""
  );

  return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/sources?slack_connected=1`);
}
