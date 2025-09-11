import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// 🔑 Config de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyCTFSlLoKv6KKujTqjMeMjNc-AlKQ2-rng",
  authDomain: "duostyle01-611b9.firebaseapp.com",
  projectId: "duostyle01-611b9",
  storageBucket: "duostyle01-611b9.firebasestorage.app",
  messagingSenderId: "4630065257",
  appId: "1:4630065257:web:11b7b0a0ac2fa776bbf2f8",
  measurementId: "G-FW6QEJMZKT"
};

// ✅ Inicializar Firebase
let app;
try {
  app = initializeApp(firebaseConfig);
} catch (e) {
  console.log("Firebase ya inicializado, reutilizando instancia.");
}
const functions = getFunctions(app);
const auth = getAuth(app);
const db = getFirestore(app);

// 🧪 Emulador local
if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  console.log("✅ Conectado al emulador de Functions");
}

// 🌍 Guardar contexto del usuario activo
let currentCompanyId = null;
let currentUserId = null;
let chatHistory = [];

// 🔒 Escapar HTML
function escapeHtml(s) {
  if (!s) return "";
  return String(s).replace(/[&<>"'`=\/]/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
    "'": "&#39;", "/": "&#x2F;", "`": "&#x60;", "=": "&#x3D;"
  }[c]));
}

// 📜 Guardar y cargar historial por usuario
function saveHistory() {
  if (currentUserId) {
    localStorage.setItem(`luciChatHistory_${currentUserId}`, JSON.stringify(chatHistory));
  }
}
function loadHistory() {
  if (currentUserId) {
    return JSON.parse(localStorage.getItem(`luciChatHistory_${currentUserId}`)) || [];
  }
  return [];
}
function clearHistory() {
  if (currentUserId) {
    localStorage.removeItem(`luciChatHistory_${currentUserId}`);
  }
  chatHistory = [];
}

// 📡 Detectar login/logout
onAuthStateChanged(auth, async (user) => {
  if (user) {
    console.log("✅ Usuario logueado:", user.uid);
    currentUserId = user.uid;
    chatHistory = loadHistory(); // Cargar historial solo del usuario
    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        currentCompanyId = userSnap.data().companyId || null;
        console.log("✅ Company ID detectado:", currentCompanyId);
      }
    } catch (err) {
      console.error("❌ Error al obtener companyId:", err);
    }
  } else {
    console.log("❌ Usuario no autenticado");
    currentCompanyId = null;
    currentUserId = null;
    clearHistory(); // borrar historial al cerrar sesión
  }
});

// 🪄 Crear UI del chat
function createLuciUI() {
  if (!currentUserId) {
    alert("⚠️ Debes iniciar sesión para usar el asistente Luci.");
    return;
  }

  // evitar duplicar UI
  if (document.getElementById("luci-chat-root")) return;

  const root = document.createElement("div");
  root.id = "luci-chat-root";
  root.style.position = "fixed";
  root.style.right = "18px";
  root.style.bottom = "18px";
  root.style.width = "340px";
  root.style.maxHeight = "70vh";
  root.style.zIndex = 9999;
  root.innerHTML = `
    <div style="background:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(2,6,23,0.12);overflow:hidden;font-family:Inter,system-ui;">
      <div style="padding:10px 12px;background:linear-gradient(180deg,#0ea5e9,#2563eb);color:#fff;font-weight:700;display:flex;justify-content:space-between;align-items:center">
        <span>Luci — Asistente</span>
        <button id="luci-close" style="background:transparent;border:none;color:#fff;font-weight:700;cursor:pointer">✕</button>
      </div>
      <div id="luci-messages" style="padding:10px;height:300px;overflow:auto;font-size:14px;line-height:1.4"></div>
      <div style="display:flex;gap:8px;padding:8px;border-top:1px solid #eee">
        <input id="luci-input" type="text" placeholder="Escribe aquí..." style="flex:1;padding:8px;border:1px solid #ddd;border-radius:8px" />
        <button id="luci-send" style="background:#10b981;color:#fff;border:none;padding:8px 10px;border-radius:8px;cursor:pointer">Enviar</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);

  // cerrar chat
  document.getElementById("luci-close").onclick = () => {
    saveHistory();
    root.remove();
  };

  const msgs = document.getElementById("luci-messages");
  const inp = document.getElementById("luci-input");
  const sendBtn = document.getElementById("luci-send");

  // mostrar mensajes
  function appendMessage(who, text) {
    const div = document.createElement("div");
    div.style.marginBottom = "8px";
    div.innerHTML = `
      <div style="font-size:12px;color:#6b7280">${who}</div>
      <div style="background:${who === "Luci" ? "#eef2ff" : "#f8fafc"};padding:8px;border-radius:8px;margin-top:4px;white-space:pre-line">
        ${escapeHtml(text)}
      </div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    chatHistory.push({ who, text });
    saveHistory();
  }

  // limpiar historial en UI (previene duplicados)
  msgs.innerHTML = "";
  chatHistory.forEach((m) => appendMessage(m.who, m.text));

  // detectar intención
  function detectIntent(text) {
    const lower = text.toLowerCase();
    if (lower.includes("venta") || lower.includes("ingreso") || lower.includes("egreso") || lower.includes("producto")) {
      return "analysis";
    }
    return "general";
  }

  // enviar mensaje
  async function send() {
    const text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    appendMessage("Tú", text);
    appendMessage("Luci", "Pensando... 🤔");

    try {
      const luciCall = httpsCallable(functions, "luciChat");
      const intent = detectIntent(text);

      const res = await luciCall({
        message: text,
        companyId: currentCompanyId,
        intent
      });

      // reemplazar "Pensando..."
      msgs.lastChild.remove();
      appendMessage("Luci", res.data.answer || "No encontré respuesta 😕");
    } catch (err) {
      console.error("Luci error", err);
      msgs.lastChild.remove();
      appendMessage("Luci", "⚠️ Error al consultar a Luci. Intenta de nuevo.");
    }
  }

  sendBtn.onclick = send;
  inp.onkeydown = (e) => { if (e.key === "Enter") send(); };
}

// 🌍 Exponer función global
window.openLuciChat = createLuciUI;
