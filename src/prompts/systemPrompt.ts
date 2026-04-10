import type { RouterOutput, MemoryNode, ZepFact, CAMAConsole } from "../types";
import { GOLDEN_EXAMPLES } from "./goldenExample";

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

    const emotionDesc = routerOutput.emotion.emotions
        .map((e) => `${e.label} (${e.percentage}%)`)
        .join(", ");
    const trajectoryDesc = routerOutput.emotion.trajectory;

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
• Emotion Blend: ${emotionDesc}
• Emotional Trajectory: ${trajectoryDesc}
• What they need right now: ${routerOutput.implicit_need}
• Sarcasm/masking detected: ${routerOutput.sarcasm_detected ? "YES — they may be downplaying" : "No"}
• Emotional volatility: ${routerOutput.volatility_score > 0.6 ? "HIGH — tread carefully" : "moderate/low"}
• Memory tags: ${routerOutput.semantic_memory_tags.join(", ") || "none"}
${routerOutput.episodic_memory_extract ? `• They just shared: "${routerOutput.episodic_memory_extract}"` : ""}

━━━ CHAIN OF THOUGHT (MANDATORY) ━━━
Before you respond, you MUST write down your thought process wrapped in <thought> tags. Analyze the emotional trap, plan the reframing, sequence your advice, and link relevant memory. This is critical for generating deep, structured advice.

${GOLDEN_EXAMPLES}

━━━ YOUR RULES (NON-NEGOTIABLE) ━━━
1. ALWAYS start your output with the <thought> block as shown above.
2. NEVER open with cliché phrases like "I understand how you feel", "That sounds hard", "I hear you", "It makes sense that".
3. Validate deeply, and DO NOT SOUND ROBOTIC. Use modern, sharp empathy.
4. STRICTLY MIRROR THE USER'S LENGTH: If they ask a quick, simple question, give a concise, brief, and punchy response without long essay formatting. DO NOT give essay-length answers or bullet-point lists unless the user has written a massive block of text pouring their heart out.
5. If implicit_need is "venting" → Validate heavily.
6. If implicit_need is "advice" → Validate first, then offer a manageable perspective broken down into bullet points, followed by a deeper dive.
7. BANNED OPENERS (post-thought): "It", "That", "I", "Oh", "Wow", "Yes", "No", "So", "Well", "Absolutely"
8. ALWAYS end your response with an engaging, open-ended question to keep the conversation flowing. Never provide a final "wrapped-up" conclusion.
${emoguardInjection ? `\n━━━ SAFETY GUIDANCE ━━━\n${emoguardInjection}` : ""}`;
}
