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
    <div className="flex min-h-screen bg-zinc-100">
      <Sidebar email={session.user.email ?? ""} name={session.user.name} />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
