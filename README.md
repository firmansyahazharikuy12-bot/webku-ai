# MyAI — AI Chat Pribadimu (mirip ChatGPT / Claude / Gemini)

Website chat AI pribadi yang **gratis**, bisa di-hosting di **GitHub Pages**, dengan login & riwayat chat di **Firebase**.

Model yang didukung:

| Sumber | Model | Biaya |
|---|---|---|
| **Lokal di browser** (WebLLM/WebGPU) | Qwen 2.5/3, DeepSeek-R1 Distill, Llama 3, Gemma, Phi, dll | 100% gratis, offline, tanpa API key |
| **Google Gemini** | Semua versi Gemini & Gemma yang tersedia di akunmu | Gratis (ada batas harian) |
| **Groq** | Model open-source (Llama, Qwen, dll — tergantung katalog Groq saat ini) | Gratis (ada batas per menit) |
| **OpenRouter** | Ratusan model; yang bertanda `:free` gratis (daftarnya berganti-ganti, misal Gemma, Nemotron, dll) | Gratis untuk model `:free` |
| **OpenRouter (berbayar)** | Claude, GPT, Qwen & DeepSeek versi penuh, dll | Butuh kredit (opsional) |

Daftar model diambil **otomatis** dari masing-masing layanan, jadi kalau ada versi baru (misal Qwen atau Gemini terbaru), langsung muncul tanpa perlu ubah kode.

## Tampilan dan keamanan\n\n- Halaman pembuka sebelum masuk ke ruang chat, dengan dialog login Google melalui Firebase. Tersedia juga mode tamu.\n- Tombol tema gelap/terang; pilihan tema disimpan di browser.\n- **Jangan menaruh API key Gemini, Groq, atau OpenRouter langsung di source code.** Masukkan lewat Pengaturan setelah membuka aplikasi. API key yang pernah dibagikan di chat atau tempat publik sebaiknya segera dicabut dan dibuat ulang.\n\n## Yang baru di v2.0

- **Logo & nama rapi tiap model**: Claude, GPT, Gemini, Qwen, DeepSeek, Llama, Mistral, Grok, Kimi, dll tampil dengan logonya (ikon dari [LobeHub Icons](https://github.com/lobehub/lobe-icons)).
- **Hanya versi terbaru**: versi lama otomatis disembunyikan (misal hanya Claude 5.5, bukan 3/4), tapi semua ukuran dari versi terbaru tetap ada (misal Qwen3.5 0.8B sampai 9B di mode lokal).
- **Pemilih model baru** dengan kotak pencarian dan pengelompokan per layanan.
- **Sinkron API key lewat Firebase**: setelah login Google, API key & pengaturan disimpan di dokumen privat `users/{uid}/private/settings`, jadi otomatis terisi di perangkat lain.
- **Logo aplikasi** (`assets/logo.svg`) dan lencana versi.

---

## Penjelasan singkat (tanpa background AI)

- **Transformer** adalah arsitektur di balik semua AI modern (GPT, Claude, Gemini, Qwen, DeepSeek). Intinya: model membaca teks, menghitung "perhatian" (*attention*) antar kata, lalu menebak kata berikutnya, berulang-ulang.
- **Melatih model sendiri dari nol** butuh ribuan GPU dan biaya miliaran rupiah. Karena itu kita memakai **model hasil riset yang sudah ada** (Qwen dari Alibaba, DeepSeek, Llama dari Meta, Gemma/Gemini dari Google). Semua "pengetahuan" dan data riset sudah tertanam di dalam model-model itu.
- Mode **Lokal di browser** benar-benar menjalankan model Transformer (misalnya Qwen) di laptopmu memakai GPU lewat WebGPU — ini "AI versimu sendiri" yang paling murni.
- **Claude** tidak punya API gratis; hanya bisa lewat OpenRouter (berbayar). Qwen & DeepSeek "full version" (ratusan miliar parameter) terlalu besar untuk browser; versi penuhnya bisa dipakai lewat OpenRouter/Groq (kadang gratis, kadang berbayar). Di mode lokal tersedia versi kecilnya (Qwen3/3.5 hingga 9B, DeepSeek-R1 Distill 7B/8B).

---

## Langkah 1 — Coba di komputer sendiri

File ini memakai ES modules, jadi **tidak bisa** dibuka dengan klik dua kali (`file://`). Jalankan server lokal di folder proyek:

```bash
python3 -m http.server 8080
# atau
npx serve .
```

Lalu buka http://localhost:8080

> Kalau Python/Node belum terpasang, lewati langkah ini dan langsung ke Langkah 4 (GitHub Pages).

## Langkah 2 — Ambil API key gratis (pilih minimal satu)

1. **Gemini**: https://aistudio.google.com/apikey → *Create API key*
2. **Groq**: https://console.groq.com/keys → *Create API Key*
3. **OpenRouter**: https://openrouter.ai/keys → *Create Key*

Buka website → **⚙ Pengaturan** → tempel key → **Simpan**. Key disimpan di browsermu, dan kalau sudah login Google juga di Firestore (hanya bisa dibaca akunmu sendiri).

> Tanpa API key pun kamu bisa memakai model **Lokal di browser** (Chrome/Edge terbaru, laptop dengan GPU). Pertama kali dipakai, model akan diunduh (±1–5 GB) lalu disimpan di cache.

## Langkah 3 — Setel Firebase (opsional, untuk login & sinkron riwayat chat)

Tanpa Firebase, riwayat chat tetap tersimpan di browser (localStorage).

1. Buka https://console.firebase.google.com → **Add project** (gratis, paket Spark).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable**.
3. **Build → Firestore Database → Create database** (mode production, pilih lokasi terdekat, misal `asia-southeast2` Jakarta).
4. Tab **Rules** di Firestore → salin isi file `firestore.rules` → **Publish**.
   Agar hanya kamu yang bisa login, tambahkan cek email seperti contoh di file tersebut.
5. **Project settings (ikon ⚙) → Your apps → Web (`</>`)** → daftarkan app → salin objek `firebaseConfig` ke `js/config.js`.
6. **Authentication → Settings → Authorized domains → Add domain** → tambahkan `USERNAME.github.io`.

> `firebaseConfig` memang aman untuk publik; yang melindungi data adalah **Rules** di langkah 4.

## Langkah 4 — Upload ke GitHub & aktifkan GitHub Pages

```bash
git init
git add .
git commit -m "AI chat pribadi"
git branch -M main
git remote add origin https://github.com/USERNAME/myai.git
git push -u origin main
```

Lalu di GitHub: **Settings → Pages → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**.
Tunggu 1–2 menit, website aktif di `https://USERNAME.github.io/myai/`.

---

## Struktur file

```
index.html        Tampilan utama
assets/logo.svg   Logo aplikasi
css/style.css     Desain (tema gelap)
js/config.js      Nama app, versi + konfigurasi Firebase
js/app.js         Logika UI chat & pemilih model
js/models.js      Logo model, nama rapi, filter "hanya versi terbaru"
js/providers.js   Koneksi ke model: Lokal (WebLLM), Gemini, Groq, OpenRouter
js/db.js          Login Google, simpan riwayat & sinkron pengaturan (Firebase / localStorage)
firestore.rules   Aturan keamanan database Firestore
```

## Tips

- **Ganti nama AI-mu**: ubah `APP_NAME` di `js/config.js`; ganti logonya di `assets/logo.svg`.
- **Ubah kepribadian AI**: ⚙ Pengaturan → *System prompt*.
- **Model "berpikir"** (DeepSeek-R1, Qwen3, Gemini Thinking) menampilkan kotak *Proses berpikir* yang bisa dibuka.
- Menu **+** menyediakan unggah banyak file/folder, pustaka lampiran, pencarian web, riset web, prompt gambar, dan kanvas sketsa.
- Lampiran teks/kode, PDF, DOCX, XLSX, PPTX, ZIP, serta gambar umum dapat dibaca; file gambar dikirim sebagai input visual ke model vision yang mendukungnya.
- Mode pencarian web memakai Google Search di Gemini atau plugin web OpenRouter. Pencarian dan generasi gambar dapat menggunakan kuota atau menimbulkan biaya provider.
- Generasi gambar memakai Gemini Image. Hasilnya hanya tersimpan selama tab terbuka; unduh gambar untuk menyimpannya.
- **Keamanan**: repo GitHub publik itu aman selama kamu **tidak** menulis API key di dalam kode. Masukkan key hanya lewat menu Pengaturan.
- Batas gratis bisa berubah sewaktu-waktu sesuai kebijakan masing-masing layanan.


## Mengatur dan memperbarui API key

1. Buka MyAI, klik **Pengaturan**.
2. Tempel API key baru pada kolom Gemini, Groq, dan/atau OpenRouter.
3. Klik **Simpan**. Key tersimpan di browser; jika masuk dengan Firebase, aplikasi juga mencoba menyinkronkan pengaturan ke akun.
4. Untuk mengganti key, buka Pengaturan, ubah kolom yang diinginkan, lalu simpan lagi.

**Keamanan:** API key yang ditanam langsung ke JavaScript frontend dapat dilihat siapa pun yang membuka situs. Karena key yang dibagikan di chat sudah terekspos, cabut/revoke key lama dan buat key baru di masing-masing penyedia sebelum digunakan. Untuk aplikasi publik, solusi paling aman adalah menyimpan key di backend/server secrets dan memanggil provider melalui backend, bukan memasukkannya ke source code browser.

## Pakai T4 Google Colab tanpa mengunduh model ke browser

Model tetap perlu diunduh ke runtime Colab dan prompt tetap dikirim lewat internet. Cara ini hanya menghindari unduhan model WebLLM di browser.

1. Buka notebook Colab, pilih **Runtime → Change runtime type → T4 GPU**, lalu jalankan `!nvidia-smi` untuk memastikan GPU aktif.
2. Siapkan model **GGUF quantized** yang bisa dimuat `llama.cpp`. T4 memiliki VRAM terbatas; mulai dari model kecil 3B–7B Q4 dan context 2K–4K.
3. Di cell Colab, pasang server CUDA. Build dari source dapat memakan waktu:

   ```python
   %env CMAKE_ARGS=-DGGML_CUDA=on
   %env FORCE_CMAKE=1
   !pip install -q "llama-cpp-python[server]" huggingface_hub pyngrok
   ```

4. Unduh contoh model GGUF Qwen 3B Q4_K_M dari Hugging Face. Jika memilih model privat, simpan token Hugging Face di **Colab Secrets**, jangan di notebook publik:

   ```python
   from huggingface_hub import hf_hub_download

   model_path = hf_hub_download(
         repo_id="Qwen/Qwen2.5-3B-Instruct-GGUF",
         filename="qwen2.5-3b-instruct-q4_k_m.gguf",
   )
   ```

5. Buat dua secret di panel **Secrets** Colab: `MYAI_SERVER_TOKEN` dan `NGROK_AUTHTOKEN`. Beri notebook akses ke keduanya. Isi `NGROK_AUTHTOKEN` dengan token dari akun ngrok milikmu.
6. Jalankan server OpenAI-compatible dengan token dan alias model sendiri:

   ```python
   from google.colab import userdata
   import subprocess

   server_token = userdata.get("MYAI_SERVER_TOKEN")
   server = subprocess.Popen([
       "python", "-m", "llama_cpp.server",
       "--model", model_path,
       "--model_alias", "my-colab-model",
       "--host", "0.0.0.0",
       "--port", "8000",
       "--n_gpu_layers", "-1",
       "--api_key", server_token,
   ])
   ```

7. Buat URL HTTPS sementara:

   ```python
   from pyngrok import ngrok

   ngrok.set_auth_token(userdata.get("NGROK_AUTHTOKEN"))
   public_url = ngrok.connect(8000, bind_tls=True).public_url
   print(public_url)
   ```

8. Di MyAI buka **Pengaturan**, lalu isi:
   - **Endpoint**: URL HTTPS yang dicetak Colab, tanpa `/chat/completions` (contoh `https://alamat-ngrok.ngrok-free.app`).
   - **Token endpoint**: nilai `MYAI_SERVER_TOKEN` yang sama.
   - **Model di server**: `my-colab-model`.
   - Biarkan **Aktifkan model lokal browser** tidak dicentang.
   - Tekan **Uji koneksi**. Jika server terhubung dan alias cocok, tekan **Simpan**. Pilih model `my-colab-model` dan kirim pesan percobaan.

URL tunnel berubah saat runtime dibuat ulang. Setiap kali Colab terputus, jalankan lagi server, buat URL baru, lalu perbarui endpoint di Pengaturan. Jangan membagikan notebook yang berisi output token atau membuka endpoint tanpa token. Untuk server selain `llama-cpp-python`, pastikan HTTPS, autentikasi Bearer, dan CORS mengizinkan origin MyAI.
