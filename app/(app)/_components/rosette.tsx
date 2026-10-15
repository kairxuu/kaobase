// Rosace guillochée, comme sur les billets : des courbes sinusoïdales décalées autour d'un cercle.
// Calculée côté serveur, rendue en SVG pur (aucun JavaScript envoyé au navigateur).

type Band = { radius: number; amplitude: number; lobes: number; curves: number };

// Chaque courbe est une onde autour d'un cercle ; décaler la phase d'une courbe à l'autre
// produit le ruban croisé typique du guilloché. Échantillonnage proportionnel aux lobes : traits lisses.
function bandPaths({ radius, amplitude, lobes, curves }: Band, cx: number, cy: number): string[] {
  const samples = Math.max(120, lobes * 14);
  const paths: string[] = [];
  for (let k = 0; k < curves; k++) {
    const phase = (k / curves) * Math.PI;
    let d = "";
    for (let s = 0; s <= samples; s++) {
      const t = (s / samples) * 2 * Math.PI;
      const r = radius + amplitude * Math.sin(lobes * t + phase) * Math.cos(t * 2 - phase / 2) ** 2 + amplitude * 0.35 * Math.sin(lobes * t - phase);
      d += `${s ? "L" : "M"}${(cx + r * Math.cos(t)).toFixed(1)} ${(cy + r * Math.sin(t)).toFixed(1)}`;
    }
    paths.push(d + "Z");
  }
  return paths;
}

export function Rosette({
  size = 400,
  bands,
  animate = false,
  className,
  opacity = 0.5,
}: {
  size?: number;
  bands: Band[];
  animate?: boolean;
  className?: string;
  opacity?: number;
}) {
  const c = size / 2;
  const paths = bands.flatMap((b) => bandPaths(b, c, c));
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={`${animate ? "engrave" : ""} ${className ?? ""}`} aria-hidden="true">
      <g fill="none" stroke="var(--engrave)" strokeWidth={0.5} opacity={opacity}>
        {paths.map((d, i) => (
          <path key={i} d={d} pathLength={1} style={{ "--i": i } as React.CSSProperties} />
        ))}
      </g>
    </svg>
  );
}
