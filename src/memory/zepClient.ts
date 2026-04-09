import { ZepClient } from "@getzep/zep-cloud";
import { config } from "../config";
import type { ZepFact } from "../types";

/**
 * Zep Cloud Client (Primary Memory Layer)
 * ----------------------------------------
 * Connects to Zep's hosted knowledge-graph memory service.
 * Includes a 5-minute circuit-breaker: if Zep fails, requests are skipped
 * silently until the cooldown lapses — the hybrid layer's LocalContextStore
 * ensures context is never lost during outages.
 */

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
const CIRCUIT_RESET_MS = 5 * 60 * 1000; // 5 minutes
let zepDown = false;
let zepDownSince = 0;
let warnedOnce = false;

function isCircuitOpen(): boolean {
    if (!zepDown) return false;
    if (Date.now() - zepDownSince > CIRCUIT_RESET_MS) {
        zepDown = false;
        warnedOnce = false;
        console.log("[Zep] Circuit reset — retrying Zep Cloud.");
        return false;
    }
    return true;
}

function tripCircuit(err: unknown): void {
    zepDown = true;
    zepDownSince = Date.now();
    if (!warnedOnce) {
        console.warn(
            `[Zep] Circuit OPEN — Zep unavailable for 5 min. Falling back to LocalContextStore. Error: ${(err as Error)?.message ?? err}`
        );
        warnedOnce = true;
    }
}

// ─── Client (lazy — only instantiated if key is present) ─────────────────────
let zep: ZepClient | null = null;

function getZepClient(): ZepClient | null {
    if (!config.zepApiKey) return null;
    if (!zep) zep = new ZepClient({ apiKey: config.zepApiKey });
    return zep;
}

// ─── Public Functions ─────────────────────────────────────────────────────────

export async function ensureSession(userId: string): Promise<void> {
    if (isCircuitOpen()) return;
    const client = getZepClient();
    if (!client) return;
    try {
        try { await client.user.add({ userId }); } catch { /* exists */ }
        try {
            await client.memory.getSession(userId);
        } catch {
            await client.memory.addSession({
                sessionId: userId,
                userId,
                metadata: { created_at: new Date().toISOString() },
            });
        }
    } catch (err) {
        tripCircuit(err);
    }
}

export async function addTurn(
    userId: string,
    userMessage: string,
    aiResponse: string
): Promise<void> {
    if (isCircuitOpen()) return;
    const client = getZepClient();
    if (!client) return;
    try {
        await client.memory.add(userId, {
            messages: [
                { role: "user", roleType: "user", content: userMessage },
                { role: "assistant", roleType: "assistant", content: aiResponse },
            ],
        });
    } catch (err) {
        tripCircuit(err);
    }
}

export async function getContext(
    userId: string,
    query: string
): Promise<{ facts: ZepFact[]; summary: string }> {
    if (isCircuitOpen()) return { facts: [], summary: "" };
    const client = getZepClient();
    if (!client) return { facts: [], summary: "" };
    try {
        const results = await client.memory.searchSessions({
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

        let summary = "";
        try {
            const mem = await client.memory.get(userId);
            summary = mem.summary?.content ?? "";
        } catch { /* no summary yet */ }

        return { facts, summary };
    } catch (err) {
        tripCircuit(err);
        return { facts: [], summary: "" };
    }
}

export async function getUserFacts(userId: string): Promise<ZepFact[]> {
    if (isCircuitOpen()) return [];
    const client = getZepClient();
    if (!client) return [];
    try {
        const facts = await client.user.getFacts(userId);
        return (facts.facts ?? []).map((f: any) => ({
            fact: f.fact,
            entity: f.name,
            valid_at: f.valid_at,
            invalid_at: f.invalid_at,
        }));
    } catch (err) {
        tripCircuit(err);
        return [];
    }
}
