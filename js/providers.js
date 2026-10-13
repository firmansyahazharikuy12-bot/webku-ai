import { APP_NAME } from "./config.js";
import { latestOnly, prettify } from "./models.js";

const SETTINGS_KEY = "myai_settings";
const DEFAULT_SETTINGS = {
  openrouter: "",
  gemini: "",
  groq: "",
  showPaid: false,
  localModels: false,
  customEndpoint: "",
  customToken: "",
  customModel: "",
  systemPrompt: "Kamu adalah asisten AI yang ramah, cerdas, dan membantu. Jawab dalam bahasa yang dipakai pengguna. Gunakan Markdown untuk format.",
  temperature: 0.7,
};

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (saved && typeof saved === "object" && !Array.isArray(saved)) {
      return { ...DEFAULT_SETTINGS, ...saved };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

async function errorText(res) {
  const raw = await res.text();
  try {
    const j = JSON.parse(raw);
    return `${res.status}: ${j.error?.message || j.message || raw}`;
  } catch {
    return `${res.status}: ${raw.slice(0, 300)}`;
  }
}

async function* readSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const parseLine = (line) => {
    if (!line.startsWith("data:")) return null;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return { done: true };
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buf += decoder.decode();
      break;
    }
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const event = parseLine(line);
      if (event?.done) return;
      if (event) yield event;
    }
  }
  const event = parseLine(buf.trim());
  if (event && !event.done) yield event;
}

// ---------- OpenAI-compatible (OpenRouter, Groq) ----------

async function* openAIStream(url, key, model, messages, opts, signal, extraHeaders = {}) {
  const openAIMessages = messages.map(({ images, ...message }) => images?.length
    ? { ...message, content: [{ type: "text", text: message.content }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] }
    : message);
  const post = (extra) => {
    const headers = { "Content-Type": "application/json", ...extraHeaders };
    if (key) headers.Authorization = `Bearer ${key}`;
    return fetch(url, {
      method: "POST",
      signal,
      headers,
      body: JSON.stringify({
        model,
        messages: openAIMessages,
        stream: true,
        temperature: opts.temperature,
        ...(opts.webSearch && url.includes("openrouter.ai") ? { plugins: [{ id: "web", max_results: opts.researchMode ? 10 : 5 }] } : {}),
        ...extra,
      }),
    });
  };
  let res = await post();
  if (res.status === 429 || res.status === 413) {
    const msg = await errorText(res);
    // Tier gratis Groq membatasi token output per menit; ulangi dengan max_tokens di bawah batas itu.
    const limit = Number(msg.match(/output tokens per minute[^]*?Limit (\d+)/i)?.[1]);
    if (!limit) throw new Error(msg);
    res = await post({ max_tokens: Math.floor(limit * 0.9) });
  }
  if (!res.ok) throw new Error(await errorText(res));
  for await (const j of readSSE(res)) {
    if (j.error) throw new Error(j.error.message || "Error dari server");
    const annotations = j.choices?.[0]?.delta?.annotations || j.choices?.[0]?.message?.annotations || [];
    for (const annotation of annotations) {
      if (annotation.type === "url_citation" && annotation.url_citation?.url) {
        yield { citation: { url: annotation.url_citation.url, title: annotation.url_citation.title } };
      }
    }
    const d = j.choices?.[0]?.delta;
    if (d?.reasoning) yield { reasoning: d.reasoning };
    if (d?.content) yield { content: d.content };
  }
}

async function listOpenRouter() {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error("OpenRouter: " + (await errorText(res)));
  const { data } = await res.json();
  const free = [];
  const paid = [];
  for (const m of data) {
    const out = m.architecture?.output_modalities || ["text"];
    if (out.some((x) => x !== "text") || /safety|guard|:batch/i.test(m.id)) continue;
    const p = Number(m.pricing?.prompt);
    const c = Number(m.pricing?.completion);
    const name = (m.name || m.id).replace(/^[^:]+:\s*/, "").replace(/\s*\(free\)$/i, "");
    const item = { id: m.id, name, created: m.created };
    if (p === 0 && c === 0) free.push(item);
    else if (p > 0) paid.push(item);
  }
  const newestFirst = (a, b) => (b.created || 0) - (a.created || 0);
  return { free: latestOnly(free).sort(newestFirst), paid: latestOnly(paid).sort(newestFirst) };
}

async function listGroq(key) {
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error("Groq: " + (await errorText(res)));
  const { data } = await res.json();
  const models = data
    .filter((m) => !/whisper|tts|guard|playai|orpheus/i.test(m.id))
    .map((m) => ({ id: m.id, name: prettify(m.id) }));
  return latestOnly(models).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- Google Gemini ----------

async function listGemini(key) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error("Gemini: " + (await errorText(res)));
  const { models = [] } = await res.json();
  const list = models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .filter((m) => /gemini|gemma/i.test(m.name) && !/tts|image|embedding|live|native-audio|robotics|computer-use/i.test(m.name))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName || prettify(m.name) }));
  return latestOnly(list).sort((a, b) => b.id.localeCompare(a.id));
}

async function* geminiStream(key, model, messages, opts, signal) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const contents = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        { text: m.content },
        ...(m.images || []).map((image) => {
          const [, mimeType, data] = image.match(/^data:([^;]+);base64,(.+)$/) || [];
          if (!mimeType || !data) throw new Error("Format gambar tidak valid.");
          return { inlineData: { mimeType, data } };
        }),
      ],
    }));
  const body = {
    contents,
    generationConfig: { temperature: opts.temperature },
    ...(opts.webSearch ? { tools: [{ googleSearch: {} }] } : {}),
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const cited = new Set();
  for await (const j of readSSE(res)) {
    for (const part of j.candidates?.[0]?.content?.parts || []) {
      if (!part.text) continue;
      if (part.thought) yield { reasoning: part.text };
      else yield { content: part.text };
    }
    for (const source of j.candidates?.[0]?.groundingMetadata?.groundingChunks || []) {
      if (source.web?.uri && !cited.has(source.web.uri)) {
        cited.add(source.web.uri);
        yield { citation: { url: source.web.uri, title: source.web.title } };
      }
    }
  }
}

async function* geminiImageStream(key, messages, opts, signal) {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
  const contents = messages.filter((message) => message.role !== "system").map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [
      { text: message.content },
      ...(message.images || []).map((image) => {
        const [, mimeType, data] = image.match(/^data:([^;]+);base64,(.+)$/) || [];
        if (!mimeType || !data) throw new Error("Format gambar referensi tidak valid.");
        return { inlineData: { mimeType, data } };
      }),
    ],
  }));
  const body = {
    contents,
    generationConfig: {
      temperature: opts.temperature,
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
    },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image:generateContent?key=" + encodeURIComponent(key), {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorText(res));
  const result = await res.json();
  let hasImage = false;
  for (const part of result.candidates?.[0]?.content?.parts || []) {
    if (part.text) yield { content: part.text };
    if (part.inlineData?.data) {
      hasImage = true;
      yield { image: `data:${part.inlineData.mimeType || "image/png"};base64,${part.inlineData.data}` };
    }
  }
  if (!hasImage) throw new Error("Gemini tidak mengembalikan gambar. Coba ubah prompt atau periksa akses model image.");
}

// ---------- Lokal di browser (WebLLM / WebGPU) ----------

let webllm = null;
let engine = null;
let loadedModel = null;

async function getWebLLM() {
  webllm ??= await import("https://esm.run/@mlc-ai/web-llm");
  return webllm;
}

const LOCAL_PRIORITY = ["qwen", "deepseek", "llama", "gemma", "phi", "mistral", "smollm"];
const LOCAL_EXCLUDE = /embed|hermes|wizard|redpajama|tinyllama|stablelm|jpn|-base-|^phi-1|^phi-2|-1k$/i;
const QUANT_PREF = ["q4f16_1", "q4f32_1", "q0f16", "q0f32"];

async function listLocal() {
  const w = await getWebLLM();
  const rank = (id) => {
    const i = LOCAL_PRIORITY.findIndex((k) => id.toLowerCase().startsWith(k));
    return i < 0 ? LOCAL_PRIORITY.length : i;
  };
  const series = (name) => name.replace(/\s+[AE]?\d+(\.\d+)?[BMT]\b.*$/i, "");
  const quantRank = (id) => {
    const i = QUANT_PREF.findIndex((q) => id.includes(`-${q}-`));
    return i < 0 ? QUANT_PREF.length : i;
  };
  // Satu model bisa punya beberapa varian kuantisasi; ambil yang paling ringan & umum.
  const byBase = new Map();
  for (const m of w.prebuiltAppConfig.model_list) {
    if (LOCAL_EXCLUDE.test(m.model_id)) continue;
    const base = m.model_id.replace(/-q\d+f\d+(_\d+)?-MLC.*$/i, "");
    const cur = byBase.get(base);
    if (!cur || quantRank(m.model_id) < quantRank(cur.model_id)) byBase.set(base, m);
  }
  const list = [...byBase.values()].map((m) => ({
    id: m.model_id,
    name: prettify(m.model_id),
    info: m.vram_required_MB ? `~${(m.vram_required_MB / 1024).toFixed(1)} GB VRAM` : "",
    vram: m.vram_required_MB || 0,
  }));
  return latestOnly(list).sort(
    (a, b) =>
      rank(a.id) - rank(b.id) ||
      series(b.name).localeCompare(series(a.name), undefined, { numeric: true }) ||
      a.vram - b.vram
  );
}

async function* localStream(model, messages, opts, signal) {
  if (messages.some((message) => message.images?.length)) {
    throw new Error("Model lokal ini belum mendukung analisis gambar. Pilih model vision dari Gemini atau OpenRouter.");
  }
  if (!navigator.gpu) {
    throw new Error("Browser ini belum mendukung WebGPU. Gunakan Chrome/Edge terbaru di laptop/PC, atau pilih model API (Gemini/Groq/OpenRouter).");
  }
  const w = await getWebLLM();
  if (!engine) {
    engine = await w.CreateMLCEngine(model, { initProgressCallback: opts.onProgress });
    loadedModel = model;
  } else if (loadedModel !== model) {
    engine.setInitProgressCallback(opts.onProgress);
    await engine.reload(model);
    loadedModel = model;
  }
  const chunks = await engine.chat.completions.create({ messages, stream: true, temperature: opts.temperature });
  for await (const c of chunks) {
    if (signal.aborted) {
      engine.interruptGenerate();
      break;
    }
    const t = c.choices?.[0]?.delta?.content;
    if (t) yield { content: t };
  }
}

// ---------- API publik ----------

export async function listAllModels(s) {
  const tasks = [];
  if (s.gemini) {
    tasks.push(listGemini(s.gemini).then((models) => [{ provider: "gemini", label: "Google Gemini", tag: "Gratis", models }]));
  }
  if (s.groq) {
    tasks.push(listGroq(s.groq).then((models) => [{ provider: "groq", label: "Groq", tag: "Gratis · super cepat", models }]));
  }
  if (s.openrouter) {
    tasks.push(
      listOpenRouter().then(({ free, paid }) => [
        { provider: "openrouter", label: "OpenRouter Gratis", tag: "Gratis", models: free },
        ...(s.showPaid ? [{ provider: "openrouter", label: "OpenRouter Premium", tag: "Butuh kredit", models: paid }] : []),
      ])
    );
  }
  if (s.customEndpoint && s.customModel) {
    tasks.push(Promise.resolve([{ provider: "custom", label: "Colab / OpenAI-compatible", tag: "Endpoint sendiri", models: [{ id: s.customModel, name: s.customModel }] }]));
  }
  if (s.localModels) {
    tasks.push(listLocal().then((models) => [{ provider: "local", label: "Lokal di browser", tag: "Offline · 100% gratis", models }]));
  }

  const results = await Promise.allSettled(tasks);
  const groups = [];
  const errors = [];
  for (const r of results) {
    if (r.status === "fulfilled") groups.push(...r.value.filter((g) => g.models.length));
    else errors.push(r.reason?.message || String(r.reason));
  }
  return { groups, errors };
}

export function streamChat(provider, model, messages, opts, signal) {
  const s = opts.settings;
  if (opts.imageGeneration) return geminiImageStream(s.gemini, messages, opts, signal);
  switch (provider) {
    case "openrouter":
      return openAIStream("https://openrouter.ai/api/v1/chat/completions", s.openrouter, model, messages, opts, signal, {
        "HTTP-Referer": location.origin,
        "X-Title": APP_NAME,
      });
    case "groq":
      return openAIStream("https://api.groq.com/openai/v1/chat/completions", s.groq, model, messages, opts, signal);
    case "custom": {
      const endpoint = new URL(s.customEndpoint);
      if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname))) {
        throw new Error("Endpoint harus memakai HTTPS (HTTP hanya diizinkan untuk localhost).");
      }
      endpoint.pathname = endpoint.pathname.replace(/\/+$/, "");
      if (!endpoint.pathname.endsWith("/chat/completions")) {
        endpoint.pathname += endpoint.pathname.endsWith("/v1") ? "/chat/completions" : "/v1/chat/completions";
      }
      return openAIStream(endpoint.href, s.customToken, s.customModel || model, messages, opts, signal);
    }
    case "gemini":
      return geminiStream(s.gemini, model, messages, opts, signal);
    case "local":
      return localStream(model, messages, opts, signal);
    default:
      throw new Error("Provider tidak dikenal: " + provider);
  }
}
