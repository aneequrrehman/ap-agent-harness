// Atlas Embedding API (Voyage models served at ai.mongodb.com).
// Used to give the harness semantic memory over past decisions via Atlas Vector Search.

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "voyage-4-lite";
export const EMBEDDING_DIMS = 1024;
export const EPISODE_VECTOR_INDEX = "episode_vectors";

const BASE = process.env.MONGODB_MODEL_API_BASE ?? "https://ai.mongodb.com/v1";

export function embeddingsEnabled() {
  return Boolean(process.env.MONGODB_MODEL_API_KEY);
}

export async function embed(texts: string[], inputType: "query" | "document"): Promise<number[][]> {
  const key = process.env.MONGODB_MODEL_API_KEY;
  if (!key) throw new Error("MONGODB_MODEL_API_KEY is not set");
  const res = await fetch(`${BASE}/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ input: texts, model: EMBEDDING_MODEL, input_type: inputType, output_dimension: EMBEDDING_DIMS }),
  });
  if (!res.ok) throw new Error(`Embedding API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
  return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function embedOne(text: string, inputType: "query" | "document"): Promise<number[] | null> {
  if (!embeddingsEnabled()) return null;
  try {
    const [v] = await embed([text], inputType);
    return v;
  } catch (err) {
    console.warn("embedding failed:", (err as Error).message);
    return null;
  }
}
