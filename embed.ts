// lib/embed.ts
import { pipeline } from "@xenova/transformers";

// The embedding model type returned by pipeline()
type EmbeddingModel = any;

// Cache the embedder instance
let embedder: EmbeddingModel | null = null;

// Load (or reuse) the embedding pipeline
export async function getEmbedder(): Promise<EmbeddingModel> {
    if (!embedder) {
        embedder = await pipeline(
            "feature-extraction",
            "Xenova/all-MiniLM-L6-v2"
        );
    }
    return embedder;
}

// Convert a text string to a numeric embedding vector
export async function embedText(text: string): Promise<number[]> {
    const model = await getEmbedder();

    const output = await model(text, {
        pooling: "mean",
        normalize: true,
    });

    // output.data is TypedArray → convert to regular array
    return Array.from(output.data as Float32Array);
}
