import { ZepClient } from "@getzep/zep-cloud";
import { config } from "./src/config";

async function testZep() {
    const defaultHeaders = {
        "User-Agent": "ZepClient-TS"
    };
    try {
        const zep = new ZepClient({ apiKey: config.zepApiKey });

        console.log("Trying to get session...");
        try {
            await zep.memory.getSession("test-1234");
            console.log("Session exists");
        } catch (e: any) {
            console.log("Get Error (expected 404 if not found):", e.statusCode, e.message);
            console.log("Adding session...");
            await zep.memory.addSession({
                sessionId: "test-1234",
                userId: "test-1234",
                metadata: { created_at: new Date().toISOString() },
            });
            console.log("Session added successfully");
        }
    } catch(e: any) {
        console.log("Zep Error final:", e.message, e.statusCode);
    }
}
testZep();
