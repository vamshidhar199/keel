import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { Sidebar } from "../components/sidebar";

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
      <main className="ml-64">{children}</main>
    </div>
  );
}
