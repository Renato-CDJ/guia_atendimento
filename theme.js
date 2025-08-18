import { db, auth } from "./firebase.js";
import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

let currentUserId = null;

// Aplica o tema na tela
async function aplicarTema(userId) {
  if (!userId) {
    document.body.setAttribute("data-theme", "dark");
    return;
  }
  const snap = await getDoc(doc(db, "preferencias", userId));
  if (snap.exists()) {
    const tema = snap.data().tema || "dark";
    document.body.setAttribute("data-theme", tema);
  } else {
    document.body.setAttribute("data-theme", "dark");
  }
}

// Salva o tema no Firestore
async function salvarTema(userId, tema) {
  if (!userId) return;
  await setDoc(doc(db, "preferencias", userId), { tema }, { merge: true });
}

// Ouve mudanças de login
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUserId = user.uid;
    aplicarTema(user.uid);
  } else {
    currentUserId = null;
    document.body.setAttribute("data-theme", "dark");
  }
});

// Configura botão de alternância
const themeBtn = document.getElementById("btnToggleTheme");
themeBtn?.addEventListener("click", async () => {
  const atual = document.body.getAttribute("data-theme");
  const novo = atual === "light" ? "dark" : "light";
  document.body.setAttribute("data-theme", novo);
  await salvarTema(currentUserId, novo);
});
