import Groq from "groq-sdk";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";
import { config } from "../config";
import { runRouterLLM } from "../router/routerLlm";
import { CAMAMemory } from "../memory/cama";
import { ensureSession, getContext, getUserFacts, addTurn } from "../memory/zepClient";
import { buildSystemPrompt } from "../prompts/systemPrompt";
import { runEmoGuard, CRISIS_RESPONSES } from "../safety/emoguard";
import type { WellnessStateType } from "./state";

const groq = new Groq({ apiKey: config.groqApiKey });

// Cache CAMA instances per user (in-memory within process lifetime)
const camaCache = new Map<string, CAMAMemory>();

function getCAMA(userId: string): CAMAMemory {
    if (!camaCache.has(userId)) {
        camaCache.set(userId, new CAMAMemory(userId));
    }
    return camaCache.get(userId)!;
}

// ─── Node: Intake ────────────────────────────────────────────────────────────
export async function intakeNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    // Ensure Zep session exists
    await ensureSession(state.userId);
    return {
        messages: [...state.messages, new HumanMessage(state.currentMessage)],
    };
}

// ─── Node: Router ─────────────────────────────────────────────────────────────
export async function routerNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    const history = state.messages.slice(-6).map((m: BaseMessage) => ({
        role: m._getType() === "human" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : "",
    }));

    const routerOutput = await runRouterLLM(state.currentMessage, history);
    const emoguardSensitivity =
        routerOutput.crisis_level >= 3
            ? "HIGH"
            : routerOutput.volatility_score > 0.6
                ? "HIGH"
                : "MEDIUM";

    return {
        routerOutput,
        emoguardSensitivity,
        isCrisis: routerOutput.crisis_level >= 4,
    };
}

// ─── Node: Crisis ─────────────────────────────────────────────────────────────
export async function crisisNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    const level = state.routerOutput?.crisis_level ?? 5;
    const response = CRISIS_RESPONSES[level] ?? CRISIS_RESPONSES[5];
    return { finalResponse: response };
}

// ─── Node: Memory Fetch ───────────────────────────────────────────────────────
export async function memoryFetchNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    const cama = getCAMA(state.userId);
    await cama.load();

    const emotionTags = [
        state.routerOutput?.emotion.primary ?? "",
        state.routerOutput?.emotion.secondary ?? "",
        ...(state.routerOutput?.semantic_memory_tags ?? []),
    ].filter(Boolean);

    const [camaNodes, zepContext, zepFacts] = await Promise.all([
        Promise.resolve(cama.recall(emotionTags, 5)),
        getContext(state.userId, state.currentMessage),
        getUserFacts(state.userId),
    ]);

    return {
        camaNodes,
        camaConsole: cama.getConsole(),
        zepFacts: [...zepContext.facts, ...zepFacts],
        zepSummary: zepContext.summary,
    };
}

// ─── Node: Generation ─────────────────────────────────────────────────────────
export async function generationNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    const systemPrompt = buildSystemPrompt({
        userName: state.userName,
        routerOutput: state.routerOutput!,
        camaNodes: state.camaNodes,
        camaConsole: state.camaConsole,
        zepFacts: state.zepFacts,
        zepSummary: state.zepSummary,
        emoguardInjection:
            state.emoguardReport?.should_refine
                ? state.emoguardReport.intervention_advice
                : undefined,
    });

    const history = state.messages.slice(-8).map((m: BaseMessage) => ({
        role: (m._getType() === "human" ? "user" : "assistant") as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : "",
    }));

    const completion = await groq.chat.completions.create({
        model: config.groqModel,
        messages: [
            { role: "system", content: systemPrompt },
            ...history,
            { role: "user", content: state.currentMessage },
        ],
        temperature: 0.8,
        max_tokens: 350,
    });

    const draft = completion.choices[0]?.message?.content ?? "";
    return { responseDraft: draft };
}

// ─── Node: EmoGuard ───────────────────────────────────────────────────────────
export async function emoguardNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    const history = state.messages.slice(-6).map((m: BaseMessage) => ({
        role: m._getType() === "human" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : "",
    }));

    const report = await runEmoGuard(
        state.currentMessage,
        state.responseDraft,
        history
    );
    
    // FIX: Actually increment the refineCount so the loop eventually breaks!
    return { 
        emoguardReport: report,
        refineCount: (state.refineCount ?? 0) + 1 
    };
}
// ─── Node: Output ─────────────────────────────────────────────────────────────
export async function outputNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    return {
        finalResponse: state.responseDraft,
        messages: [...state.messages, new AIMessage(state.responseDraft)],
        refineCount: 0 // FIX: Reset the counter for the next user message
    };
}

// ─── Node: Memory Update ──────────────────────────────────────────────────────
export async function memoryUpdateNode(
    state: WellnessStateType
): Promise<Partial<WellnessStateType>> {
    const cama = getCAMA(state.userId);
    const salience = Math.max(
        state.routerOutput?.emotion.intensity ?? 0.5,
        state.routerOutput?.volatility_score ?? 0.3
    );

    // Store the episode in CAMA
    await cama.ingest(
        state.currentMessage,
        [
            state.routerOutput?.emotion.primary ?? "",
            state.routerOutput?.emotion.secondary ?? "",
            ...(state.routerOutput?.semantic_memory_tags ?? []),
        ].filter(Boolean),
        salience
    );

    // Add to Zep long-term memory
    await addTurn(state.userId, state.currentMessage, state.finalResponse);

    return {};
}

// ─── Conditional Edges ────────────────────────────────────────────────────────
export function routeAfterRouter(state: WellnessStateType): string {
    if (state.isCrisis) return "crisis";
    return "memory_fetch";
}

export function routeAfterEmoguard(state: WellnessStateType): string {
    // Max 2 refinement loops to avoid infinite loops
    if (state.emoguardReport?.should_refine && (state.refineCount ?? 0) < 2) {
        return "refine";
    }
    return "output";
}
