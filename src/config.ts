import * as dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
    const val = process.env[key];
    if (!val) throw new Error(`Missing required env var: ${key}`);
    return val;
}

export const config = {
    groqApiKey: required("GROQ_API_KEY"),
    geminiApiKey: required("GEMINI_API_KEY"),
    zepApiKey: required("ZEP_API_KEY"),
    mongodbUri: required("MONGODB_URI"),

    port: parseInt(process.env.PORT ?? "8000"),
    nodeEnv: process.env.NODE_ENV ?? "development",

    groqModel: process.env.GROQ_MODEL ?? "llama-3.1-8b-instant",
    routerModel: process.env.ROUTER_MODEL ?? "gemini-2.5-flash-latest",
    emoguardModel: process.env.EMOGUARD_MODEL ?? "llama-3.1-8b-instant",
};
