import { ZepClient } from "@getzep/zep-cloud";
import { config } from "../config";
import type { ZepFact } from "../types";

const zep = new ZepClient({ apiKey: config.zepApiKey });

export async function ensureSession(userId: string): Promise<void> {
    try {
        await zep.memory.getSession(userId);
    } catch {
        // Session doesn't exist — create it
        await zep.memory.addSession({
            sessionId: userId,
            userId: userId,
            metadata: { created_at: new Date().toISOString() },
        });
    }
}

export async function addTurn(
    userId: string,
    userMessage: string,
    aiResponse: string
): Promise<void> {
    try {
        await zep.memory.add(userId, {
            messages: [
                { role: "user", roleType: "user", content: userMessage },
                { role: "assistant", roleType: "assistant", content: aiResponse },
            ],
        });
    } catch (err) {
        console.error("[Zep] addTurn error:", err);
    }
}

export async function getContext(
    userId: string,
    query: string
): Promise<{ facts: ZepFact[]; summary: string }> {
    try {
        const results = await zep.memory.searchSessions({
            userId,
            text: query,
            limit: 8,
        });

        const facts: ZepFact[] = (results.results ?? []).map((r: any) => ({
            fact: r.fact ?? r.summary ?? "",
            entity: r.name,
            valid_at: r.valid_at,
            invalid_at: r.invalid_at,
        }));

        // Also get the memory summary for this session
        let summary = "";
        try {
            const mem = await zep.memory.get(userId);
            summary = mem.summary?.content ?? "";
        } catch {
            // No summary yet — that's fine
        }

        return { facts, summary };
    } catch (err) {
        console.error("[Zep] getContext error:", err);
        return { facts: [], summary: "" };
    }
}

export async function getUserFacts(userId: string): Promise<ZepFact[]> {
    try {
        const facts = await zep.user.getFacts(userId);
        return (facts.facts ?? []).map((f: any) => ({
            fact: f.fact,
            entity: f.name,
            valid_at: f.valid_at,
            invalid_at: f.invalid_at,
        }));
    } catch {
        return [];
    }
}
