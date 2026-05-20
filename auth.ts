import NextAuth, { DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import PostgresAdapter from "@auth/pg-adapter";
import { getMetaDb } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

const nextAuth = NextAuth({
  adapter: PostgresAdapter(getMetaDb()),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          // access_type: 'offline' = ask Google for a refresh_token alongside
          // the access_token, so we can keep syncing Gmail after the user
          // closes the tab.
          access_type: "offline",
          // We deliberately do NOT set prompt: 'consent' here. Forcing consent
          // on every sign-in shows the full consent screen (plus, until
          // verification clears, the "unverified app" warning) every login —
          // brutal for retention. Without this param, Google only shows
          // consent on the first authorization for a given (user × scope set);
          // subsequent logins bounce straight through.
          //
          // Refresh-token implication: Google only issues a refresh_token on
          // the FIRST consent. We persist it on the accounts row in the
          // signIn callback below, so subsequent sign-ins reuse it. For
          // production OAuth apps (your status), refresh_tokens don't expire
          // unless explicitly revoked, so this is safe.
        },
      },
    }),
  ],
  callbacks: {
    async signIn({ account, user }) {
      // NextAuth's pg-adapter doesn't update tokens on repeat sign-ins, so we
      // do it manually here to ensure the gmail scope is persisted.
      if (account && user.id) {
        await getMetaDb().query(
          `UPDATE accounts
           SET access_token  = $1,
               refresh_token = COALESCE($2, refresh_token),
               id_token      = COALESCE($3, id_token),
               expires_at    = $4,
               scope         = $5
           WHERE "userId" = $6 AND provider = $7`,
          [
            encrypt(account.access_token ?? null),
            encrypt(account.refresh_token ?? null),
            encrypt((account as { id_token?: string }).id_token ?? null),
            account.expires_at ?? null,
            account.scope ?? null,
            user.id,
            account.provider,
          ]
        );
      }
      return true;
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});

export const { handlers, auth, signIn, signOut } = nextAuth;
export const { GET, POST } = nextAuth.handlers;
