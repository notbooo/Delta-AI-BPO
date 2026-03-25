import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.ts";

const app = new Hono();

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// ─── KV Key Constants ────────────────────────────────────
const KV_AI_API_KEY = "ai_config:api_key";
const KV_AI_MODEL = "ai_config:model";
const KV_AI_IMPORT_MODEL = "ai_config:import_model";
const KV_AI_SETTINGS_PREFIX = "ai_config:";
const KV_PREFS_PREFIX = "agent_prefs:";
const KV_CHAT_PREFIX = "ask_ai_chat:";

// ─── Health Check ────────────────────────────────────────
app.get("/make-server-ab702ee0/health", (c) => {
  return c.json({ status: "ok" });
});

// ─── AI Settings: GET ────────────────────────────────────
// Returns the saved AI configuration (API key masked, model name)
app.get("/make-server-ab702ee0/ai/settings", async (c) => {
  try {
    const [apiKey, model, importModel] = await Promise.all([
      kv.get(KV_AI_API_KEY),
      kv.get(KV_AI_MODEL),
      kv.get(KV_AI_IMPORT_MODEL),
    ]);

    const rawKey = typeof apiKey === "string" ? apiKey : "";
    const maskedKey = rawKey
      ? `${rawKey.slice(0, 8)}...${rawKey.slice(-4)}`
      : "";

    return c.json({
      hasApiKey: !!rawKey,
      maskedApiKey: maskedKey,
      model: (typeof model === "string" ? model : "") || "openai/gpt-4o-mini",
      importModel: (typeof importModel === "string" ? importModel : "") || "google/gemini-3.1-flash-lite-preview",
    });
  } catch (err: any) {
    console.log(`Error fetching AI settings: ${err.message}`);
    return c.json({ error: `Failed to load AI settings: ${err.message}` }, 500);
  }
});

// ─── AI Settings: PUT ────────────────────────────────────
// Save or update AI configuration
app.put("/make-server-ab702ee0/ai/settings", async (c) => {
  try {
    const body = await c.req.json();
    const { apiKey, model, importModel } = body;

    const keys: string[] = [];
    const values: any[] = [];

    if (typeof apiKey === "string") {
      keys.push(KV_AI_API_KEY);
      values.push(apiKey);
    }

    if (typeof model === "string" && model.trim()) {
      keys.push(KV_AI_MODEL);
      values.push(model.trim());
    }

    if (typeof importModel === "string" && importModel.trim()) {
      keys.push(KV_AI_IMPORT_MODEL);
      values.push(importModel.trim());
    }

    if (keys.length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    await kv.mset(keys, values);

    // Return current state
    const savedKey = typeof apiKey === "string" ? apiKey : (await kv.get(KV_AI_API_KEY) || "");
    const savedModel = typeof model === "string" ? model : (await kv.get(KV_AI_MODEL) || "openai/gpt-4o-mini");
    const savedImportModel = typeof importModel === "string" ? importModel : (await kv.get(KV_AI_IMPORT_MODEL) || "google/gemini-3.1-flash-lite-preview");
    const maskedKey = savedKey
      ? `${savedKey.slice(0, 8)}...${savedKey.slice(-4)}`
      : "";

    return c.json({
      hasApiKey: !!savedKey,
      maskedApiKey: maskedKey,
      model: savedModel,
      importModel: savedImportModel,
    });
  } catch (err: any) {
    console.log(`Error saving AI settings: ${err.message}`);
    return c.json({ error: `Failed to save AI settings: ${err.message}` }, 500);
  }
});

// ─── AI Settings: DELETE (clear API key) ─────────────────
app.delete("/make-server-ab702ee0/ai/settings/key", async (c) => {
  try {
    await kv.set(KV_AI_API_KEY, "");
    return c.json({ hasApiKey: false, maskedApiKey: "", model: (await kv.get(KV_AI_MODEL)) || "openai/gpt-4o-mini" });
  } catch (err: any) {
    console.log(`Error clearing API key: ${err.message}`);
    return c.json({ error: `Failed to clear API key: ${err.message}` }, 500);
  }
});

// ─── Agent Preferences: GET ──────────────────────────────
// Returns all saved agent preferences (devMode, agentName, etc.)
app.get("/make-server-ab702ee0/preferences", async (c) => {
  try {
    const prefKeys = ["devMode", "agentName", "darkMode", "defaultLanguage", "hostSettings", "ticketState", "properties"];
    const results = await Promise.all(
      prefKeys.map(k => kv.get(`${KV_PREFS_PREFIX}${k}`))
    );

    const prefs: Record<string, any> = {};
    for (let i = 0; i < prefKeys.length; i++) {
      if (results[i] !== undefined && results[i] !== null) {
        prefs[prefKeys[i]] = results[i];
      }
    }
    return c.json(prefs);
  } catch (err: any) {
    console.log(`Error fetching agent preferences: ${err.message}`);
    return c.json({ error: `Failed to load preferences: ${err.message}` }, 500);
  }
});

// ─── Agent Preferences: PUT ──────────────────────────────
// Save agent preferences — accepts any key/value pairs
app.put("/make-server-ab702ee0/preferences", async (c) => {
  try {
    const body = await c.req.json();
    const keys: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(body)) {
      keys.push(`${KV_PREFS_PREFIX}${key}`);
      values.push(value);
    }

    if (keys.length === 0) {
      return c.json({ error: "No preferences to save" }, 400);
    }

    await kv.mset(keys, values);
    return c.json({ saved: Object.keys(body) });
  } catch (err: any) {
    console.log(`Error saving agent preferences: ${err.message}`);
    return c.json({ error: `Failed to save preferences: ${err.message}` }, 500);
  }
});

// ─── OpenRouter Proxy: Compose Reply ─────────────────────
// Proxies the AI call through the server so the API key never reaches the client
app.post("/make-server-ab702ee0/ai/compose-reply", async (c) => {
  try {
    const apiKey = await kv.get(KV_AI_API_KEY);
    if (!apiKey) {
      return c.json({ error: "No API key configured. Go to Settings > AI Configuration to add one." }, 400);
    }

    const body = await c.req.json();
    const { systemPrompt, userPrompt, model, temperature, maxTokens } = body;

    if (!systemPrompt || !userPrompt) {
      return c.json({ error: "Missing required fields: systemPrompt, userPrompt" }, 400);
    }

    const aiModel = model || (await kv.get(KV_AI_MODEL)) || "openai/gpt-4o-mini";
    const startMs = performance.now();

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-Title": "Hospitality BPO Platform",
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens ?? 1024,
      }),
    });

    const durationMs = Math.round(performance.now() - startMs);
    const json = await res.json();

    if (!res.ok) {
      const errMsg = json?.error?.message || JSON.stringify(json);
      console.log(`OpenRouter API error (compose-reply): ${res.status} ${errMsg}`);
      return c.json({
        error: errMsg,
        status: res.status,
        durationMs,
        model: aiModel,
      }, res.status);
    }

    const text = json.choices?.[0]?.message?.content || "";
    const usage = json.usage
      ? {
          prompt: json.usage.prompt_tokens ?? 0,
          completion: json.usage.completion_tokens ?? 0,
          total: json.usage.total_tokens ?? 0,
        }
      : null;

    return c.json({
      text,
      tokensUsed: usage,
      model: aiModel,
      durationMs,
      status: res.status,
    });
  } catch (err: any) {
    console.log(`Network error in compose-reply proxy: ${err.message}`);
    return c.json({ error: `Network error: ${err.message}` }, 502);
  }
});

// ─── OpenRouter Proxy: Ask AI ────────────────────────────
app.post("/make-server-ab702ee0/ai/ask", async (c) => {
  try {
    const apiKey = await kv.get(KV_AI_API_KEY);
    if (!apiKey) {
      return c.json({ error: "No API key configured. Go to Settings > AI Configuration to add one." }, 400);
    }

    const body = await c.req.json();
    const { systemPrompt, userPrompt, model, temperature, maxTokens } = body;

    if (!systemPrompt || !userPrompt) {
      return c.json({ error: "Missing required fields: systemPrompt, userPrompt" }, 400);
    }

    const aiModel = model || (await kv.get(KV_AI_MODEL)) || "openai/gpt-4o-mini";
    const startMs = performance.now();

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-Title": "Hospitality BPO Platform",
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: temperature ?? 0.5,
        max_tokens: maxTokens ?? 512,
      }),
    });

    const durationMs = Math.round(performance.now() - startMs);
    const json = await res.json();

    if (!res.ok) {
      const errMsg = json?.error?.message || JSON.stringify(json);
      console.log(`OpenRouter API error (ask-ai): ${res.status} ${errMsg}`);
      return c.json({
        error: errMsg,
        status: res.status,
        durationMs,
        model: aiModel,
      }, res.status);
    }

    const text = json.choices?.[0]?.message?.content || "";
    const usage = json.usage
      ? {
          prompt: json.usage.prompt_tokens ?? 0,
          completion: json.usage.completion_tokens ?? 0,
          total: json.usage.total_tokens ?? 0,
        }
      : null;

    return c.json({
      text,
      tokensUsed: usage,
      model: aiModel,
      durationMs,
      status: res.status,
    });
  } catch (err: any) {
    console.log(`Network error in ask-ai proxy: ${err.message}`);
    return c.json({ error: `Network error: ${err.message}` }, 502);
  }
});

// ─── Ask AI Chat History: GET ────────────────────────────
// Returns saved chat messages for a specific ticket
app.get("/make-server-ab702ee0/ai/chat/:ticketId", async (c) => {
  try {
    const ticketId = c.req.param("ticketId");
    if (!ticketId) {
      return c.json({ error: "Missing ticketId" }, 400);
    }
    const data = await kv.get(`${KV_CHAT_PREFIX}${ticketId}`);
    const messages = data ? (typeof data === "string" ? JSON.parse(data) : data) : [];
    return c.json({ ticketId, messages });
  } catch (err: any) {
    console.log(`Error fetching chat history for ticket: ${err.message}`);
    return c.json({ error: `Failed to load chat history: ${err.message}` }, 500);
  }
});

// ─── Ask AI Chat History: PUT ────────────────────────────
// Saves (overwrites) chat messages for a specific ticket
app.put("/make-server-ab702ee0/ai/chat/:ticketId", async (c) => {
  try {
    const ticketId = c.req.param("ticketId");
    if (!ticketId) {
      return c.json({ error: "Missing ticketId" }, 400);
    }
    const body = await c.req.json();
    const messages = body.messages || [];
    await kv.set(`${KV_CHAT_PREFIX}${ticketId}`, JSON.stringify(messages));
    return c.json({ ticketId, saved: messages.length });
  } catch (err: any) {
    console.log(`Error saving chat history: ${err.message}`);
    return c.json({ error: `Failed to save chat history: ${err.message}` }, 500);
  }
});

// ─── Ask AI Chat History: DELETE ─────────────────────────
// Clears chat messages for a specific ticket
app.delete("/make-server-ab702ee0/ai/chat/:ticketId", async (c) => {
  try {
    const ticketId = c.req.param("ticketId");
    if (!ticketId) {
      return c.json({ error: "Missing ticketId" }, 400);
    }
    await kv.del(`${KV_CHAT_PREFIX}${ticketId}`);
    return c.json({ ticketId, cleared: true });
  } catch (err: any) {
    console.log(`Error clearing chat history: ${err.message}`);
    return c.json({ error: `Failed to clear chat history: ${err.message}` }, 500);
  }
});


// ─── Onboarding Form Data ────────────────────────────────
app.post("/make-server-ab702ee0/onboarding/save", async (c) => {
  try {
    const data = await c.req.json();
    if (!data || typeof data !== 'object') {
      return c.json({ error: 'Invalid data' }, 400);
    }

    // Save each property's form data
    for (const [propId, formData] of Object.entries(data)) {
      await kv.set(`onboarding_form:${propId}`, JSON.stringify(formData));
    }

    return c.json({ ok: true });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

app.get("/make-server-ab702ee0/onboarding/load", async (c) => {
  try {
    // Retrieve all property IDs that have onboarding data stored
    const propIds = c.req.query('propIds');
    if (!propIds) return c.json({ data: {} });

    const ids = propIds.split(',').filter(Boolean);
    const result: Record<string, unknown> = {};
    for (const propId of ids) {
      const raw = await kv.get(`onboarding_form:${propId}`);
      if (raw) {
        try { result[propId] = JSON.parse(raw as string); } catch {}
      }
    }
    return c.json({ data: result });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

Deno.serve(app.fetch);