"use client";
import { useState } from "react";
import { FormAction } from "../_components/form-action";
import { SpaceField } from "../_components/space-field";
import { createAccountAction } from "../actions";
import type { Space } from "@/lib/space-shared";

export function SavingsForm({ space }: { space: Space }) {
  const [name, setName] = useState("Livret A");
  return (
    <FormAction
      action={createAccountAction}
      submitLabel="Ajouter ce compte"
      reset={false}
      className="grid gap-4 sm:grid-cols-2"
    >
      <input type="hidden" name="kind" value="savings" />
      <div>
        <label className="label" htmlFor="savings-product">
          Type de livret
        </label>
        <select
          className="input"
          id="savings-product"
          onChange={(e) => setName(e.target.value)}
          defaultValue="Livret A"
        >
          {["Livret A", "LEP", "LDDS", "PEL", "CEL", "Autre livret"].map(
            (n) => (
              <option key={n}>{n}</option>
            ),
          )}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="savings-name">
          Nom du compte
        </label>
        <input
          className="input"
          id="savings-name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={60}
        />
      </div>
      <div>
        <label className="label" htmlFor="savings-balance">
          Solde initial
        </label>
        <input
          className="input"
          id="savings-balance"
          name="openingBalance"
          inputMode="decimal"
          defaultValue="0"
          required
        />
      </div>
      <SpaceField id="savings-space" defaultValue={space} />
    </FormAction>
  );
}
