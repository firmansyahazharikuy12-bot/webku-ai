import { firebaseConfig } from "./config.js";

const FB_BASE = "https://www.gstatic.com/firebasejs/10.12.2";
const LS_KEY = "myai_chats";

export const firebaseEnabled = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let fb = null;
let auth = null;
let db = null;
let user = null;

export async function initFirebase(onUserChange) {
  if (!firebaseEnabled) {
    onUserChange(null);
    return;
  }
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`${FB_BASE}/firebase-app.js`),
    import(`${FB_BASE}/firebase-auth.js`),
    import(`${FB_BASE}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  auth = authMod.getAuth(app);
  try {
    // Cache offline: riwayat chat tetap bisa dibuka tanpa internet,
    // lalu otomatis tersinkron lagi saat online. Aman dipakai di banyak tab.
    db = fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
    });
  } catch {
    db = fsMod.getFirestore(app);
  }
  fb = { ...authMod, ...fsMod };
  fb.onAuthStateChanged(auth, (u) => {
    user = u;
    onUserChange(u);
  });
}

const ready = () => {
  if (!fb) throw new Error("Firebase belum siap. Periksa koneksi internet lalu muat ulang halaman.");
};

// ---------- Autentikasi ----------

export const signIn = () => {
  ready();
  return fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
};

export const signInEmail = (email, password) => {
  ready();
  return fb.signInWithEmailAndPassword(auth, email, password);
};

export async function signUpEmail(displayName, email, password) {
  ready();
  const cred = await fb.createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await fb.updateProfile(cred.user, { displayName });
  return cred.user;
}

export const resetPassword = (email) => {
  ready();
  return fb.sendPasswordResetEmail(auth, email);
};

export const signOutUser = () => {
  ready();
  return fb.signOut(auth);
};

// Pesan galat Firebase yang ramah. String kosong = abaikan (mis. popup ditutup).
export function authErrorMessage(e) {
  const map = {
    "auth/invalid-email": "Format email tidak valid.",
    "auth/missing-email": "Isi email dulu.",
    "auth/missing-password": "Isi kata sandi dulu.",
    "auth/invalid-credential": "Email atau kata sandi salah.",
    "auth/wrong-password": "Email atau kata sandi salah.",
    "auth/user-not-found": "Email atau kata sandi salah.",
    "auth/email-already-in-use": "Email ini sudah terdaftar. Coba masuk.",
    "auth/weak-password": "Kata sandi minimal 6 karakter.",
    "auth/too-many-requests": "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
    "auth/network-request-failed": "Koneksi internet bermasalah. Coba lagi.",
    "auth/operation-not-allowed": "Metode masuk ini belum aktif. Aktifkan di Firebase Console → Authentication → Sign-in method.",
    "auth/unauthorized-domain": "Domain ini belum terdaftar. Tambahkan di Firebase Console → Authentication → Settings → Authorized domains.",
    "auth/popup-blocked": "Popup diblokir browser. Izinkan popup lalu coba lagi.",
    "auth/popup-closed-by-user": "",
    "auth/cancelled-popup-request": "",
  };
  return e?.code in map ? map[e.code] : e?.message || String(e);
}

// ---------- Penyimpanan ----------

const readLocal = () => JSON.parse(localStorage.getItem(LS_KEY) || "{}");
const writeLocal = (obj) => localStorage.setItem(LS_KEY, JSON.stringify(obj));
const chatsCol = () => fb.collection(db, "users", user.uid, "chats");
const settingsDoc = () => fb.doc(db, "users", user.uid, "private", "settings");

export async function loadCloudSettings() {
  if (!user) return null;
  const snap = await fb.getDoc(settingsDoc());
  return snap.exists() ? snap.data() : null;
}

export async function saveCloudSettings(settings) {
  if (!user) return;
  await fb.setDoc(settingsDoc(), { ...settings, updatedAt: Date.now() });
}

// Pengaturan real-time: perubahan dari perangkat lain langsung masuk.
// Perubahan dari perangkat ini sendiri (hasPendingWrites) diabaikan.
export function subscribeCloudSettings(onData) {
  if (!user) return () => {};
  return fb.onSnapshot(
    settingsDoc(),
    (snap) => {
      if (snap.metadata.hasPendingWrites || !snap.exists()) return;
      onData(snap.data());
    },
    () => {}
  );
}

// Riwayat chat real-time dari Firestore.
export function subscribeChats(onData, onError) {
  if (!user) return () => {};
  const q = fb.query(chatsCol(), fb.orderBy("updatedAt", "desc"));
  return fb.onSnapshot(q, (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError);
}

export async function listChats() {
  if (user) {
    const snap = await fb.getDocs(fb.query(chatsCol(), fb.orderBy("updatedAt", "desc")));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  return Object.values(readLocal()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveChat(chat) {
  // Firestore menolak nilai undefined; round-trip JSON membuangnya.
  const data = JSON.parse(JSON.stringify(chat));
  if (user) {
    const { id, ...rest } = data;
    await fb.setDoc(fb.doc(chatsCol(), id), rest);
    return;
  }
  const all = readLocal();
  all[chat.id] = data;
  writeLocal(all);
}

export async function deleteChat(id) {
  if (user) {
    await fb.deleteDoc(fb.doc(chatsCol(), id));
    return;
  }
  const all = readLocal();
  delete all[id];
  writeLocal(all);
}

// ---------- Pindahkan chat lokal ke akun ----------

export const localChatCount = () => Object.keys(readLocal()).length;

// Unggah semua chat yang tersimpan di browser ke akun, lalu kosongkan salinan lokal.
export async function importLocalChats() {
  if (!user) throw new Error("Masuk dulu untuk mengunggah chat.");
  const all = Object.values(readLocal());
  for (let i = 0; i < all.length; i += 400) {
    const batch = fb.writeBatch(db);
    for (const c of all.slice(i, i + 400)) {
      const { id, ...rest } = JSON.parse(JSON.stringify(c));
      batch.set(fb.doc(chatsCol(), id), rest);
    }
    await batch.commit();
  }
  writeLocal({});
  return all.length;
}
