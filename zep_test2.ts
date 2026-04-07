import { ZepClient } from "@getzep/zep-cloud";
import * as dotenv from "dotenv";
dotenv.config();

async function testZep() {
    try {
        const client = new ZepClient({ apiKey: process.env.ZEP_API_KEY });
        
        console.log("Adding user...");
        try {
            await client.user.add({ userId: "test-user-3" });
            console.log("User added");
        } catch (e: any) {
            console.log("User add failed, might exist:", e.message);
        }

        console.log("Adding session...");
        await client.memory.addSession({
            sessionId: "test-session-3",
            userId: "test-user-3",
        });
        console.log("Session added!");
        
        const session = await client.memory.getSession("test-session-3");
        console.log("Got session:", session);
    } catch(e: any) {
        console.error("Failed:", e.message, e.statusCode);
    }
}

testZep();
