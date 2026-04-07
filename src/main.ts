import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import path from "path";
import { config } from "./config";
import { chatHandler } from "./api/chat";
import { sessionRouter } from "./api/session";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/chat" });

// Middleware
app.use(cors());
app.use(express.json());

// REST routes
app.use("/session", sessionRouter);
app.get("/health", (_req, res) => {
    res.json({ status: "ok", model: config.groqModel, env: config.nodeEnv });
});

// Serve frontend
app.use(express.static(path.join(__dirname, "../frontend")));
app.get("*", (_req, res) => {
    res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

// WebSocket chat
wss.on("connection", chatHandler);

server.listen(config.port, () => {
    console.log(`\n🧠 Wellness AI running at http://localhost:${config.port}`);
    console.log(`   WebSocket: ws://localhost:${config.port}/chat`);
    console.log(`   Model: ${config.groqModel} via Groq\n`);
});
