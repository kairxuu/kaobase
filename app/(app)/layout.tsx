import { requireUser } from "@/lib/auth";
import { getAiUsage, getProfile, initials } from "@/lib/data/account";
import { Nav } from "./nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { supabase, userId } = await requireUser();
  const [profile, usage] = await Promise.all([getProfile(supabase, userId), getAiUsage(supabase)]);
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ");

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Nav
        account={{
          name: name || profile.email.split("@")[0],
          email: profile.email,
          initials: initials(profile),
          color: profile.avatarColor,
        }}
        usage={usage}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-10 md:py-12">{children}</main>
    </div>
  );
}
