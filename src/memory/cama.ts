import { MongoClient, Collection } from "mongodb";
import { config } from "../config";
import type { MemoryNode, CAMAConsole } from "../types";

const client = new MongoClient(config.mongodbUri);
let camaCollection: Collection | null = null;

async function getCollection(): Promise<Collection> {
    if (!camaCollection) {
        await client.connect();
        camaCollection = client.db("wellness_db").collection("cama_memory");
    }
    return camaCollection;
}

// Simple cosine similarity for associative recall
function cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return magA && magB ? dot / (magA * magB) : 0;
}

// Lightweight keyword-based salience scoring (no local model needed)
function emotionOverlap(tags1: string[], tags2: string[]): number {
    const set1 = new Set(tags1.map((t) => t.toLowerCase()));
    const intersection = tags2.filter((t) => set1.has(t.toLowerCase()));
    return intersection.length / Math.max(tags1.length, tags2.length, 1);
}

export class CAMAMemory {
    private ring: MemoryNode[] = [];
    private readonly maxRingSize = 50;
    private console: CAMAConsole = {
        core_beliefs: [],
        recurring_patterns: [],
        identity_facts: [],
    };
    private readonly userId: string;

    constructor(userId: string) {
        this.userId = userId;
    }

    async load(): Promise<void> {
        try {
            const col = await getCollection();
            const doc = await col.findOne({ userId: this.userId });
            if (doc) {
                this.ring = (doc.ring as MemoryNode[]) ?? [];
                this.console = (doc.console as CAMAConsole) ?? this.console;
            }
        } catch (err) {
            console.error("[CAMA] Load error:", err);
        }
    }

    async ingest(
        content: string,
        emotionTags: string[],
        salience: number
    ): Promise<void> {
        const node: MemoryNode = {
            content,
            emotion_tags: emotionTags,
            timestamp: Date.now(),
            salience,
        };

        // Only store high-salience moments in the ring
        if (salience > 0.6) {
            this.ring.push(node);
            if (this.ring.length > this.maxRingSize) {
                // Evict lowest-salience item
                const minIdx = this.ring.reduce(
                    (minI, n, i, arr) => (n.salience < arr[minI].salience ? i : minI),
                    0
                );
                this.ring.splice(minIdx, 1);
            }
        }

        // Extract identity facts from episodic extract
        this.updateConsole(content);
        await this.persist();
    }

    recall(queryEmotionTags: string[], topK = 5): MemoryNode[] {
        if (this.ring.length === 0) return [];

        const scored = this.ring.map((node) => {
            const emotionScore = emotionOverlap(node.emotion_tags, queryEmotionTags);
            // Recency boost: decay over 7 days
            const ageMs = Date.now() - node.timestamp;
            const recencyScore = Math.exp(-ageMs / (7 * 24 * 3600 * 1000));
            const finalScore = 0.5 * emotionScore + 0.3 * node.salience + 0.2 * recencyScore;
            return { node, score: finalScore };
        });

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)
            .map((s) => s.node);
    }

    getConsole(): CAMAConsole {
        return this.console;
    }

    formatForPrompt(nodes: MemoryNode[]): string {
        if (nodes.length === 0) return "No prior emotional context.";
        return nodes
            .map((n) => {
                const when = new Date(n.timestamp).toLocaleDateString();
                return `[${when}] ${n.content} (emotion: ${n.emotion_tags.join(", ")})`;
            })
            .join("\n");
    }

    private updateConsole(content: string): void {
        // Extract recurring patterns (simple keyword heuristics)
        const patternKeywords = ["always", "never", "every time", "keeps happening", "can't stop"];
        for (const kw of patternKeywords) {
            if (content.toLowerCase().includes(kw) && !this.console.recurring_patterns.includes(content)) {
                this.console.recurring_patterns.push(content.slice(0, 100));
            }
        }

        // Cap to last 10 patterns
        if (this.console.recurring_patterns.length > 10) {
            this.console.recurring_patterns = this.console.recurring_patterns.slice(-10);
        }
    }

    private async persist(): Promise<void> {
        try {
            const col = await getCollection();
            await col.updateOne(
                { userId: this.userId },
                { $set: { ring: this.ring, console: this.console, updatedAt: new Date() } },
                { upsert: true }
            );
        } catch (err) {
            console.error("[CAMA] Persist error:", err);
        }
    }
}
