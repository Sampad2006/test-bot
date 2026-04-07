import Groq from "groq-sdk";
import { config } from "../config";
import type { EmoGuardReport } from "../types";

const groq = new Groq({ apiKey: config.groqApiKey });

// --- Banned phrases that signal a generic response ---
const BANNED_PHRASES = [
    "i understand how you feel",
    "that sounds really tough",
    "it's important to remember",
    "you're not alone",
    "have you considered speaking to a professional",
    "take care of yourself",
    "i hear you",
    "that must be hard",
    "it's okay to feel",
    "you should reach out",
];

export function checkSpecificity(
    response: string,
    userMessage: string
): { pass: boolean; reason: string } {
    const lower = response.toLowerCase();

    for (const phrase of BANNED_PHRASES) {
        if (lower.includes(phrase)) {
            return { pass: false, reason: `Generic phrase detected: "${phrase}"` };
        }
    }

    // Check that at least one meaningful word from the user message is echoed
    const userWords = userMessage
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 4);

    const echoed = userWords.some((w) => lower.includes(w));
    if (userWords.length > 3 && !echoed) {
        return { pass: false, reason: "No lexical echo of user's language" };
    }

    return { pass: true, reason: "OK" };
}

async function callEmoGuardLLM(prompt: string): Promise<string> {
    const res = await groq.chat.completions.create({
        model: config.emoguardModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 400,
        response_format: { type: "json_object" },
    });
    return res.choices[0]?.message?.content ?? "{}";
}

// Sub-agent 1: Emotion Watcher
async function emotionWatcher(
    userMessage: string,
    history: Array<{ role: string; content: string }>
): Promise<{ distress_level: number; masking: boolean; escalating: boolean }> {
    const prompt = `You are an emotion monitoring agent. Analyze this user message for signs of distress, masking ("I'm fine" when not), and emotional escalation.

History (last 4 turns):
${history.slice(-4).map((t) => `${t.role}: ${t.content}`).join("\n")}

Current message: "${userMessage}"

Respond with JSON: { "distress_level": 0.0-1.0, "masking": true/false, "escalating": true/false }`;

    try {
        const raw = await callEmoGuardLLM(prompt);
        return JSON.parse(raw);
    } catch {
        return { distress_level: 0.3, masking: false, escalating: false };
    }
}

// Sub-agent 2: Thought Refiner
async function thoughtRefiner(
    userMessage: string,
    emotionResult: { distress_level: number; masking: boolean }
): Promise<{ harmful_patterns: string[]; delusion_risk: boolean }> {
    const prompt = `You are a cognitive distortion detector. Identify harmful thought patterns in this message.

User message: "${userMessage}"
Detected distress level: ${emotionResult.distress_level}

Look for: catastrophizing, black-and-white thinking, self-blame, paranoia, delusions.

Respond with JSON: { "harmful_patterns": ["list of patterns found"], "delusion_risk": true/false }`;

    try {
        const raw = await callEmoGuardLLM(prompt);
        return JSON.parse(raw);
    } catch {
        return { harmful_patterns: [], delusion_risk: false };
    }
}

// Sub-agent 3: Dialog Guide
async function dialogGuide(
    draftResponse: string,
    userMessage: string
): Promise<{ is_dismissive: boolean; is_advice_before_validation: boolean; topic_drift: boolean }> {
    const prompt = `You are a therapeutic dialog quality assessor. Evaluate this AI response draft.

User said: "${userMessage}"
AI draft: "${draftResponse}"

Check: Is the response dismissive? Does it give advice before validating emotions? Does it bring up topics the user never mentioned?

Respond with JSON: { "is_dismissive": true/false, "is_advice_before_validation": true/false, "topic_drift": true/false }`;

    try {
        const raw = await callEmoGuardLLM(prompt);
        return JSON.parse(raw);
    } catch {
        return { is_dismissive: false, is_advice_before_validation: false, topic_drift: false };
    }
}

// Manager: synthesizes all sub-agent outputs
async function manager(
    draftResponse: string,
    emotionResult: Awaited<ReturnType<typeof emotionWatcher>>,
    thoughtResult: Awaited<ReturnType<typeof thoughtRefiner>>,
    dialogResult: Awaited<ReturnType<typeof dialogGuide>>
): Promise<{ risk_score: number; intervention_advice: string; should_refine: boolean }> {
    const issues: string[] = [];

    if (emotionResult.distress_level > 0.7) issues.push("high user distress detected");
    if (emotionResult.masking) issues.push("user may be masking true feelings");
    if (emotionResult.escalating) issues.push("emotional trajectory is escalating");
    if (thoughtResult.harmful_patterns.length > 0)
        issues.push(`harmful thought patterns: ${thoughtResult.harmful_patterns.join(", ")}`);
    if (thoughtResult.delusion_risk) issues.push("possible delusional thinking detected");
    if (dialogResult.is_dismissive) issues.push("response appears dismissive");
    if (dialogResult.is_advice_before_validation) issues.push("advice given before emotional validation");
    if (dialogResult.topic_drift) issues.push("response references topic user never raised");

    const risk_score = Math.min(
        1.0,
        emotionResult.distress_level * 0.4 +
        (thoughtResult.harmful_patterns.length > 0 ? 0.2 : 0) +
        (thoughtResult.delusion_risk ? 0.3 : 0) +
        (dialogResult.is_dismissive ? 0.15 : 0) +
        (dialogResult.is_advice_before_validation ? 0.1 : 0)
    );

    const intervention_advice =
        issues.length > 0
            ? `Issues found: ${issues.join("; ")}. Rewrite the response to: first validate the emotion explicitly, avoid advice unless asked, reflect back the user's specific words.`
            : "Response is safe.";

    return {
        risk_score,
        intervention_advice,
        should_refine: risk_score > 0.5 || issues.length > 1,
    };
}

// Main EmoGuard entry point
export async function runEmoGuard(
    userMessage: string,
    draftResponse: string,
    history: Array<{ role: string; content: string }>
): Promise<EmoGuardReport> {
    const [emotionResult, thoughtResult] = await Promise.all([
        emotionWatcher(userMessage, history),
        thoughtRefiner(userMessage, { distress_level: 0.5, masking: false }),
    ]);

    const dialogResult = await dialogGuide(draftResponse, userMessage);
    const managerResult = await manager(draftResponse, emotionResult, thoughtResult, dialogResult);

    const specificityCheck = checkSpecificity(draftResponse, userMessage);

    return {
        risk_score: managerResult.risk_score,
        flags: [
            ...(emotionResult.masking ? ["masking"] : []),
            ...(emotionResult.escalating ? ["escalating"] : []),
            ...thoughtResult.harmful_patterns,
            ...(thoughtResult.delusion_risk ? ["delusion_risk"] : []),
            ...(!specificityCheck.pass ? ["generic_response"] : []),
        ],
        intervention_advice: specificityCheck.pass
            ? managerResult.intervention_advice
            : `${managerResult.intervention_advice} ALSO: ${specificityCheck.reason}`,
        should_refine: managerResult.should_refine || !specificityCheck.pass,
    };
}

// Crisis response templates (bypass LLM entirely)
export const CRISIS_RESPONSES: Record<number, string> = {
    4: "I can hear that you're carrying something incredibly heavy right now. What you're feeling matters, and I want you to be safe. Please consider reaching out to a crisis line — in India, you can call iCall at 9152987821. I'm here with you.",
    5: "What you just shared tells me you need real support right now, not from an AI. Please call iCall (9152987821) or text a trusted person immediately. Your life has value, and this moment doesn't have to be the end of your story. Are you somewhere safe right now?",
};
