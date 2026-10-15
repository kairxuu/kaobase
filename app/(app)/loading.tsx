// Affiché instantanément pendant le chargement d'une page : la navigation répond tout de suite.
export default function Loading() {
  return (
    <div className="animate-pulse space-y-8" aria-busy="true" aria-label="Chargement">
      <div className="h-11 w-64 rounded-md bg-surface-2" />
      <div className="h-4 w-96 max-w-full rounded bg-surface-2" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-64 rounded-md bg-surface-2" />
        <div className="h-64 rounded-md bg-surface-2" />
      </div>
    </div>
  );
}
