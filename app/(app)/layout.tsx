import { requireUser } from "@/lib/auth";
import { getAiUsage, getProfile, initials } from "@/lib/data/account";
import { getSpaceFilter, SPACE_LABEL } from "@/lib/space";
import { Nav } from "./nav";
import { TimezoneSync } from "./timezone-sync";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { supabase, userId } = await requireUser();
  const [profile, usage, space] = await Promise.all([getProfile(supabase, userId), getAiUsage(supabase), getSpaceFilter()]);
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ");

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <TimezoneSync current={profile.timezone} manual={profile.timezoneManual} />
      <Nav
        account={{
          name: name || profile.email.split("@")[0],
          email: profile.email,
          initials: initials(profile),
          color: profile.avatarColor,
        }}
        usage={usage}
        space={space}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 md:px-10 md:py-12">
        {space !== "all" && (
          <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-xs text-ink" role="status">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            Espace {SPACE_LABEL[space]} : seules les données {space === "pro" ? "professionnelles" : "personnelles"} sont affichées.
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
