import { APP_NAME, APP_VERSION } from "./config.js";
import {
  firebaseEnabled,
  initFirebase,
  signIn,
  signOutUser,
  listChats,
  saveChat,
  deleteChat,
  loadCloudSettings,
  saveCloudSettings,
} from "./db.js";
import { loadSettings, saveSettings, listAllModels, streamChat } from "./providers.js";
import { brandOf } from "./models.js";

const $ = (id) => document.getElementById(id);
const MODEL_KEY = "myai_model";

let settings = loadSettings();
let currentUser = null;
let chats = [];
let chat = newChat();
let abort = null;
let pendingFiles = [];
let composerMode = "";
const generatedImages = new Map();

let modelGroups = [];
let models = new Map();
let selected = "";
let modelsToken = 0;

const SUGGESTIONS = [
  "Jelaskan cara kerja Transformer (attention) dengan bahasa sederhana",
  "Buatkan kode Python untuk scraping judul berita",
  "Bantu aku belajar JavaScript dari nol, buat rencana 30 hari",
  "Apa beda Qwen, DeepSeek, Gemini, Claude, dan GPT?",
];
const BRAND_STRIP = ["qwen", "deepseek", "gemini", "claude", "gpt", "llama", "mistral", "grok", "kimi", "gemma"];

function newChat() {
  return { id: crypto.randomUUID(), title: "Chat baru", messages: [], updatedAt: Date.now() };
}

// ---------- Logo ----------

function logoEl(text, label, small = false) {
  const span = document.createElement("span");
  span.className = "mlogo" + (small ? " sm" : "");
  const brand = brandOf(text);
  const fallback = () => (span.textContent = (label || "?").trim()[0].toUpperCase());
  if (!brand) {
    fallback();
    return span;
  }
  const img = new Image();
  img.src = brand.src;
  img.alt = "";
  img.loading = "lazy";
  if (brand.mono) img.className = "mono";
  img.onerror = () => {
    img.remove();
    fallback();
  };
  span.append(img);
  return span;
}

// ---------- Rendering ----------

const md = (s) => DOMPurify.sanitize(marked.parse(s || ""));

function renderContent(m) {
  let think = m.reasoning || "";
  const text = (m.content || "").replace(/<think>([\s\S]*?)(?:<\/think>|$)/g, (_, t) => {
    think += t;
    return "";
  });
  let html = "";
  if (think.trim()) html += `<details class="think"><summary>Proses berpikir</summary>${md(think)}</details>`;
  html += md(text);
  return html;
}

function appendCitations(body, citations = []) {
  const unique = [...new Map(citations.filter((item) => /^https?:\/\//i.test(item.url)).map((item) => [item.url, item])).values()];
  if (!unique.length) return;
  const section = document.createElement("section");
  section.className = "citations";
  const title = document.createElement("strong");
  title.textContent = "Sumber";
  const list = document.createElement("ul");
  for (const citation of unique) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = new URL(citation.url).href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = citation.title || new URL(citation.url).hostname;
    item.append(link);
    list.append(item);
  }
  section.append(title, list);
  body.append(section);
}

function enhance(body) {
  body.querySelectorAll("pre code").forEach((code) => {
    if (window.hljs) hljs.highlightElement(code);
    const btn = document.createElement("button");
    btn.className = "copy-btn";
    btn.type = "button";
    btn.textContent = "Salin";
    btn.onclick = async () => {
      await navigator.clipboard.writeText(code.innerText);
      btn.textContent = "Tersalin!";
      setTimeout(() => (btn.textContent = "Salin"), 1500);
    };
    code.parentElement.append(btn);
  });
}

function bubble(m) {
  const el = document.createElement("div");
  el.className = `msg ${m.role}${m.error ? " error" : ""}`;
  if (m.role === "assistant" && m.model) {
    const label = document.createElement("div");
    label.className = "label";
    const name = document.createElement("span");
    name.textContent = m.model;
    label.append(logoEl(`${m.modelId || ""} ${m.model}`, m.model, true), name);
    el.append(label);
  }
  const body = document.createElement("div");
  body.className = "body";
  if (m.role === "user") body.textContent = m.content;
  else {
    body.innerHTML = renderContent(m);
    appendCitations(body, m.citations);
    enhance(body);
  }
  el.append(body);
  appendGeneratedImages(body, m.id);
  return el;
}

function appendGeneratedImages(body, messageId) {
  for (const [index, src] of (generatedImages.get(messageId) || []).entries()) {
    const image = document.createElement("img");
    image.className = "generated-image";
    image.src = src;
    image.alt = `Gambar hasil ${index + 1}`;
    const download = document.createElement("a");
    download.className = "btn small";
    download.href = src;
    download.download = `myai-image-${index + 1}.png`;
    download.textContent = "Unduh gambar";
    body.append(image, download);
  }
}

function renderWelcome() {
  const wrap = document.createElement("div");
  wrap.className = "welcome";
  wrap.innerHTML = `<img src="assets/logo.svg" alt="" class="welcome-logo" /><h1>Halo! Aku <span class="brand-name"></span></h1><p class="muted">Asisten AI pribadimu — ditenagai model-model terbaru dunia.</p>`;
  wrap.querySelector(".brand-name").textContent = APP_NAME;

  const strip = document.createElement("div");
  strip.className = "brand-strip";
  for (const b of BRAND_STRIP) strip.append(logoEl(b, b));
  wrap.append(strip);

  const grid = document.createElement("div");
  grid.className = "suggestions";
  for (const s of SUGGESTIONS) {
    const b = document.createElement("button");
    b.className = "suggestion";
    b.textContent = s;
    b.onclick = () => send(s);
    grid.append(b);
  }
  wrap.append(grid);

  if (!settings.gemini && !settings.groq && !settings.openrouter && !(settings.customEndpoint && settings.customModel) && !settings.localModels) {
    const n = document.createElement("div");
    n.className = "notice";
    n.textContent = "Belum ada penyedia AI yang terhubung. API perlu dikonfigurasi melalui backend yang aman sebelum model online dapat digunakan.";
    wrap.append(n);
  }
  $("messages").append(wrap);
}

function renderMessages() {
  $("messages").innerHTML = "";
  if (!chat.messages.length) renderWelcome();
  else for (const m of chat.messages) $("messages").append(bubble(m));
  scrollBottom();
}

function scrollBottom() {
  const box = $("messages");
  box.scrollTop = box.scrollHeight;
}

function renderChatList() {
  const list = $("chatList");
  list.innerHTML = "";
  for (const c of chats) {
    const item = document.createElement("div");
    item.className = "chat-item" + (c.id === chat.id ? " active" : "");
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = c.title;
    const del = document.createElement("button");
    del.className = "del";
    del.title = "Hapus";
    del.textContent = "✕";
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Hapus chat "${c.title}"?`)) return;
      await deleteChat(c.id);
      chats = chats.filter((x) => x.id !== c.id);
      if (c.id === chat.id) chat = newChat();
      renderChatList();
      renderMessages();
    };
    item.append(title, del);
    item.onclick = () => {
      if (abort) return;
      chat = structuredClone(c);
      renderChatList();
      renderMessages();
      closeSidebar();
    };
    list.append(item);
  }
}

function renderAccount(user) {
  const box = $("account");
  box.innerHTML = "";
  if (!firebaseEnabled) {
    box.textContent = "Mode lokal (Firebase belum disetel)";
    return;
  }
  if (!user) {
    const btn = document.createElement("button");
    btn.className = "btn block";
    btn.textContent = "Masuk dengan Google";
    btn.onclick = async () => {
      try {
        await signIn();
      } catch (e) {
        if (/popup-closed-by-user|cancelled-popup-request|cancelled/.test(e.code || e.message)) return;
        toast("Gagal masuk: " + e.message);
      }
    };
    box.append(btn);
    return;
  }
  if (user.photoURL) {
    const img = document.createElement("img");
    img.src = user.photoURL;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    box.append(img);
  }
  const name = document.createElement("span");
  name.className = "name";
  name.textContent = user.displayName || user.email;
  const out = document.createElement("button");
  out.className = "btn small ghost";
  out.textContent = "Keluar";
  out.onclick = () => signOutUser();
  box.append(name, out);
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 6000);
}

// ---------- Pemilih model ----------

function updateModelBtn() {
  const m = models.get(selected);
  const logo = $("modelBtnLogo");
  if (!m) {
    logo.replaceWith(Object.assign(document.createElement("span"), { id: "modelBtnLogo", className: "mlogo", textContent: "?" }));
    $("modelBtnName").textContent = modelGroups.length ? "Pilih model" : "Belum ada model — buka Pengaturan";
    $("modelBtnSub").textContent = "";
    return;
  }
  const el = logoEl(`${m.id} ${m.name}`, m.name);
  el.id = "modelBtnLogo";
  logo.replaceWith(el);
  $("modelBtnName").textContent = m.name;
  $("modelBtnSub").textContent = [m.groupLabel, m.info || m.tag].filter(Boolean).join(" · ");
}

function renderModelList() {
  const q = $("modelSearch").value.trim().toLowerCase();
  const list = $("modelList");
  list.innerHTML = "";
  let count = 0;
  for (const g of modelGroups) {
    const items = g.models.filter((m) => !q || `${m.name} ${m.id} ${g.label}`.toLowerCase().includes(q));
    if (!items.length) continue;
    const head = document.createElement("div");
    head.className = "model-group-head";
    head.textContent = g.label;
    const tag = document.createElement("span");
    tag.textContent = `${g.tag} · ${items.length} model`;
    head.append(tag);
    list.append(head);
    for (const m of items) {
      const value = `${g.provider}::${m.id}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "model-item" + (value === selected ? " selected" : "");
      btn.setAttribute("role", "option");
      btn.dataset.value = value;
      const text = document.createElement("span");
      text.className = "mi-text";
      const name = document.createElement("span");
      name.className = "mi-name";
      name.textContent = m.name;
      const sub = document.createElement("span");
      sub.className = "mi-sub";
      sub.textContent = m.info || m.id;
      text.append(name, sub);
      btn.append(logoEl(`${m.id} ${m.name}`, m.name), text);
      btn.onclick = () => selectModel(value);
      list.append(btn);
      count++;
    }
  }
  if (!count) {
    const empty = document.createElement("div");
    empty.className = "model-empty";
    empty.textContent = modelGroups.length ? "Model tidak ditemukan." : "Belum ada model. Isi API key di ⚙ Pengaturan.";
    list.append(empty);
  }
}

function selectModel(value) {
  selected = value;
  localStorage.setItem(MODEL_KEY, value);
  updateModelBtn();
  closeModelMenu();
}

function openModelMenu() {
  $("modelMenu").classList.remove("hidden");
  $("modelBtn").setAttribute("aria-expanded", "true");
  $("modelSearch").value = "";
  renderModelList();
  $("modelList").querySelector(".selected")?.scrollIntoView({ block: "center" });
  $("modelSearch").focus();
}

function closeModelMenu() {
  $("modelMenu").classList.add("hidden");
  $("modelBtn").setAttribute("aria-expanded", "false");
}

async function loadModels() {
  const token = ++modelsToken;
  $("modelBtnName").textContent = "Memuat model…";
  const { groups, errors } = await listAllModels(settings);
  if (token !== modelsToken) return;
  modelGroups = groups;
  models = new Map();
  for (const g of groups) {
    for (const m of g.models) models.set(`${g.provider}::${m.id}`, { ...m, provider: g.provider, groupLabel: g.label, tag: g.tag });
  }
  const saved = localStorage.getItem(MODEL_KEY);
  selected = models.has(selected) ? selected : models.has(saved) ? saved : models.keys().next().value || "";
  updateModelBtn();
  if (!$("modelMenu").classList.contains("hidden")) renderModelList();
  if (errors.length) toast("Sebagian model gagal dimuat: " + errors.join(" | "));
}

// ---------- Chat ----------

function showProgress(report) {
  $("progress").classList.remove("hidden");
  $("progressFill").style.width = `${Math.round((report.progress || 0) * 100)}%`;
  $("progressText").textContent = report.text || "Memuat model…";
}

function setBusy(busy) {
  const btn = $("sendBtn");
  btn.textContent = busy ? "Stop" : "Kirim";
  btn.classList.toggle("danger", busy);
  btn.classList.toggle("primary", !busy);
}

function setComposerMode(mode) {
  composerMode = mode;
  $("modeStatus").classList.toggle("hidden", !mode);
  $("modeLabel").textContent = mode === "image"
    ? "Gemini Image dapat memakai kuota atau biaya. Unduh hasil untuk menyimpannya sebelum tab ditutup."
    : mode === "research"
      ? "Riset web aktif. Biaya pencarian dapat berlaku."
      : mode === "web"
        ? "Pencarian web aktif. Biaya pencarian dapat berlaku."
        : "";
}

async function persist() {
  chat.updatedAt = Date.now();
  try {
    await saveChat(chat);
  } catch (e) {
    toast("Gagal menyimpan chat: " + e.message);
  }
  chats = [structuredClone(chat), ...chats.filter((c) => c.id !== chat.id)];
  renderChatList();
}

async function send(text) {
  text = text.trim();
  if ((!text && !pendingFiles.length) || abort) return;
  const submittedText = text;
  const filesForMessage = pendingFiles.slice();
  const fileContext = filesForMessage.map(f => `\n\n[File: ${f.name}]\n${f.content}`).join("");
  text = (text || "Tolong analisis file yang saya lampirkan.") + fileContext;
  const m = models.get(selected);
  if (!m) {
    toast("Pilih model dulu. Isi API key di ⚙ Pengaturan jika daftar kosong.");
    return;
  }
  const requestMode = composerMode;
  const webSearch = requestMode === "web" || requestMode === "research";
  const imageGeneration = requestMode === "image";
  if (imageGeneration && !settings.gemini) {
    toast("Buat gambar memerlukan Gemini API key di Pengaturan.");
    return;
  }
  if (!imageGeneration && m.provider === "local" && filesForMessage.some((file) => file.images?.length)) {
    toast("Lampiran gambar memerlukan model vision dari Gemini atau OpenRouter. Lampiran tetap menunggu di composer.");
    return;
  }
  if (webSearch && (m.provider === "local" || m.provider === "custom" || (m.provider === "gemini" && !/gemini/i.test(m.id)) || (m.provider === "groq" && !/compound/i.test(m.id)))) {
    toast("Pencarian web membutuhkan model Gemini, OpenRouter, atau Groq Compound.");
    return;
  }
  const input = $("input");
  if (input.value.trim() === submittedText) {
    input.value = "";
    input.style.height = "auto";
  }

  const context = [];
  if (settings.systemPrompt) context.push({ role: "system", content: settings.systemPrompt });
  for (const msg of chat.messages) {
    if (msg.error) continue;
    context.push({ role: msg.role, content: msg.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() });
  }
  const images = filesForMessage.flatMap((file) => file.images || []);
  context.push({ role: "user", content: text, ...(images.length ? { images } : {}) });
  setComposerMode("");

  if (!chat.messages.length) chat.title = text.slice(0, 48);
  chat.messages.push({ role: "user", content: text });
  pendingFiles = [];
  renderAttachmentList();
  const reply = { id: crypto.randomUUID(), role: "assistant", content: "", reasoning: "", model: imageGeneration ? "Gemini Image" : m.name, modelId: m.id };
  chat.messages.push(reply);
  renderMessages();

  const body = $("messages").lastElementChild.querySelector(".body");
  body.innerHTML = '<span class="typing"></span>';

  abort = new AbortController();
  setBusy(true);
  let frame = 0;
  try {
    const stream = streamChat(m.provider, m.id, context, {
      settings,
      temperature: Number(settings.temperature),
      onProgress: showProgress,
      webSearch,
      researchMode: requestMode === "research",
      imageGeneration,
    }, abort.signal);
    for await (const chunk of stream) {
      $("progress").classList.add("hidden");
      if (chunk.content) reply.content += chunk.content;
      if (chunk.reasoning) reply.reasoning += chunk.reasoning;
      if (chunk.citation) (reply.citations ||= []).push(chunk.citation);
      if (chunk.image) generatedImages.set(reply.id, [...(generatedImages.get(reply.id) || []), chunk.image]);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        body.innerHTML = renderContent(reply) + '<span class="typing"></span>';
        scrollBottom();
      });
    }
  } catch (e) {
    if (e.name !== "AbortError") {
      reply.error = true;
      reply.content += `\n\n**Error:** ${e.message}`;
    }
  } finally {
    cancelAnimationFrame(frame);
    abort = null;
    setBusy(false);
    $("progress").classList.add("hidden");
    if (!reply.content && !reply.reasoning) reply.content = "_(dihentikan)_";
    body.innerHTML = renderContent(reply);
    appendCitations(body, reply.citations);
    appendGeneratedImages(body, reply.id);
    body.parentElement.classList.toggle("error", !!reply.error);
    enhance(body);
    scrollBottom();
    await persist();
  }
}

// ---------- Pengaturan ----------

function openSettings() {
  const f = $("settingsForm");
  f.gemini.value = settings.gemini;
  f.groq.value = settings.groq;
  f.openrouter.value = settings.openrouter;
  f.customEndpoint.value = settings.customEndpoint || "";
  f.customToken.value = settings.customToken || "";
  f.customModel.value = settings.customModel || "";
  f.showPaid.checked = settings.showPaid;
  f.localModels.checked = Boolean(settings.localModels);
  f.systemPrompt.value = settings.systemPrompt;
  f.temperature.value = settings.temperature;
  $("tempValue").textContent = settings.temperature;
  $("syncNote").textContent = currentUser
    ? `Tersinkron ke akun ${currentUser.email}. API key aman: hanya akunmu yang bisa membacanya.`
    : "API key tersimpan di browser ini dan bisa diperbarui kapan saja. Data browser dapat hilang jika data situs dihapus. Jangan gunakan key yang sudah terlanjur dibagikan; buat key baru terlebih dahulu.";
  $("settingsDialog").showModal();
}

function onSettingsSubmit(e) {
  e.preventDefault();
  $("settingsDialog").close();
  const f = $("settingsForm");
  settings = {
    gemini: f.gemini.value.trim(),
    groq: f.groq.value.trim(),
    openrouter: f.openrouter.value.trim(),
    customEndpoint: f.customEndpoint.value.trim(),
    customToken: f.customToken.value.trim(),
    customModel: f.customModel.value.trim(),
    showPaid: f.showPaid.checked,
    localModels: f.localModels.checked,
    systemPrompt: f.systemPrompt.value,
    temperature: Number(f.temperature.value),
  };
  saveSettings(settings);
  if (currentUser) saveCloudSettings(settings).catch((err) => toast("Gagal sinkron ke akun: " + err.message));
  loadModels();
  if (!chat.messages.length) renderMessages();
}

async function testCustomEndpoint() {
  const form = $("settingsForm");
  const button = $("testCustomEndpoint");
  if (!form.customEndpoint.value.trim()) {
    toast("Isi URL endpoint Colab dulu.");
    return;
  }
  button.disabled = true;
  button.textContent = "Menguji…";
  try {
    const endpoint = new URL(form.customEndpoint.value.trim());
    if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname))) {
      throw new Error("Endpoint harus memakai HTTPS; HTTP hanya diizinkan untuk localhost.");
    }
    endpoint.pathname = endpoint.pathname.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
    if (!endpoint.pathname.endsWith("/models")) {
      endpoint.pathname += endpoint.pathname.endsWith("/v1") ? "/models" : "/v1/models";
    }
    const headers = {};
    if (form.customToken.value.trim()) headers.Authorization = `Bearer ${form.customToken.value.trim()}`;
    const response = await fetch(endpoint.href, { headers });
    if (!response.ok) throw new Error(`Server menjawab HTTP ${response.status}. Periksa token dan alamat endpoint.`);
    const result = await response.json();
    const available = (result.data || []).map((model) => model.id);
    const expected = form.customModel.value.trim();
    if (expected && available.length && !available.includes(expected)) {
      toast(`Server terhubung, tetapi model "${expected}" tidak ada di daftar server.`);
    } else {
      toast("Server terhubung. Tekan Simpan untuk memakai model ini.");
    }
  } catch (error) {
    const message = error instanceof TypeError
      ? "Browser gagal mengakses server. Periksa URL HTTPS, tunnel aktif, CORS, dan token."
      : error.message;
    toast("Uji koneksi gagal: " + message);
  } finally {
    button.disabled = false;
    button.textContent = "Uji koneksi";
  }
}

// Saat login: ambil pengaturan dari akun; kalau akun belum punya, unggah pengaturan lokal.
async function syncSettings() {
  try {
    const cloud = await loadCloudSettings();
    if (cloud) {
      const { updatedAt, ...rest } = cloud;
      settings = { ...settings, ...rest };
      saveSettings(settings);
      toast("Pengaturan dan API key dimuat dari akunmu.");
      return true;
    }
    if (settings.gemini || settings.groq || settings.openrouter) await saveCloudSettings(settings);
  } catch (e) {
    toast("Gagal sinkron pengaturan: " + e.message);
  }
  return false;
}

// ---------- Sidebar (mobile) ----------

function closeSidebar() {
  $("sidebar").classList.remove("open");
  $("backdrop").classList.remove("show");
}

// ---------- Init ----------

function applyTheme(theme) {
  const chosen = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = chosen;
  localStorage.setItem("myai_theme", chosen);
  const label = chosen === "dark" ? "☀️" : "🌙";
  ["themeToggle", "landingTheme"].forEach((id) => {
    const el = $(id);
    if (el) { el.textContent = label; el.title = chosen === "dark" ? "Aktifkan tema terang" : "Aktifkan tema gelap"; }
  });
}

function enterApp() {
  $("landing").classList.add("hidden");
  if ($("loginDialog").open) $("loginDialog").close();
}

async function handleGoogleLogin() {
  if (!firebaseEnabled) {
    $("loginError").textContent = "Firebase belum dikonfigurasi. Periksa js/config.js.";
    $("loginError").classList.remove("hidden");
    return;
  }
  try {
    await signIn();
    enterApp();
  } catch (e) {
    if (/popup-closed-by-user|cancelled-popup-request|cancelled/.test(e.code || e.message)) return;
    $("loginError").textContent = "Gagal masuk: " + (e.message || "Coba lagi.");
    $("loginError").classList.remove("hidden");
  }
}

async function readUploadedFile(file) {
  const maxBytes = 8 * 1024 * 1024;
  if (file.size > maxBytes) throw new Error(`${file.name}: ukuran maksimal 8 MB.`);
  const ext = file.name.split(".").pop().toLowerCase();
  if (["docx", "xlsx", "pptx"].includes(ext)) {
    const JSZip = (await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
    const archive = await JSZip.loadAsync(await file.arrayBuffer());
    const readXml = async (path) => {
      const entry = archive.file(path);
      return entry ? new DOMParser().parseFromString(await entry.async("text"), "application/xml") : null;
    };
    const textNodes = (xml, tag) => [...(xml?.getElementsByTagNameNS("*", tag) || [])].map((node) => node.textContent).join("");
    let content = "";
    if (ext === "docx") {
      const xml = await readXml("word/document.xml");
      content = [...(xml?.getElementsByTagNameNS("*", "p") || [])]
        .map((paragraph) => textNodes(paragraph, "t"))
        .filter(Boolean)
        .join("\n");
    } else if (ext === "pptx") {
      const slides = Object.keys(archive.files)
        .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
        .sort((leftPath, rightPath) => Number(leftPath.match(/slide(\d+)/)[1]) - Number(rightPath.match(/slide(\d+)/)[1]));
      for (const path of slides.slice(0, 100)) {
        const xml = await readXml(path);
        const paragraphs = [...(xml?.getElementsByTagNameNS("*", "p") || [])]
          .map((paragraph) => textNodes(paragraph, "t"))
          .filter(Boolean);
        content += `\n[${path.split("/").pop()}]\n${paragraphs.join("\n")}`;
      }
    } else {
      const sharedXml = await readXml("xl/sharedStrings.xml");
      const shared = [...(sharedXml?.getElementsByTagNameNS("*", "si") || [])]
        .map((item) => textNodes(item, "t"));
      const sheets = Object.keys(archive.files).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).sort();
      for (const path of sheets) {
        const xml = await readXml(path);
        const rows = [...(xml?.getElementsByTagNameNS("*", "row") || [])].map((row) =>
          [...row.getElementsByTagNameNS("*", "c")].map((cell) => {
            const value = cell.getElementsByTagNameNS("*", "v")[0]?.textContent || textNodes(cell, "t");
            return cell.getAttribute("t") === "s" ? shared[Number(value)] || "" : value;
          }).join("\t")
        );
        content += `\n[Lembar ${path.split("/").pop()}]\n${rows.join("\n")}`;
      }
    }
    if (!content.trim()) throw new Error(`${file.name}: tidak ada teks yang dapat dibaca.`);
    return { name: file.name, content: content.slice(0, 100000) };
  }
  if (ext === "zip") {
    const JSZip = (await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
    const archive = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = Object.values(archive.files).filter(x => !x.dir && !x.name.startsWith("__MACOSX/") && !x.name.split("/").some(part => part.startsWith(".")));
    if (!entries.length) throw new Error(`${file.name}: ZIP tidak berisi file yang bisa dibaca.`);
    const results = [];
    for (const entry of entries.slice(0, 40)) {
      const ext = entry.name.split(".").pop().toLowerCase();
      const supported = ["txt","md","csv","json","html","htm","xml","js","ts","jsx","tsx","css","py","java","c","cpp","h","sql","yaml","yml","log","docx","xlsx","pptx"];
      if (supported.includes(ext) || ext === "pdf") {
        const blob = await entry.async("blob");
        const nested = new File([blob], entry.name.split("/").pop(), { type: ext === "pdf" ? "application/pdf" : "text/plain" });
        try { const parsed = await readUploadedFile(nested); results.push(`[Isi arsip: ${entry.name}]\n${parsed.content}`); } catch {}
      }
    }
    if (!results.length) throw new Error(`${file.name}: ZIP terbaca, tetapi tidak ditemukan dokumen teks/PDF yang didukung.`);
    return { name: file.name, content: results.join("\n\n").slice(0, 100000) };
  }
  if (/^(png|jpe?g|gif|webp|bmp)$/i.test(ext)) {
    const image = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(`${file.name}: gambar gagal dibaca.`));
      reader.readAsDataURL(file);
    });
    return { name: file.name, content: "[Gambar dilampirkan untuk dianalisis.]", images: [image] };
  }
  if (ext === "pdf") {
    const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let content = "";
    for (let n = 1; n <= Math.min(doc.numPages, 40); n++) {
      const page = await doc.getPage(n);
      const data = await page.getTextContent();
      content += `\n[Halaman ${n}] ` + data.items.map(x => x.str).join(" ");
    }
    return { name: file.name, content: content.slice(0, 100000) };
  }
  const content = await file.text();
  if (content.includes("\u0000")) throw new Error(`${file.name}: format biner ini belum didukung.`);
  return { name: file.name, content: content.slice(0, 100000) };
}

function renderAttachmentList() {
  const wrap = $("attachmentList");
  if (!wrap) return;
  wrap.replaceChildren();
  wrap.classList.toggle("hidden", pendingFiles.length === 0);
  pendingFiles.forEach((file, index) => {
    const chip = document.createElement("div");
    chip.className = "attachment-chip";
    const name = document.createElement("span");
    name.textContent = `📄 ${file.name}`;
    const remove = document.createElement("button");
    remove.type = "button"; remove.textContent = "×"; remove.title = "Hapus lampiran";
    remove.onclick = () => { pendingFiles.splice(index, 1); renderAttachmentList(); };
    chip.append(name, remove); wrap.append(chip);
  });
}

function readFileLibrary() {
  try {
    const files = JSON.parse(localStorage.getItem("myai_file_library") || "[]");
    return Array.isArray(files) ? files : [];
  } catch {
    return [];
  }
}

function bindEvents() {
  applyTheme(localStorage.getItem("myai_theme") || "dark");
  $("themeToggle").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  $("landingTheme").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
  $("landingLogin").onclick = () => {
    $("loginError").classList.add("hidden");
    $("loginDialog").showModal();
  };
  $("loginGoogle").onclick = handleGoogleLogin;
  $("loginGuest").onclick = enterApp;
  $("landingGuest").onclick = enterApp;
  $("closeLogin").onclick = () => $("loginDialog").close();
  const uploadDialog = $("uploadDialog");
  $("closeUpload").onclick = () => uploadDialog.close();
  $("settingsBtn").onclick = openSettings;
  $("closeSettings").onclick = () => $("settingsDialog").close();
  $("cancelSettings").onclick = () => $("settingsDialog").close();
  $("testCustomEndpoint").onclick = testCustomEndpoint;
  $("settingsForm").addEventListener("submit", onSettingsSubmit);
  $("settingsForm").temperature.addEventListener("input", (event) => {
    $("tempValue").textContent = event.target.value;
  });

  const input = $("input");
  const attachMenu = $("attachMenu");
  $("attachBtn").onclick = (event) => {
    event.stopPropagation();
    attachMenu.classList.toggle("hidden");
  };
  attachMenu.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    attachMenu.classList.add("hidden");
    const action = button.dataset.action;
    if (action === "upload") uploadDialog.showModal();
    else if (action === "library") {
      const saved = readFileLibrary();
      if (!saved.length) { toast("Pustaka file masih kosong. File yang dikirim akan disimpan di sini."); return; }
      const choice = prompt("Pilih nomor file dari pustaka:\n" + saved.map((f, i) => `${i + 1}. ${f.name}`).join("\n"));
      const item = saved[Number(choice) - 1];
      if (item) { pendingFiles.push(item); renderAttachmentList(); }
    } else {
      const prompts = {
        image: "Buat gambar berdasarkan deskripsi ini. Jika ada lampiran gambar, gunakan sebagai referensi: ",
        sketch: "Bantu saya merancang sketsa SVG mandiri. Keluarkan kode SVG lengkap di dalam blok kode, lalu jelaskan bentuk dan warnanya. Subjek sketsa:",
        web: "Cari informasi terbaru dari web, utamakan sumber primer, lalu cantumkan tautan sumber. Topik pencarian:",
        research: "Lakukan riset web mendalam. Bandingkan sumber primer dan sekunder, jelaskan tanggal publikasi, rangkum temuan dan ketidakpastian, lalu cantumkan tautan sumber:"
      };
      if (action === "sketch") {
        $("sketchDialog").showModal();
      } else {
        if (["image", "web", "research"].includes(action)) setComposerMode(action);
        input.value = (input.value ? input.value + "\n\n" : "") + prompts[action];
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }
    }
  });
  $("uploadFiles").onclick = () => { uploadDialog.close(); $("fileInput").click(); };
  $("uploadFolder").onclick = () => { uploadDialog.close(); $("folderInput").click(); };
  const sketchDialog = $("sketchDialog");
  const canvas = $("sketchCanvas");
  const context2d = canvas.getContext("2d");
  let drawing = false;
  const clearSketch = () => {
    context2d.fillStyle = "#ffffff";
    context2d.fillRect(0, 0, canvas.width, canvas.height);
  };
  const canvasPoint = (event) => {
    const bounds = canvas.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
  };
  canvas.addEventListener("pointerdown", (event) => {
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const point = canvasPoint(event);
    context2d.beginPath();
    context2d.moveTo(point.x, point.y);
    context2d.lineCap = "round";
    context2d.lineJoin = "round";
    context2d.strokeStyle = $("sketchColor").value;
    context2d.lineWidth = Number($("sketchSize").value) * canvas.width / canvas.getBoundingClientRect().width;
    context2d.lineTo(point.x + 0.1, point.y + 0.1);
    context2d.stroke();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    const point = canvasPoint(event);
    context2d.lineTo(point.x, point.y);
    context2d.stroke();
  });
  canvas.addEventListener("pointerup", () => { drawing = false; });
  canvas.addEventListener("pointercancel", () => { drawing = false; });
  $("clearSketch").onclick = clearSketch;
  $("closeSketch").onclick = () => sketchDialog.close();
  $("cancelSketch").onclick = () => sketchDialog.close();
  $("attachSketch").onclick = () => {
    pendingFiles.push({ name: "Sketsa.png", content: "Sketsa buatan pengguna.", images: [canvas.toDataURL("image/png")] });
    renderAttachmentList();
    sketchDialog.close();
    toast("Sketsa ditambahkan sebagai lampiran.");
  };
  clearSketch();
  $("clearMode").onclick = () => setComposerMode("");
  document.addEventListener("click", (event) => {
    if (!attachMenu.contains(event.target) && event.target !== $("attachBtn")) attachMenu.classList.add("hidden");
  });
  const processFiles = async (fileList) => {
    const files = [...fileList];
    for (const file of files) {
      try {
        const parsed = await readUploadedFile(file);
        pendingFiles.push(parsed);
        toast(`File ditambahkan: ${file.name}`);
      } catch (err) { toast(err.message || "File gagal dibaca."); }
    }
    renderAttachmentList();
    const library = readFileLibrary();
    for (const f of pendingFiles) {
      if (!library.some(x => x.name === f.name)) library.unshift({ name: f.name, content: f.content });
    }
    try {
      localStorage.setItem("myai_file_library", JSON.stringify(library.slice(0, 30)));
    } catch {
      toast("Pustaka file tidak dapat disimpan. Ruang penyimpanan browser mungkin penuh.");
    }
  };
  $("fileInput").addEventListener("change", async (event) => {
    await processFiles(event.target.files);
    event.target.value = "";
  });
  $("folderInput").addEventListener("change", async (event) => {
    await processFiles(event.target.files);
    event.target.value = "";
  });
  const autosize = () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 220) + "px";
  };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("composer").requestSubmit();
    }
  });
  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    if (abort) {
      abort.abort();
      return;
    }
    send(input.value);
  });
  $("newChat").onclick = () => {
    if (abort) return;
    chat = newChat();
    renderChatList();
    renderMessages();
    closeSidebar();
    input.focus();
  };

  $("modelBtn").onclick = () => ($("modelMenu").classList.contains("hidden") ? openModelMenu() : closeModelMenu());
  $("modelSearch").addEventListener("input", renderModelList);
  $("modelSearch").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = $("modelList").querySelector(".model-item");
      if (first) selectModel(first.dataset.value);
    }
  });
  document.addEventListener("click", (e) => {
    if (!$("modelPicker").contains(e.target)) closeModelMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModelMenu();
  });

  $("toggleSidebar").onclick = () => {
    $("sidebar").classList.add("open");
    $("backdrop").classList.add("show");
  };
  $("backdrop").onclick = closeSidebar;
}

async function main() {
  document.title = APP_NAME;
  $("appName").textContent = APP_NAME;
  $("appVersion").textContent = "v" + APP_VERSION;
  bindEvents();
  renderMessages();
  loadModels();
  await initFirebase(async (user) => {
    currentUser = user;
    renderAccount(user);
    if (user) enterApp();
    if (user && (await syncSettings())) loadModels();
    try {
      chats = await listChats();
    } catch (e) {
      chats = [];
      toast("Gagal memuat riwayat: " + e.message);
    }
    chat = newChat();
    renderChatList();
    renderMessages();
  });
}

main().catch((e) => toast("Gagal memulai aplikasi: " + e.message));
