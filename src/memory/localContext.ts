/**
 * LocalContextStore
 * -----------------
 * MongoDB-backed sliding-window context store.
 * Acts as a permanent, always-available fallback (and complement) to Zep Cloud.
 *
 * Responsibilities:
 *  - Persist every conversation turn in `wellness_db.context_store`
 *  - Retrieve semantically relevant past turns via keyword-overlap scoring (TF-IDF-style)
 *  - Auto-generate a rolling summary of the last 3 turns
 *  - Extract lightweight "user facts" (name, recurring themes) via heuristics
 *
 * Interface mirrors zepClient.ts so hybridMemory.ts can merge results cleanly.
 */

import { MongoClient, Collection } from "mongodb";
import { config } from "../config";
import type { ZepFact } from "../types";

// ─── MongoDB connection (shared with CAMA; reuse same client pattern) ─────────
const client = new MongoClient(config.mongodbUri, {
    serverSelectionTimeoutMS: 2500,
    connectTimeoutMS: 2500,
    socketTimeoutMS: 5000,
});
let contextCollection: Collection | null = null;

async function getCollection(): Promise<Collection> {
    if (!contextCollection) {
        await client.connect();
        contextCollection = client.db("wellness_db").collection("context_store");
        // Ensure compound index for fast user lookups
        await contextCollection.createIndex({ userId: 1, timestamp: -1 });
    }
    return contextCollection;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface StoredTurn {
    userId: string;
    userMessage: string;
    aiResponse: string;
    timestamp: number;
    keywords: string[];          // pre-extracted for fast retrieval
}

// ─── Keyword extraction (stop-word filtered) ──────────────────────────────────
const STOP_WORDS = new Set([
    "i", "me", "my", "myself", "we", "our", "you", "your", "he", "she",
    "it", "they", "what", "which", "who", "this", "that", "are", "was",
    "were", "be", "been", "being", "have", "has", "had", "do", "does",
    "did", "will", "would", "could", "should", "may", "might", "shall",
    "can", "need", "how", "all", "each", "more", "also", "but", "and",
    "or", "not", "no", "so", "if", "then", "than", "is", "am", "the",
    "a", "an", "to", "of", "in", "on", "at", "for", "with", "from",
    "by", "up", "out", "just", "very", "really", "feel", "like", "know",
    "get", "got", "im", "its", "dont", "cant", "its", "ive", "id",
]);

function extractKeywords(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

// ─── Keyword overlap score (Jaccard-like) ─────────────────────────────────────
function keywordOverlap(setA: string[], setB: string[]): number {
    if (setA.length === 0 || setB.length === 0) return 0;
    const a = new Set(setA);
    const intersection = setB.filter((w) => a.has(w)).length;
    const union = new Set([...setA, ...setB]).size;
    return intersection / union;
}

// ─── LocalContextStore ────────────────────────────────────────────────────────
export class LocalContextStore {
    private readonly WINDOW_SIZE = 20; // max turns to keep per user

    async ensureSession(_userId: string): Promise<void> {
        // No explicit session needed for MongoDB — documents are upserted on addTurn
        return;
    }

    async addTurn(
        userId: string,
        userMessage: string,
        aiResponse: string
    ): Promise<void> {
        try {
            const col = await getCollection();
            const turn: StoredTurn = {
                userId,
                userMessage,
                aiResponse,
                timestamp: Date.now(),
                keywords: extractKeywords(userMessage + " " + aiResponse),
            };

            await col.insertOne(turn);

            // Trim to window: keep only the most recent WINDOW_SIZE turns
            const count = await col.countDocuments({ userId });
            if (count > this.WINDOW_SIZE) {
                const oldest = await col
                    .find({ userId })
                    .sort({ timestamp: 1 })
                    .limit(count - this.WINDOW_SIZE)
                    .toArray();
                if (oldest.length > 0) {
                    const ids = oldest.map((d) => d._id);
                    await col.deleteMany({ _id: { $in: ids } });
                }
            }
        } catch (err) {
            console.error("[LocalContext] addTurn error:", err);
        }
    }

    async getContext(
        userId: string,
        query: string
    ): Promise<{ facts: ZepFact[]; summary: string }> {
        try {
            const col = await getCollection();
            const turns = await col
                .find({ userId })
                .sort({ timestamp: -1 })
                .limit(this.WINDOW_SIZE)
                .toArray() as unknown as StoredTurn[];

            if (turns.length === 0) return { facts: [], summary: "" };

            const queryKeywords = extractKeywords(query);

            // Score each turn by keyword overlap with current query
            const scored = turns.map((t) => ({
                turn: t,
                score: keywordOverlap(t.keywords, queryKeywords),
            }));

            // Sort: blended score of keyword relevance (0.7) + recency (0.3)
            const maxTs = turns[0].timestamp; // most recent
            const minTs = turns[turns.length - 1].timestamp;
            const tsRange = maxTs - minTs || 1;

            scored.sort((a, b) => {
                const recencyA = (a.turn.timestamp - minTs) / tsRange;
                const recencyB = (b.turn.timestamp - minTs) / tsRange;
                const scoreA = 0.7 * a.score + 0.3 * recencyA;
                const scoreB = 0.7 * b.score + 0.3 * recencyB;
                return scoreB - scoreA;
            });

            // Top 6 become ZepFacts
            const facts: ZepFact[] = scored.slice(0, 6).map((s) => ({
                fact: `User said: "${s.turn.userMessage.slice(0, 120)}"`,
                entity: userId,
                valid_at: new Date(s.turn.timestamp).toISOString(),
            }));

            // Rolling summary from last 3 turns (chronological)
            const recent = turns.slice(0, 3).reverse();
            const summary = recent
                .map((t) => `User: ${t.userMessage.slice(0, 80)} → AI: ${t.aiResponse.slice(0, 80)}`)
                .join(" | ");

            return { facts, summary };
        } catch (err) {
            console.error("[LocalContext] getContext error:", err);
            return { facts: [], summary: "" };
        }
    }

    async getUserFacts(userId: string): Promise<ZepFact[]> {
        try {
            const col = await getCollection();
            const turns = await col
                .find({ userId })
                .sort({ timestamp: -1 })
                .limit(this.WINDOW_SIZE)
                .toArray() as unknown as StoredTurn[];

            const facts: ZepFact[] = [];

            // Heuristic: extract name mentions
            const namePat = /(?:call me|i'm|i am|my name is)\s+([A-Za-z]+)/i;
            for (const t of turns) {
                const m = t.userMessage.match(namePat);
                if (m) {
                    facts.push({
                        fact: `User's name is ${m[1]}`,
                        entity: "identity",
                        valid_at: new Date(t.timestamp).toISOString(),
                    });
                    break; // one name fact is enough
                }
            }

            // Heuristic: recurring high-frequency keywords (top 3)
            const freq: Record<string, number> = {};
            for (const t of turns) {
                for (const kw of t.keywords) {
                    freq[kw] = (freq[kw] ?? 0) + 1;
                }
            }
            const top = Object.entries(freq)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3);

            for (const [kw, count] of top) {
                if (count >= 2) {
                    facts.push({
                        fact: `Recurring theme: "${kw}" (mentioned ${count} times)`,
                        entity: "pattern",
                        valid_at: new Date().toISOString(),
                    });
                }
            }

            return facts;
        } catch (err) {
            console.error("[LocalContext] getUserFacts error:", err);
            return [];
        }
    }
}

// Singleton
export const localContextStore = new LocalContextStore();
