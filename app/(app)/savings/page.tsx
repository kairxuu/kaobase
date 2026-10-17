import type { Metadata } from "next";
import Link from "next/link";
import { getCurrency, requireUser } from "@/lib/auth";
import { getAccounts } from "@/lib/data/finance";
import { getSpaceFilter, defaultSpace } from "@/lib/space";
import { moneyIn } from "@/lib/ui/format";
import { SavingsForm } from "./savings-form";
export const metadata: Metadata = { title: "Épargne" };
export default async function SavingsPage() {
  const { db } = await requireUser();
  const space = await getSpaceFilter();
  const accounts = (await getAccounts(db, space)).filter(
    (a) => a.kind === "savings",
  );
  const money = moneyIn(await getCurrency());
  const total = accounts.reduce((sum, a) => sum + Number(a.balance), 0);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="page-title">Épargne</h1>
        <p className="page-lede">
          Livret A, LEP et autres livrets. Les soldes suivent tes imports et les
          opérations enregistrées.
        </p>
      </header>
      <section className="card">
        <p className="text-sm text-ink-2">Total épargné</p>
        <p className="num mt-2 text-3xl font-semibold">{money(total)}</p>
        <p className="mt-2 text-xs text-ink-2">
          {accounts.length} compte{accounts.length > 1 ? "s" : ""} · inclus dans
          le solde total de l’accueil
        </p>
      </section>
      {accounts.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {accounts.map((a) => (
            <li className="card" key={a.id}>
              <div className="flex flex-wrap justify-between gap-3">
                <h2 className="font-medium">{a.name}</h2>
                <span className="num">{money(Number(a.balance))}</span>
              </div>
              <div className="mt-4 flex gap-4 text-xs">
                <Link href="/import" className="text-accent">
                  Importer des opérations ↗
                </Link>
                <Link href="/settings#accounts" className="text-accent">
                  Gérer le compte ↗
                </Link>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-2">
          Ajoute ton premier livret ci-dessous.
        </p>
      )}
      <section className="card">
        <h2 className="section-title">Ajouter un compte d’épargne</h2>
        <SavingsForm space={defaultSpace(space)} />
      </section>
    </div>
  );
}
