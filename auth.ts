import NextAuth, { DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import PostgresAdapter from "@auth/pg-adapter";
import { getMetaDb } from "@/lib/db";
import { provisionGbrainDb } from "@/lib/gbrain";

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
      // do it manually here. This ensures the gmail scope is persisted after
      // the user re-authenticates to grant new permissions.
      if (account && user.id) {
        await getMetaDb().query(
          `UPDATE accounts
           SET access_token  = $1,
               refresh_token = COALESCE($2, refresh_token),
               expires_at    = $3,
               scope         = $4
           WHERE "userId" = $5 AND provider = $6`,
          [
            account.access_token,
            account.refresh_token ?? null,
            account.expires_at ?? null,
            account.scope ?? null,
            user.id,
            account.provider,
          ]
        );
      }

      // Retry gbrain provisioning if it failed during createUser (e.g. missing binary).
      // Check the pages table, not just DB existence — DB can exist without schema.
      if (user.id) {
        const { Pool: PgPool } = await import("pg");
        const base = process.env.DATABASE_URL!;
        const url = new URL(base);
        url.pathname = `/gbrain_user_${user.id}`;
        const pool = new PgPool({ connectionString: url.toString() });
        let needsProvision = false;
        try {
          const { rows } = await pool.query(
            `SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'pages'`
          );
          needsProvision = rows.length === 0;
        } catch {
          needsProvision = true; // DB doesn't exist yet
        } finally {
          await pool.end();
        }
        if (needsProvision) {
          try {
            await provisionGbrainDb(user.id);
          } catch (err) {
            console.error(`[auth] gbrain provisioning retry failed for user ${user.id}:`, err);
          }
        }
      }

      return true;
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id) return;
      try {
        await provisionGbrainDb(user.id);
      } catch (err) {
        console.error(`[auth] gbrain provisioning failed for user ${user.id}:`, err);
      }
    },
  },
});

export const { handlers, auth, signIn, signOut } = nextAuth;
export const { GET, POST } = nextAuth.handlers;
