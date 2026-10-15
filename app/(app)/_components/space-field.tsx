import type { Space } from "@/lib/space-shared";

// Champ « Espace » des formulaires de création (ticket #1), pré-rempli avec l'espace actif.
export function SpaceField({ defaultValue, id = "space" }: { defaultValue: Space; id?: string }) {
  return (
    <div>
      <label className="label" htmlFor={id}>Espace</label>
      <select className="input" id={id} name="space" defaultValue={defaultValue}>
        <option value="perso">Perso</option>
        <option value="pro">Pro</option>
      </select>
    </div>
  );
}
