import { config } from "../config";
import type { RouterOutput } from "../types";
import { llmBalancer } from "../utils/llmBalancer";

const ROUTER_SYSTEM_PROMPT = `You are an expert clinical psychologist performing real-time signal detection on a user message.

Analyze the message for:
1. Crisis signals (suicidality, self-harm, psychosis, abuse, severe dissociation)
2. Primary and secondary emotions — be specific, not just "sad" or "angry"
3. What the user actually needs (validation, advice, venting, problem-solving, connection) vs what they asked for
4. Sarcasm or masking (saying "fine" when they're not)
5. Volatility — how quickly the emotional state could shift

Be thorough. The implicit_need is the most important field — detect what is UNSTATED.
Respond ONLY with valid JSON matching exactly this schema:
{
  "crisis_level": <integer 0=none, 5=imminent danger>,
  "crisis_flags": [<array of string>],
  "emotion": {
    "emotions": [
       { "label": <string>, "percentage": <integer 0-100> }
    ],
    "trajectory": <string "escalating"|"stable"|"de-escalating">
  },
  "implicit_need": <string "validation"|"advice"|"venting"|"problem_solving"|"connection"|"unknown">,
  "sarcasm_detected": <boolean>,
  "volatility_score": <float 0.0-1.0>,
  "semantic_memory_tags": [<array of string>],
  "episodic_memory_extract": <string>
}`;

export async function runRouterLLM(
    userMessage: string,
    conversationHistory: Array<{ role: string; content: string }>
): Promise<RouterOutput> {
    const historyContext =
        conversationHistory.length > 0
            ? `\n\nConversation history:\n${conversationHistory
                .slice(-6) // last 3 turns
                .map((t) => `${t.role}: ${t.content}`)
                .join("\n")}`
            : "";

    const prompt = `${historyContext}\n\nCurrent user message to analyze:\n"${userMessage}"`;

    try {
        const completion = await llmBalancer.createChatCompletion({
            model: config.routerModel,
            messages: [
                { role: "system", content: ROUTER_SYSTEM_PROMPT },
                { role: "user", content: prompt }
            ],
            temperature: 0.1, // Low temp for consistent analysis
            response_format: { type: "json_object" }
        });

        const text = completion.choices[0]?.message?.content || "{}";
        const parsed = JSON.parse(text) as RouterOutput;
        
        // Clamp crisis_level to valid range
        parsed.crisis_level = Math.max(0, Math.min(5, parsed.crisis_level || 0)) as RouterOutput["crisis_level"];
        
        // Ensure default values are somewhat present in case Groq misses keys
        return {
            crisis_level: parsed.crisis_level,
            crisis_flags: parsed.crisis_flags || [],
            emotion: parsed.emotion || { emotions: [{label: "unknown", percentage: 100}], trajectory: "stable" },
            implicit_need: parsed.implicit_need || "unknown",
            sarcasm_detected: parsed.sarcasm_detected || false,
            volatility_score: parsed.volatility_score || 0.3,
            semantic_memory_tags: parsed.semantic_memory_tags || [],
            episodic_memory_extract: parsed.episodic_memory_extract || userMessage.slice(0, 100),
        };
    } catch (err) {
        console.error("[RouterLLM] Failed to generate/parse response:", err);
        // Safe fallback
        return {
            crisis_level: 0,
            crisis_flags: [],
            emotion: { emotions: [{label: "unknown", percentage: 100}], trajectory: "stable" },
            implicit_need: "unknown",
            sarcasm_detected: false,
            volatility_score: 0.3,
            semantic_memory_tags: [],
            episodic_memory_extract: userMessage.slice(0, 100),
        };
    }
}
