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
  db = fsMod.getFirestore(app);
  fb = { ...authMod, ...fsMod };
  fb.onAuthStateChanged(auth, (u) => {
    user = u;
    onUserChange(u);
  });
}

export const signIn = () => fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
export const signOutUser = () => fb.signOut(auth);

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
