/**
 * Fine-Tune Data Logger
 * ----------------------
 * Appends every completed conversation turn to a daily JSONL file in
 * ./finetune_data/turns_YYYY-MM-DD.jsonl
 *
 * Format: OpenAI chat fine-tuning format (compatible with Groq's fine-tune API)
 * Each line is a complete JSON object:
 * {
 *   "messages": [
 *     { "role": "system",    "content": "<system prompt used>" },
 *     { "role": "user",      "content": "<user message>" },
 *     { "role": "assistant", "content": "<final AI response>" }
 *   ],
 *   "_meta": { ... router output + timestamp for filtering/analysis }
 * }
 *
 * Usage:
 *   import { logFineTuneTurn } from "../finetune/logger";
 *   await logFineTuneTurn({ systemPrompt, userMessage, aiResponse, routerOutput });
 *
 * The _meta field is NOT part of the fine-tune format — strip it before uploading:
 *   jq 'del(._meta)' finetune_data/turns_*.jsonl > upload_ready.jsonl
 */

import * as fs from "fs";
import * as path from "path";
import type { RouterOutput } from "../types";

interface FineTuneTurn {
    systemPrompt: string;
    userMessage: string;
    aiResponse: string;
    routerOutput?: RouterOutput | null;
    userId?: string;
}

function getTodayPath(): string {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const dir = path.resolve(process.cwd(), "finetune_data");
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, `turns_${date}.jsonl`);
}

export async function logFineTuneTurn(turn: FineTuneTurn): Promise<void> {
    try {
        const line = JSON.stringify({
            messages: [
                { role: "system",    content: turn.systemPrompt },
                { role: "user",      content: turn.userMessage },
                { role: "assistant", content: turn.aiResponse },
            ],
            _meta: {
                timestamp: new Date().toISOString(),
                userId: turn.userId ?? "anonymous",
                emotion: turn.routerOutput?.emotion ?? null,
                implicit_need: turn.routerOutput?.implicit_need ?? null,
                crisis_level: turn.routerOutput?.crisis_level ?? 0,
                volatility_score: turn.routerOutput?.volatility_score ?? null,
            },
        });

        fs.appendFileSync(getTodayPath(), line + "\n", "utf-8");
    } catch (err) {
        // Fire-and-forget: never crash the main flow over logging
        console.warn("[FineTuneLogger] Failed to write turn:", (err as Error).message);
    }
}
