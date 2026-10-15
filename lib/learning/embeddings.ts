import "server-only";

// Embeddings locaux et gratuits (all-MiniLM-L6-v2, 384 dimensions) : aucun quota, aucune clé.
// Le modèle (~25 Mo) est téléchargé au premier appel puis gardé en mémoire.
// En cas d'échec (environnement sans accès au modèle), la mémoire retombe sur les souvenirs récents.

type Extractor = (text: string, options: { pooling: "mean"; normalize: boolean }) => Promise<{ data: Float32Array }>;

let extractorPromise: Promise<Extractor> | null = null;

async function getExtractor(): Promise<Extractor> {
  extractorPromise ??= import("@huggingface/transformers").then(
    async ({ pipeline, env }) => {
      // Sur Vercel, seul /tmp est inscriptible : le modèle y est mis en cache entre deux appels à chaud.
      if (process.env.VERCEL) env.cacheDir = "/tmp/hf-cache";
      return (await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" })) as unknown as Extractor;
    },
  );
  try {
    return await extractorPromise;
  } catch (error) {
    extractorPromise = null;
    throw error;
  }
}

export async function embed(text: string): Promise<number[] | null> {
  try {
    const extractor = await getExtractor();
    const output = await extractor(text.slice(0, 2000), { pooling: "mean", normalize: true });
    return Array.from(output.data);
  } catch (error) {
    console.warn("[kaobase] embeddings indisponibles :", error instanceof Error ? error.message : error);
    return null;
  }
}

// Format attendu par pgvector via PostgREST.
export function toVector(embedding: number[] | null): string | null {
  return embedding ? `[${embedding.join(",")}]` : null;
}
