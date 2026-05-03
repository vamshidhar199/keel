import { auth, signOut } from "@/auth";
import { PageHeader } from "../../components/page-header";

export default async function SettingsPage() {
  const session = await auth();
  const user = session!.user!;

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
        {/* Account */}
        <section>
          <p className="text-xs text-zinc-400 uppercase tracking-wide mb-3">Account</p>
          <div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">
            <div className="px-5 py-4">
              <p className="text-xs text-zinc-400 mb-0.5">Name</p>
              <p className="text-sm text-zinc-800">{user.name ?? "—"}</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-zinc-400 mb-0.5">Email</p>
              <p className="text-sm text-zinc-800">{user.email ?? "—"}</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-xs text-zinc-400 mb-0.5">User ID</p>
              <p className="text-xs text-zinc-500 font-mono">{user.id}</p>
            </div>
          </div>
        </section>

        {/* Sign out */}
        <section>
          <p className="text-xs text-zinc-400 uppercase tracking-wide mb-3">Session</p>
          <div className="bg-white border border-zinc-200 rounded-lg p-5">
            <p className="text-sm text-zinc-600 mb-4">
              Sign out of your account on this device.
            </p>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="px-4 py-2 text-sm text-zinc-700 border border-zinc-200 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                Sign out
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
