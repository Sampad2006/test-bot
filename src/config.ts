import * as dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
}

export const config = {
    groqApiKey: required("GROQ_API_KEY"),
    groqApiKeys: (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "").split(",").map(k => k.trim()).filter(Boolean),
    // Optional: Gemini API Key (commented out as per request to rely on Groq)
    geminiApiKey: process.env.GEMINI_API_KEY ?? "",
    // Optional: Zep Cloud falls back to LocalContextStore if key is missing/invalid
    zepApiKey: process.env.ZEP_API_KEY ?? "",
    mongodbUri: required("MONGODB_URI"),

    port: parseInt(process.env.PORT ?? "8000"),
    nodeEnv: process.env.NODE_ENV ?? "development",

    groqModel: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
    routerModel: process.env.ROUTER_MODEL ?? "llama-3.1-8b-instant",
    emoguardModel: process.env.EMOGUARD_MODEL ?? "llama-3.1-8b-instant",
};
