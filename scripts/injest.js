// scripts/ingest.js
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Pinecone } from "@pinecone-database/pinecone";
import { pipeline } from "@xenova/transformers";

dotenv.config();

// ----------------------------
// 1. Load JSON dataset
// ----------------------------
const dataPath = path.join(process.cwd(), "data", "meghalaya.json");
const dataset = JSON.parse(fs.readFileSync(dataPath, "utf8"));

// ----------------------------
// 2. Initialize Pinecone client
// ----------------------------
const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
});

const index = pc.index(process.env.PINECONE_INDEX);
const namespace = process.env.PINECONE_NAMESPACE;

// ----------------------------
// 3. Load embedding model (open-source)
// Model: all-MiniLM-L6-v2
// ----------------------------
console.log("Loading embedding model...");
const embedder = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
);

async function embedText(text) {
    const output = await embedder(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
}

// ----------------------------
// 4. Prepare vectors for Pinecone
// ----------------------------
async function prepareVectors() {
    console.log(`Preparing ${dataset.length} items...`);

    const vectors = [];

    for (const item of dataset) {
        const text = `
      Name: ${item.name}.
      Type: ${item.type}.
      Location: ${item.location}, ${item.state}.
      Description: ${item.description}.
      Best time: ${item.best_time}.
      Tips: ${item.local_tips || ""}
    `;

        const embedding = await embedText(text);

        vectors.push({
            id: item.id,
            values: embedding,
            metadata: item,
        });

        console.log(`Embedded → ${item.name}`);
    }

    return vectors;
}

// ----------------------------
// 5. Upload to Pinecone
// ----------------------------
async function upload(vectors) {
    console.log(`Uploading ${vectors.length} vectors to Pinecone...`);

    // batching to avoid payload limits
    const batchSize = 50;

    for (let i = 0; i < vectors.length; i += batchSize) {
        const chunk = vectors.slice(i, i + batchSize);
        await index.namespace(namespace).upsert(chunk);

        console.log(`Uploaded batch ${i / batchSize + 1}`);
    }

    console.log("🎉 Upload complete!");
}

// ----------------------------
// Run
// ----------------------------
(async () => {
    const vectors = await prepareVectors();
    await upload(vectors);
})();
