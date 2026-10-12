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
    enhance(body);
  }
  el.append(body);
  return el;
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

  if (!settings.gemini && !settings.groq && !settings.openrouter) {
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
  const filesForMessage = pendingFiles.slice();
  const fileContext = filesForMessage.map(f => `\\n\\n[File: ${f.name}]\\n${f.content}`).join("");
  text = (text || "Tolong analisis file yang saya lampirkan.") + fileContext;
  const m = models.get(selected);
  if (!m) {
    toast("Pilih model dulu. Isi API key di ⚙ Pengaturan jika daftar kosong.");
    return;
  }

  const context = [];
  if (settings.systemPrompt) context.push({ role: "system", content: settings.systemPrompt });
  for (const msg of chat.messages) {
    if (msg.error) continue;
    context.push({ role: msg.role, content: msg.content.replace(/<think>[\s\S]*?<\/think>/g, "").trim() });
  }
  context.push({ role: "user", content: text });

  if (!chat.messages.length) chat.title = text.slice(0, 48);
  chat.messages.push({ role: "user", content: text });
  pendingFiles = [];
  renderAttachmentList();
  const reply = { role: "assistant", content: "", reasoning: "", model: m.name, modelId: m.id };
  chat.messages.push(reply);
  renderMessages();

  const body = $("messages").lastElementChild.querySelector(".body");
  body.innerHTML = '<span class="typing"></span>';

  abort = new AbortController();
  setBusy(true);
  let frame = 0;
  try {
    const stream = streamChat(m.provider, m.id, context, { settings, temperature: Number(settings.temperature), onProgress: showProgress }, abort.signal);
    for await (const chunk of stream) {
      $("progress").classList.add("hidden");
      if (chunk.content) reply.content += chunk.content;
      if (chunk.reasoning) reply.reasoning += chunk.reasoning;
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
  f.showPaid.checked = settings.showPaid;
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
    showPaid: f.showPaid.checked,
    systemPrompt: f.systemPrompt.value,
    temperature: Number(f.temperature.value),
  };
  saveSettings(settings);
  if (currentUser) saveCloudSettings(settings).catch((err) => toast("Gagal sinkron ke akun: " + err.message));
  loadModels();
  if (!chat.messages.length) renderMessages();
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
  if (ext === "zip") {
    const JSZip = (await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
    const archive = await JSZip.loadAsync(await file.arrayBuffer());
    const entries = Object.values(archive.files).filter(x => !x.dir && !x.name.startsWith("__MACOSX/") && !x.name.split("/").some(part => part.startsWith(".")));
    if (!entries.length) throw new Error(`${file.name}: ZIP tidak berisi file yang bisa dibaca.`);
    const results = [];
    for (const entry of entries.slice(0, 40)) {
      const ext = entry.name.split(".").pop().toLowerCase();
      const supported = ["txt","md","csv","json","html","xml","js","ts","jsx","tsx","css","py","java","c","cpp","h","sql","yaml","yml","log"];
      if (supported.includes(ext) || ext === "pdf") {
        const blob = await entry.async("blob");
        const nested = new File([blob], entry.name.split("/").pop(), { type: ext === "pdf" ? "application/pdf" : "text/plain" });
        try { const parsed = await readUploadedFile(nested); results.push(`[Isi arsip: ${entry.name}]\\n${parsed.content}`); } catch {}
      }
    }
    if (!results.length) throw new Error(`${file.name}: ZIP terbaca, tetapi tidak ditemukan dokumen teks/PDF yang didukung.`);
    return { name: file.name, content: results.join("\\n\\n").slice(0, 100000) };
  }
  if (/^(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(ext)) {
    return { name: file.name, content: "[Lampiran gambar. Aplikasi saat ini menyertakan nama file, tetapi model chat belum menerima data visual gambar secara langsung.]" };
  }
  if (ext === "pdf") {
    const pdfjs = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    let content = "";
    for (let n = 1; n <= Math.min(doc.numPages, 40); n++) {
      const page = await doc.getPage(n);
      const data = await page.getTextContent();
      content += `\\n[Halaman ${n}] ` + data.items.map(x => x.str).join(" ");
    }
    return { name: file.name, content: content.slice(0, 100000) };
  }
  const allowed = ["txt","md","csv","json","html","xml","js","ts","jsx","tsx","css","py","java","c","cpp","h","sql","yaml","yml","log"];
  if (!allowed.includes(ext)) throw new Error(`${file.name}: format belum didukung. Gunakan PDF atau file teks/kode.`);
  return { name: file.name, content: (await file.text()).slice(0, 100000) };
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
    if (action === "files") $("fileInput").click();
    else if (action === "folder") $("folderInput").click();
    else if (action === "library") {
      const saved = JSON.parse(localStorage.getItem("myai_file_library") || "[]");
      if (!saved.length) { toast("Pustaka file masih kosong. File yang dikirim akan disimpan di sini."); return; }
      const choice = prompt("Pilih nomor file dari pustaka:\\n" + saved.map((f, i) => `${i + 1}. ${f.name}`).join("\\n"));
      const item = saved[Number(choice) - 1];
      if (item) { pendingFiles.push(item); renderAttachmentList(); }
    } else {
      const prompts = {
        image: "Bantu saya membuat gambar. Jelaskan konsep, gaya, warna, dan komposisi yang diinginkan:",
        sketch: "Bantu saya merancang sketsa. Subjek dan detail sketsa yang saya inginkan:",
        web: "Bantu saya mencari informasi terbaru dari web. Topik dan sumber yang perlu diperiksa:",
        research: "Lakukan riset mendalam, susun temuan, perbandingan, dan sumber yang perlu diverifikasi:"
      };
      $("input").value = ($("input").value ? $("input").value + "\\n\\n" : "") + prompts[action];
      $("input").focus();
    }
  });
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
    const library = JSON.parse(localStorage.getItem("myai_file_library") || "[]");
    for (const f of pendingFiles) {
      if (!library.some(x => x.name === f.name)) library.unshift({ name: f.name, content: f.content });
    }
    localStorage.setItem("myai_file_library", JSON.stringify(library.slice(0, 30)));
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
    const text = input.value;
    input.value = "";
    autosize();
    send(text);
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
