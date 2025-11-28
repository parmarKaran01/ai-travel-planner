// app/api/plan/route.ts
import { NextResponse } from "next/server";
import type { Request } from "next/server";
import { Pinecone } from "@pinecone-database/pinecone";
import { embedText } from "@/lib/embed"; // your lib/embed.ts
import OpenAI from "openai";

type PlanRequestBody = {
    q: string;
    days?: number;
    budget?: string;
    topK?: number;
};

function safeString(s: any): string {
    if (s === undefined || s === null) return "";
    return String(s);
}

function buildContext(matches: any[]) {
    // Build concise context for the LLM with the most relevant fields
    return matches
        .map((m, idx) => {
            const meta = m.metadata || {};
            const lines = [
                `### [${idx + 1}] ${safeString(meta.name || meta.id || m.id)}`,
                `Type: ${safeString(meta.type || "")}`,
                `Location: ${safeString(
                    (meta.location && (meta.location.region || meta.location.city)) ||
                    meta.state ||
                    ""
                )}`,
                `Description: ${safeString(meta.description || "")}`,
                meta.best_time ? `Best time: ${safeString(meta.best_time)}` : "",
                meta.duration_hours ? `Typical duration (hrs): ${safeString(meta.duration_hours)}` : "",
                meta.entry_fee ? `Entry fee: ${safeString(meta.entry_fee)}` : "",
                meta.local_tips ? `Local tips: ${safeString(meta.local_tips)}` : "",
            ].filter(Boolean);
            return lines.join("\n");
        })
        .join("\n\n");
}

export async function POST(req: Request) {
    try {
        const body: PlanRequestBody = await req.json();

        if (!body || !body.q || body.q.trim() === "") {
            return NextResponse.json(
                { error: "Missing required field: q (query)" },
                { status: 400 }
            );
        }

        const query = body.q.trim();
        const days = body.days ?? 3;
        const budget = body.budget ?? "mid-range";
        const topK = body.topK ?? Number(process.env.TOP_K ?? 6);

        // 1) Embed the query
        const queryVector = await embedText(query);

        // 2) Pinecone client
        const pinecone = new Pinecone({
            apiKey: process.env.PINECONE_API_KEY ?? "",
        });

        const indexName = process.env.PINECONE_INDEX ?? "";
        const namespace = process.env.PINECONE_NAMESPACE ?? "";

        const index = pinecone.index(indexName);

        // 3) Query Pinecone
        const pineRes = await index
            .namespace(namespace)
            .query({
                vector: queryVector,
                topK,
                includeMetadata: true,
            });

        const matches = pineRes.matches ?? [];

        if (!matches.length) {
            return NextResponse.json(
                {
                    query,
                    results: [],
                    itinerary: `No relevant places found in the knowledge base for: "${query}".`,
                },
                { status: 200 }
            );
        }

        // 4) Build context for LLM
        const context = buildContext(matches);

        // 5) Build a clear, strongly-constrained prompt for RAG
        const prompt = `
You are a professional travel planner specialized in Meghalaya, India. Use ONLY the facts provided in the "Relevant Data" section below. Do NOT hallucinate facts or invent opening hours, fees, or distances. If something is missing, explicitly say "information not available".

User Query:
${query}

Constraints:
- Create a ${days}-day itinerary suitable for a ${budget} budget.
- Include day-by-day schedule with suggested timings (morning/afternoon/evening).
- For each day, list 3-5 activities/attractions (where possible) and mention approximate duration.
- If travel between places is required, mention approximate suggestion like "short drive" or "local transport" — only if supported by context or generic guidance.
- Add local tips drawn from the provided data.
- At the end, include a short "Sources used" list showing the names of the retrieved entries you used.

Relevant Data:
${context}

Now produce the itinerary in Markdown. Keep answers concise but actionable.
`;

        // 6) Call OpenAI
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });

        const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

        const completion = await openai.chat.completions.create({
            model,
            messages: [
                { role: "system", content: "You are an expert travel planner for Meghalaya, India." },
                { role: "user", content: prompt },
            ],
            max_tokens: 1000,
            temperature: 0.2,
        });

        const itinerary =
            completion.choices?.[0]?.message?.content ??
            "No itinerary produced by model.";

        console.log(">>>>>>itinerary", itinerary);

        // 7) Return structured response
        return NextResponse.json({
            query,
            days,
            budget,
            usedDocuments: matches.map((m) => ({
                id: m.id,
                score: m.score,
                name: m.metadata?.name ?? null,
                type: m.metadata?.type ?? null,
            })),
            itinerary,
        });
    } catch (err: any) {
        console.error("RAG Planner Error:", err);
        return NextResponse.json(
            { error: err?.message ?? "Unknown error" },
            { status: 500 }
        );
    }
}
