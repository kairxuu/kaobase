import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <p className="font-mono text-2xl font-semibold tracking-tight">KAOBASE</p>
          <p className="mt-1 text-sm text-ink-2">Finances, abonnements et tâches, pilotés par des agents qui apprennent de toi.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
