import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { withUser } from "@/lib/db";

const MAX_ENABLED_RECIPES = 5;

export interface Recipe {
  id: string;
  name: string;
  nl_rule: string;
  enabled: boolean;
  sort_order: number;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await withUser(session.user.id, async (c) => {
    const r = await c.query<Recipe>(
      `SELECT id, name, nl_rule, enabled, sort_order
         FROM card_recipes
        ORDER BY sort_order ASC, created_at ASC`
    );
    return r.rows;
  });
  return NextResponse.json({ recipes: rows });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  const nlRule = typeof body.nl_rule === "string" ? body.nl_rule.trim().slice(0, 600) : "";
  if (!name || !nlRule) {
    return NextResponse.json(
      { error: "name and nl_rule are required" },
      { status: 400 }
    );
  }

  try {
    const recipe = await withUser(session.user.id, async (c) => {
      const enabledCount = await c.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM card_recipes WHERE enabled = true`
      );
      if (Number(enabledCount.rows[0].n) >= MAX_ENABLED_RECIPES) {
        return null;
      }
      const r = await c.query<Recipe>(
        `INSERT INTO card_recipes (user_id, name, nl_rule, enabled, sort_order)
         VALUES ($1, $2, $3, true, 0)
         RETURNING id, name, nl_rule, enabled, sort_order`,
        [session.user!.id, name, nlRule]
      );
      return r.rows[0];
    });
    if (!recipe) {
      return NextResponse.json(
        { error: `at most ${MAX_ENABLED_RECIPES} recipes can be enabled` },
        { status: 400 }
      );
    }
    return NextResponse.json({ recipe });
  } catch (err) {
    console.error(
      "[recipes] create failed:",
      String((err as Error)?.message ?? err).slice(0, 200)
    );
    return NextResponse.json({ error: "create failed" }, { status: 500 });
  }
}
