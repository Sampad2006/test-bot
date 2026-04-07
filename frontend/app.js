const EMOTION_ICONS = {
    anxiety: "😟",
    sadness: "😔",
    anger: "😤",
    fear: "😨",
    loneliness: "🌧️",
    shame: "😶",
    guilt: "😓",
    grief: "💔",
    frustration: "😤",
    hopelessness: "😶‍🌫️",
    overwhelm: "🌊",
    joy: "✨",
    unknown: "💭",
};

function getEmotionIcon(emotion) {
    return EMOTION_ICONS[emotion?.toLowerCase()] ?? "💭";
}

function formatTime() {
    return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

// ── WebSocket Setup ──────────────────────────────────────────────────────────
let ws = null;
let isWaiting = false;
let currentUserId = null;
let currentUserName = "there";

function connectWS() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/chat`);

    ws.onopen = () => {
        console.log("[WS] Connected");
        // Send session init
        ws.send(JSON.stringify({
            type: "init",
            userId: currentUserId,
            userName: currentUserName,
        }));
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleServerMessage(data);
    };

    ws.onclose = () => {
        console.log("[WS] Disconnected — retrying in 3s");
        setTimeout(connectWS, 3000);
    };

    ws.onerror = (e) => console.error("[WS] Error", e);
}

function handleServerMessage(data) {
    switch (data.type) {
        case "ready":
            setStatusDot(true);
            break;

        case "status":
            if (data.message === "thinking") showTypingIndicator();
            break;

        case "response":
            removeTypingIndicator();
            appendMessage("ai", data.message, data.isCrisis);
            updateEmotionBadge(data.emotion);
            if (data.isCrisis) showCrisisBanner();
            setWaiting(false);
            break;

        case "error":
            removeTypingIndicator();
            appendMessage("ai", "Something went wrong. Please try again.");
            setWaiting(false);
            break;
    }
}

// ── UI Helpers ───────────────────────────────────────────────────────────────
function setStatusDot(online) {
    const dot = document.getElementById("status-dot");
    dot.style.background = online ? "#4ade80" : "#f87171";
    dot.style.boxShadow = online ? "0 0 8px #4ade80" : "0 0 8px #f87171";
}

function setWaiting(val) {
    isWaiting = val;
    document.getElementById("send-btn").disabled = val;
    document.getElementById("message-input").disabled = val;
}

function showTypingIndicator() {
    removeTypingIndicator();
    const messages = document.getElementById("messages");
    const wrapper = document.createElement("div");
    wrapper.className = "message ai";
    wrapper.id = "typing-wrapper";
    wrapper.innerHTML = `
    <div class="typing-indicator">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;
    messages.appendChild(wrapper);
    scrollToBottom();
}

function removeTypingIndicator() {
    document.getElementById("typing-wrapper")?.remove();
}

function appendMessage(role, content, isCrisis = false) {
    // Remove empty state
    document.querySelector(".empty-state")?.remove();

    const messages = document.getElementById("messages");
    const wrapper = document.createElement("div");
    wrapper.className = `message ${role}${isCrisis ? " crisis" : ""}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = content;

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = formatTime();

    wrapper.appendChild(bubble);
    wrapper.appendChild(meta);
    messages.appendChild(wrapper);
    scrollToBottom();
}

function scrollToBottom() {
    const chatArea = document.getElementById("chat-area");
    chatArea.scrollTop = chatArea.scrollHeight;
}

function updateEmotionBadge(emotion) {
    if (!emotion) return;
    const badge = document.getElementById("emotion-badge");
    const icon = document.getElementById("emotion-icon");
    const label = document.getElementById("emotion-label");

    icon.textContent = getEmotionIcon(emotion.primary);
    label.textContent = emotion.primary.charAt(0).toUpperCase() + emotion.primary.slice(1);
    badge.classList.remove("hidden");
}

function showCrisisBanner() {
    document.getElementById("crisis-banner").classList.remove("hidden");
}

// ── Event: Send Message ───────────────────────────────────────────────────────
function sendMessage() {
    const input = document.getElementById("message-input");
    const text = input.value.trim();
    if (!text || isWaiting || !ws || ws.readyState !== WebSocket.OPEN) return;

    appendMessage("user", text);
    input.value = "";
    input.style.height = "auto";
    setWaiting(true);

    ws.send(JSON.stringify({ type: "chat", message: text }));
}

// ── Event: Setup Form ─────────────────────────────────────────────────────────
document.getElementById("start-btn").addEventListener("click", () => {
    const nameInput = document.getElementById("name-input");
    const name = nameInput.value.trim() || "there";

    currentUserName = name;
    currentUserId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    document.getElementById("setup-modal").style.display = "none";
    document.getElementById("app").classList.remove("hidden");

    // Show empty state
    const messages = document.getElementById("messages");
    messages.innerHTML = `
    <div class="empty-state">
      <span class="icon">🧠</span>
      <p>Hi ${name}. I'm here to listen — share whatever's on your mind.</p>
    </div>`;

    connectWS();
});

// Enter to send (Shift+Enter for newline)
document.getElementById("message-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Auto-resize textarea
document.getElementById("message-input").addEventListener("input", (e) => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
});

// Allow pressing Enter in the name field
document.getElementById("name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") document.getElementById("start-btn").click();
});

document.getElementById("send-btn").addEventListener("click", sendMessage);
