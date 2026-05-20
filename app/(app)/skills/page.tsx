import Link from "next/link";
import { auth } from "@/auth";
import { listSkills } from "@/lib/skills";
import { SkillsClient } from "./skills-client";

export default async function SkillsPage() {
  const session = await auth();
  const userId = session!.user!.id;
  const skills = await listSkills(userId);

  return (
    <div className="min-h-screen">
      <header className="header-glass sticky top-0 h-16 flex items-center justify-between px-6 z-30">
        <div className="flex items-center gap-3">
          <Link
            href="/overview"
            className="material-symbols-outlined text-xl leading-none"
            style={{ color: "var(--c-muted)" }}
            aria-label="Back to home"
          >
            arrow_back
          </Link>
          <h1 className="text-2xl font-bold" style={{ color: "var(--c-fg)" }}>
            Skills
          </h1>
        </div>
      </header>

      <div className="px-8 py-10 max-w-4xl mx-auto space-y-8">
        <section className="space-y-2">
          <p
            className="text-[11px] font-mono uppercase tracking-[0.18em]"
            style={{ color: "var(--c-subtle)" }}
          >
            Behaviors you can call by name
          </p>
          <h2
            className="text-3xl md:text-4xl font-bold tracking-tight"
            style={{ color: "var(--c-fg)" }}
          >
            Teach me how to behave.
          </h2>
          <p className="text-base max-w-2xl" style={{ color: "var(--c-muted)" }}>
            A Skill is a saved instruction set you can pick before asking a
            question. Tell me &ldquo;always show dollar amounts&rdquo; or
            &ldquo;reply in three bullets&rdquo; once, then invoke it from the chat
            whenever you need it.
          </p>
        </section>

        <SkillsClient initialSkills={skills} />
      </div>
    </div>
  );
}
