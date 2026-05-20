import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "../components/sidebar";
import { KeysSetupBanner } from "../components/keys-setup-banner";

export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/");

  return (
    <div className="min-h-screen" style={{ background: "var(--c-bg)", color: "var(--c-fg)" }}>
      <div className="mesh-gradient-bg" />
      <Sidebar email={session.user.email ?? ""} name={session.user.name} />
      {/* Nags users who haven't configured their own API keys. Renders nothing
          when both providers are set up. Lives outside <main> so it doesn't
          shift the page header into view. */}
      <KeysSetupBanner userId={session.user.id} />
      <main className="ml-16">{children}</main>
    </div>
  );
}
