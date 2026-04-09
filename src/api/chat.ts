import { WebSocket } from "ws";
import { wellnessGraph } from "../graph/graph";
import { v4 as uuidv4 } from "uuid";

interface IncomingMessage {
    type: "chat" | "init";
    message?: string;
    userId?: string;
    userName?: string;
    sessionId?: string;
}

export function chatHandler(ws: WebSocket): void {
    let sessionUserId: string = uuidv4();
    let sessionUserName: string = "there";
    let activeSessionId: string = uuidv4();

    ws.on("message", async (raw) => {
        let parsed: IncomingMessage;
        try {
            parsed = JSON.parse(raw.toString()) as IncomingMessage;
        } catch {
            ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
            return;
        }

        // Handle session init
        if (parsed.type === "init") {
            sessionUserId = parsed.userId ?? uuidv4();
            sessionUserName = parsed.userName ?? "there";
            activeSessionId = parsed.sessionId ?? uuidv4();
            ws.send(JSON.stringify({ type: "ready", userId: sessionUserId, userName: sessionUserName, sessionId: activeSessionId }));
            return;
        }

        // Handle chat message
        if (parsed.type === "chat" && parsed.message?.trim()) {
            try {
                ws.send(JSON.stringify({ type: "status", message: "thinking" }));

                if (parsed.sessionId) activeSessionId = parsed.sessionId;
                
                const result = await wellnessGraph.invoke(
                    {
                        currentMessage: parsed.message.trim(),
                        userId: sessionUserId,
                        userName: sessionUserName,
                    },
                    { configurable: { thread_id: activeSessionId } }
                );

                const response = result.finalResponse as string;
                const routerOutput = result.routerOutput;
                const isCrisis = result.isCrisis as boolean;

                ws.send(
                    JSON.stringify({
                        type: "response",
                        message: response,
                        isCrisis,
                        emotion: routerOutput?.emotion ?? null,
                        implicitNeed: routerOutput?.implicit_need ?? null,
                    })
                );
            } catch (err) {
                console.error("[Chat WS] Error:", err);
                ws.send(
                    JSON.stringify({
                        type: "error",
                        message: "Something went wrong processing your message.",
                    })
                );
            }
        }
    });

    ws.on("close", () => {
        console.log(`[WS] Session closed: ${sessionUserId}`);
    });
}
