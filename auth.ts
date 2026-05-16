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
          access_type: "offline",
          prompt: "consent",
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
