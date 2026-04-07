import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { config } from "../config";
import type { RouterOutput } from "../types";

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

const ROUTER_SCHEMA = {
    type: SchemaType.OBJECT,
    properties: {
        crisis_level: { type: SchemaType.INTEGER, description: "0=none, 5=imminent danger" },
        crisis_flags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        emotion: {
            type: SchemaType.OBJECT,
            properties: {
                primary: { type: SchemaType.STRING },
                secondary: { type: SchemaType.STRING },
                intensity: { type: SchemaType.NUMBER },
                trajectory: { type: SchemaType.STRING },
            },
            required: ["primary", "secondary", "intensity", "trajectory"],
        },
        implicit_need: { type: SchemaType.STRING },
        sarcasm_detected: { type: SchemaType.BOOLEAN },
        volatility_score: { type: SchemaType.NUMBER },
        semantic_memory_tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        episodic_memory_extract: { type: SchemaType.STRING },
    },
    required: [
        "crisis_level", "crisis_flags", "emotion", "implicit_need",
        "sarcasm_detected", "volatility_score", "semantic_memory_tags", "episodic_memory_extract",
    ],
};

const ROUTER_SYSTEM_PROMPT = `You are an expert clinical psychologist performing real-time signal detection on a user message.

Analyze the message for:
1. Crisis signals (suicidality, self-harm, psychosis, abuse, severe dissociation)
2. Primary and secondary emotions — be specific, not just "sad" or "angry"
3. What the user actually needs (validation, advice, venting, problem-solving, connection) vs what they asked for
4. Sarcasm or masking (saying "fine" when they're not)
5. Volatility — how quickly the emotional state could shift

Be thorough. The implicit_need is the most important field — detect what is UNSTATED.
Respond ONLY with valid JSON matching the schema.`;

export async function runRouterLLM(
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }>
): Promise<RouterOutput> {
    const model = genAI.getGenerativeModel({
        model: config.routerModel,
        systemInstruction: ROUTER_SYSTEM_PROMPT,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: ROUTER_SCHEMA as any,
            temperature: 0.1, // Low temp for consistent analysis
        },
    });

    const historyContext =
        conversationHistory.length > 0
            ? `\n\nConversation history:\n${conversationHistory
                .slice(-6) // last 3 turns
                .map((t) => `${t.role}: ${t.content}`)
                .join("\n")}`
            : "";

    const prompt = `${historyContext}\n\nCurrent user message to analyze:\n"${userMessage}"`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    try {
        const parsed = JSON.parse(text) as RouterOutput;
        // Clamp crisis_level to valid range
        parsed.crisis_level = Math.max(0, Math.min(5, parsed.crisis_level)) as RouterOutput["crisis_level"];
        return parsed;
    } catch {
        console.error("[RouterLLM] Failed to parse response:", text);
        // Safe fallback
        return {
            crisis_level: 0,
            crisis_flags: [],
            emotion: { primary: "unknown", secondary: "unknown", intensity: 0.5, trajectory: "stable" },
            implicit_need: "unknown",
            sarcasm_detected: false,
            volatility_score: 0.3,
            semantic_memory_tags: [],
            episodic_memory_extract: userMessage.slice(0, 100),
        };
    }
}
