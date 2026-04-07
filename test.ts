import { config } from "./src/config";
import { runRouterLLM } from "./src/router/routerLlm";
import { ensureSession } from "./src/memory/zepClient";
import Groq from "groq-sdk";

async function testAll() {
  console.log("1. Testing Groq...");
  try {
    const groq = new Groq({ apiKey: config.groqApiKey });
    const comp = await groq.chat.completions.create({
        model: config.groqModel,
        messages: [{ role: "user", content: "hi" }]
    });
    console.log("Groq OK:", comp.choices[0].message.content);
  } catch(e: any) { console.error("Groq Failed:", e.message); }

  console.log("\n2. Testing Gemini Router...");
  try {
    const res = await runRouterLLM("I feel sad today", []);
    console.log("Gemini OK:", res);
  } catch(e: any) { console.error("Gemini Failed:", e.message); }

  console.log("\n3. Testing Zep...");
  try {
    await ensureSession("test-123");
    console.log("Zep OK");
  } catch(e: any) { console.error("Zep Failed:", e.message); }
}

testAll();
