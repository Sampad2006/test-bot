/**
 * hybridMemory.ts
 * ---------------
 * Unified memory layer that wraps both Zep Cloud and LocalContextStore (MongoDB).
 *
 * Strategy:
 *  - Both layers are called in parallel (Promise.allSettled)
 *  - Results are merged: Zep facts + Local facts, deduped by content similarity
 *  - Summary: Zep summary takes precedence; falls back to Local summary
 *  - If Zep is unavailable (circuit-broken), Local serves as sole provider seamlessly
 *
 * Exports the exact same interface as zepClient.ts so nodes.ts needs
 * only a single import-path change to adopt the hybrid layer.
 */

import * as zep from "./zepClient";
import { localContextStore } from "./localContext";
import type { ZepFact } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Crude content-based deduplication:
 * Drop a fact if its first 40 chars already appear in the accepted set.
 */
function deduplicateFacts(facts: ZepFact[]): ZepFact[] {
    const seen = new Set<string>();
    return facts.filter((f) => {
        const key = f.fact.slice(0, 40).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ─── Public API (mirrors zepClient.ts exactly) ────────────────────────────────

export async function ensureSession(userId: string): Promise<void> {
    await Promise.allSettled([
        zep.ensureSession(userId),
        localContextStore.ensureSession(userId),
    ]);
}

export async function addTurn(
    userId: string,
    userMessage: string,
    aiResponse: string
): Promise<void> {
    await Promise.allSettled([
        zep.addTurn(userId, userMessage, aiResponse),
        localContextStore.addTurn(userId, userMessage, aiResponse),
    ]);
}

export async function getContext(
    userId: string,
    query: string
): Promise<{ facts: ZepFact[]; summary: string }> {
    const [zepResult, localResult] = await Promise.allSettled([
        zep.getContext(userId, query),
        localContextStore.getContext(userId, query),
    ]);

    const zepFacts: ZepFact[] =
        zepResult.status === "fulfilled" ? zepResult.value.facts : [];
    const zepSummary: string =
        zepResult.status === "fulfilled" ? zepResult.value.summary : "";

    const localFacts: ZepFact[] =
        localResult.status === "fulfilled" ? localResult.value.facts : [];
    const localSummary: string =
        localResult.status === "fulfilled" ? localResult.value.summary : "";

    // Merge: Zep facts first (they're richer knowledge-graph extractions),
    // then local facts as supplementary context
    const merged = deduplicateFacts([...zepFacts, ...localFacts]);

    // Prefer Zep's LLM-derived summary; fall back to local rolling digest
    const summary = zepSummary || localSummary;

    return { facts: merged, summary };
}

export async function getUserFacts(userId: string): Promise<ZepFact[]> {
    const [zepResult, localResult] = await Promise.allSettled([
        zep.getUserFacts(userId),
        localContextStore.getUserFacts(userId),
    ]);

    const zepFacts: ZepFact[] =
        zepResult.status === "fulfilled" ? zepResult.value : [];
    const localFacts: ZepFact[] =
        localResult.status === "fulfilled" ? localResult.value : [];

    return deduplicateFacts([...zepFacts, ...localFacts]);
}
