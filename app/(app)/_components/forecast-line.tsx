import { moneyIn, shortDate } from "@/lib/ui/format";

// Prévision gravée : une ligne, des hachures dessous comme une taille-douce, le point bas signalé.
// SVG statique rendu côté serveur (remplace Recharts, ~350 Ko de JavaScript en moins).

export function ForecastLine({ points, currency }: { points: { date: string; balance: number }[]; currency: string }) {
  const money = moneyIn(currency);
  const W = 640;
  const H = 170;
  const PAD = { top: 18, bottom: 6, left: 4, right: 4 };
  const values = points.map((p) => p.balance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => PAD.left + (i / Math.max(1, points.length - 1)) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - min) / span) * (H - PAD.top - PAD.bottom);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.balance).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1).toFixed(1)} ${H - PAD.bottom}L${x(0).toFixed(1)} ${H - PAD.bottom}Z`;
  const lowIndex = values.indexOf(min);
  const last = points[points.length - 1];

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Solde projeté : de ${money(points[0].balance)} à ${money(last.balance)}, point bas ${money(min)} le ${shortDate(points[lowIndex].date)}`}>
        <defs>
          <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--engrave)" strokeWidth="0.7" opacity="0.35" />
          </pattern>
        </defs>
        <path d={area} fill="url(#hatch)" />
        <path d={line} fill="none" stroke="var(--ink)" strokeWidth={1.6} strokeLinejoin="round" />
        <line x1={0} x2={W} y1={H - PAD.bottom} y2={H - PAD.bottom} stroke="var(--rule)" />
        <circle cx={x(lowIndex)} cy={y(min)} r={4} fill="var(--paper)" stroke="var(--loss)" strokeWidth={1.6} />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-ink-3" aria-hidden>
        <span>{shortDate(points[0].date)}</span>
        <span>{shortDate(last.date)}</span>
      </div>
      <figcaption className="mt-3 text-sm text-ink-2">
        Point le plus bas : <span className="num font-medium text-ink">{money(min)}</span>, le {shortDate(points[lowIndex].date)}
      </figcaption>
    </figure>
  );
}
