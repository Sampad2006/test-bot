const WebSocket = require("ws");
const { randomUUID } = require("crypto");
const util = require("util");

function getConfig(options) {
  const cfg = options && options.config ? options.config : {};
  return {
    wsUrl: process.env.WELLNESS_WS_URL || cfg.wsUrl || "ws://localhost:8000/chat",
    timeoutMs: Number(process.env.WELLNESS_EVAL_TIMEOUT_MS || cfg.timeoutMs || 45000),
    userName: process.env.WELLNESS_EVAL_USER || cfg.userName || "Judge",
  };
}

function runTurn({ wsUrl, timeoutMs, userName, message }) {
  return new Promise((resolve, reject) => {
    const userId = `eval_${randomUUID()}`;
    const sessionId = randomUUID();
    const ws = new WebSocket(wsUrl);
    let finished = false;

    const done = (fn, payload) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
      fn(payload);
    };

    const timer = setTimeout(() => {
      done(reject, new Error(`Timed out waiting for model response after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "init",
          userId,
          userName,
          sessionId,
        })
      );
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "ready") {
        ws.send(JSON.stringify({ type: "chat", message, sessionId }));
        return;
      }

      if (msg.type === "response") {
        done(resolve, {
          output: msg.message || "",
          metadata: {
            isCrisis: Boolean(msg.isCrisis),
            emotion: msg.emotion || null,
            implicitNeed: msg.implicitNeed || null,
            userId,
            sessionId,
          },
        });
        return;
      }

      if (msg.type === "error") {
        done(reject, new Error(msg.message || "Unknown chat error"));
      }
    });

    ws.on("error", (err) => {
      done(reject, err);
    });
  });
}

function formatError(error) {
  if (!error) return "Unknown error";
  if (error instanceof Error) {
    if (error.message && error.message.trim()) return error.message;

    const nested = error.errors;
    if (Array.isArray(nested) && nested.length > 0) {
      const nestedMessages = nested
        .map((e) => (e && e.message ? e.message : String(e || "")))
        .filter(Boolean);
      if (nestedMessages.length > 0) return nestedMessages.join(" | ");
    }
  }

  try {
    return util.inspect(error, { depth: 2, breakLength: 120 });
  } catch {
    return String(error);
  }
}

module.exports = class WellnessWebsocketProvider {
  constructor(options = {}) {
    this.providerId = options.id || "wellness-websocket-provider";
    this.config = options.config || {};
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, _context, _options) {
    const { wsUrl, timeoutMs, userName } = getConfig({ config: this.config });

    try {
      const result = await runTurn({
        wsUrl,
        timeoutMs,
        userName,
        message: String(prompt || "").trim(),
      });

      return {
        output: result.output,
        metadata: result.metadata,
      };
    } catch (error) {
      return {
        output:
          "I want to respond thoughtfully, but a temporary evaluation transport issue occurred. Please treat this as an infrastructure fallback output.",
        metadata: {
          providerError: formatError(error),
          fallback: true,
        },
      };
    }
  }
};
