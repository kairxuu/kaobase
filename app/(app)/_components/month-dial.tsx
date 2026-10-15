import { money } from "@/lib/ui/format";
import { Rosette } from "./rosette";

// Cadran du mois : chaque jour est une graduation, chaque prélèvement une marque,
// l'aiguille montre où l'on en est. C'est l'élément signature du tableau de bord.

export type DialMark = { day: number; label: string; amount: number; paid: boolean };

const C = 200;
const RING = 150;

function polar(angleDeg: number, r: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
}

export function MonthDial({
  today,
  daysInMonth,
  marks,
  remaining,
  total,
}: {
  today: number;
  daysInMonth: number;
  marks: DialMark[];
  remaining: number;
  total: number;
}) {
  const angleOf = (day: number) => ((day - 1) / daysInMonth) * 360;
  const needle = angleOf(today) + 360 / daysInMonth / 2;

  return (
    <figure className="relative mx-auto aspect-square w-full max-w-[26rem]">
      <Rosette
        className="absolute inset-0 h-full w-full"
        opacity={0.22}
        bands={[{ radius: 122, amplitude: 8, lobes: 16, curves: 10 }]}
      />
      <svg viewBox="0 0 400 400" className="relative h-full w-full" role="img" aria-label={`Jour ${today} sur ${daysInMonth}, ${marks.length} prélèvements ce mois`}>
        <circle cx={C} cy={C} r={RING} fill="none" stroke="var(--rule)" strokeWidth={1} />
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const major = day === 1 || day % 5 === 0;
          const a = polar(angleOf(day), RING - (major ? 10 : 5));
          const b = polar(angleOf(day), RING);
          return (
            <line
              key={day}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={day < today ? "var(--ink-3)" : "var(--ink)"}
              strokeWidth={major ? 1.4 : 0.8}
              opacity={day < today ? 0.5 : 0.9}
            />
          );
        })}
        {[1, 10, 20].map((day) => {
          const p = polar(angleOf(day), RING - 24);
          return (
            <text key={day} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="var(--ink-3)">
              {day}
            </text>
          );
        })}
        {marks.map((m, i) => {
          // Perles posées sur l'anneau, au jour du prélèvement.
          const p = polar(angleOf(m.day) + 360 / daysInMonth / 2, RING);
          return (
            <circle
              key={i}
              className="dial-mark"
              style={{ "--t": m.day / daysInMonth } as React.CSSProperties}
              cx={p.x}
              cy={p.y}
              r={Math.min(8.5, 3.5 + Math.sqrt(m.amount) / 4)}
              fill={m.paid ? "var(--paper)" : "var(--signal)"}
              stroke="var(--signal)"
              strokeWidth={1.5}
            >
              <title>{`${m.label} : ${money(m.amount)}, le ${m.day}${m.paid ? " (déjà prélevé)" : ""}`}</title>
            </circle>
          );
        })}
        {/* Aiguille limitée à la couronne : elle ne traverse jamais le montant central. */}
        <g className="needle" style={{ "--angle": `${needle}deg` } as React.CSSProperties}>
          <line x1={C} y1={C - 104} x2={C} y2={C - RING - 10} stroke="var(--signal)" strokeWidth={2} strokeLinecap="round" />
          <circle cx={C} cy={C - 104} r={3} fill="var(--signal)" />
        </g>
      </svg>
      <figcaption className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="figure text-[2.6rem] leading-none md:text-5xl">{money(remaining)}</span>
        <span className="mt-2 max-w-[11rem] text-xs leading-snug text-ink-2">
          encore à prélever ce mois, sur {money(total)} d&apos;abonnements
        </span>
      </figcaption>
    </figure>
  );
}
