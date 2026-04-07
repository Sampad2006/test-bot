import { Router, Request, Response } from "express";
import { MongoClient } from "mongodb";
import { config } from "../config";

export const sessionRouter = Router();
const client = new MongoClient(config.mongodbUri);

async function getSessionsCollection() {
    await client.connect();
    return client.db("wellness_db").collection("sessions");
}

// POST /session/new — create or retrieve a session for a user
sessionRouter.post("/new", async (req: Request, res: Response) => {
    try {
        const { userId, userName } = req.body as { userId?: string; userName?: string };
        if (!userId) {
            return res.status(400).json({ error: "userId is required" });
        }

        const col = await getSessionsCollection();
        await col.updateOne(
            { userId },
            {
                $setOnInsert: {
                    userId,
                    userName: userName ?? "there",
                    createdAt: new Date(),
                },
                $set: { lastActive: new Date() },
            },
            { upsert: true }
        );

        const session = await col.findOne({ userId });
        return res.json({ sessionId: userId, userName: session?.userName ?? "there" });
    } catch (err) {
        console.error("[Session] POST /new error:", err);
        return res.status(500).json({ error: "Failed to create session" });
    }
});

// GET /session/:id/history — retrieve past messages
sessionRouter.get("/:id/history", async (req: Request, res: Response) => {
    try {
        const col = await getSessionsCollection();
        const session = await col.findOne({ userId: req.params.id });
        if (!session) return res.status(404).json({ error: "Session not found" });
        return res.json({ userId: session.userId, userName: session.userName });
    } catch (err) {
        console.error("[Session] GET history error:", err);
        return res.status(500).json({ error: "Failed to retrieve session" });
    }
});
