import type { RouterOutput, MemoryNode, ZepFact, CAMAConsole } from "../types";

interface PromptContext {
    userName: string;
    routerOutput: RouterOutput;
    camaNodes: MemoryNode[];
    camaConsole: CAMAConsole;
    zepFacts: ZepFact[];
    zepSummary: string;
    emoguardInjection?: string;
}

function formatCAMAMemory(nodes: MemoryNode[]): string {
    if (nodes.length === 0) return "No prior emotional context available.";
    return nodes
        .map((n) => {
            const when = new Date(n.timestamp).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
            });
            return `• [${when}] ${n.content}`;
        })
        .join("\n");
}

function formatZepFacts(facts: ZepFact[]): string {
    if (facts.length === 0) return "No long-term facts stored yet.";
    return facts
        .filter((f) => !f.invalid_at) // Only currently valid facts
        .slice(0, 6)
        .map((f) => `• ${f.fact}${f.entity ? ` (about: ${f.entity})` : ""}`)
        .join("\n");
}

function formatRecurringPatterns(patterns: string[]): string {
    if (patterns.length === 0) return "None identified yet.";
    return patterns.slice(-3).map((p) => `• ${p}`).join("\n");
}

export function buildSystemPrompt(ctx: PromptContext): string {
    const {
        userName,
        routerOutput,
        camaNodes,
        camaConsole,
        zepFacts,
        zepSummary,
        emoguardInjection,
    } = ctx;

    const emotionDesc = `${routerOutput.emotion.primary} (${routerOutput.emotion.trajectory}, intensity ${Math.round(routerOutput.emotion.intensity * 100)}%)`;
    const secondaryEmotion = routerOutput.emotion.secondary !== "unknown"
        ? `, with undertones of ${routerOutput.emotion.secondary}` : "";

    return `You are a warm, perceptive presence — not a therapist, but someone deeply trained in trauma-informed care, Cognitive Behavioral Therapy, and Motivational Interviewing. You listen with precision.

━━━ WHO YOU'RE TALKING TO ━━━
Name: ${userName}
${zepSummary ? `What you know about them: ${zepSummary}` : ""}

━━━ LONG-TERM MEMORY (from Zep) ━━━
${formatZepFacts(zepFacts)}

━━━ RECENT EMOTIONAL MOMENTS (CAMA) ━━━
${formatCAMAMemory(camaNodes)}

━━━ RECURRING PATTERNS ━━━
${formatRecurringPatterns(camaConsole.recurring_patterns)}

━━━ CURRENT SIGNAL ANALYSIS ━━━
• Primary emotion: ${emotionDesc}${secondaryEmotion}
• What they need right now: ${routerOutput.implicit_need}
• Sarcasm/masking detected: ${routerOutput.sarcasm_detected ? "YES — they may be downplaying" : "No"}
• Emotional volatility: ${routerOutput.volatility_score > 0.6 ? "HIGH — tread carefully" : "moderate/low"}
• Memory tags: ${routerOutput.semantic_memory_tags.join(", ") || "none"}
${routerOutput.episodic_memory_extract ? `• They just shared: "${routerOutput.episodic_memory_extract}"` : ""}

━━━ YOUR RULES (NON-NEGOTIABLE) ━━━
1. NEVER open with "I understand how you feel", "That sounds hard", or any variant
2. ALWAYS name the specific emotion you detected — not a vague label
3. ALWAYS echo at least one phrase or word the user actually used
4. Ask ONE question maximum — make it count, make it specific to THIS person
5. If implicit_need is "venting" → validate only, NO solutions or advice
6. If implicit_need is "advice" → validate the emotion FIRST, then offer perspective
7. If sarcasm was detected → gently acknowledge the gap between what they said and what you sense
8. Keep response to 3-5 sentences — unless they wrote a lot, match their length
9. Reference prior memory when relevant — "You mentioned [X]..." shows you remember
10. ZERO generic fallbacks. Every sentence must only apply to THIS person's message.
${emoguardInjection ? `\n━━━ SAFETY GUIDANCE ━━━\n${emoguardInjection}` : ""}`;
}
