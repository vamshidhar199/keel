import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { withUser } from "@/lib/db";

const MAX_ENABLED_RECIPES = 5;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : undefined;
  const nlRule = typeof body.nl_rule === "string" ? body.nl_rule.trim().slice(0, 600) : undefined;
  const enabled = typeof body.enabled === "boolean" ? body.enabled : undefined;

  try {
    const ok = await withUser(session.user.id, async (c) => {
      if (enabled === true) {
        const cnt = await c.query<{ n: string }>(
          `SELECT COUNT(*)::text AS n FROM card_recipes
            WHERE enabled = true AND id <> $1`,
          [id]
        );
        if (Number(cnt.rows[0].n) >= MAX_ENABLED_RECIPES) {
          return "cap";
        }
      }
      await c.query(
        `UPDATE card_recipes SET
           name       = COALESCE($1, name),
           nl_rule    = COALESCE($2, nl_rule),
           enabled    = COALESCE($3, enabled),
           updated_at = now()
         WHERE id = $4`,
        [name ?? null, nlRule ?? null, enabled ?? null, id]
      );
      return "ok";
    });
    if (ok === "cap") {
      return NextResponse.json(
        { error: `at most ${MAX_ENABLED_RECIPES} recipes can be enabled` },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(
      "[recipes] patch failed:",
      String((err as Error)?.message ?? err).slice(0, 200)
    );
    return NextResponse.json({ error: "update failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  await withUser(session.user.id, async (c) => {
    await c.query(`DELETE FROM card_recipes WHERE id = $1`, [id]);
  });
  return NextResponse.json({ ok: true });
}
