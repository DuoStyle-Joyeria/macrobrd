// ... (imports y config iguales)

let currentCompanyId = null;
let currentUserId = null;
let chatHistory = [];

// Escapar HTML (igual)
function escapeHtml(s) { /* ... */ }

// 📜 Guardar/cargar historial
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

// Detectar login/logout (igual)
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUserId = user.uid;
    chatHistory = loadHistory();
    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        currentCompanyId = userSnap.data().companyId || null;
      }
    } catch (err) { console.error("❌ Error al obtener companyId:", err); }
  } else {
    currentCompanyId = null;
    currentUserId = null;
    clearHistory();
  }
});

// 🪄 Crear UI del chat
function createLuciUI() {
  if (!currentUserId) {
    alert("⚠️ Debes iniciar sesión para usar Luci.");
    return;
  }
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

  document.getElementById("luci-close").onclick = () => {
    saveHistory();
    root.remove();
  };

  const msgs = document.getElementById("luci-messages");
  const inp = document.getElementById("luci-input");
  const sendBtn = document.getElementById("luci-send");

  // mostrar mensajes sin re-guardar en historial
  function renderMessage(who, text) {
    const div = document.createElement("div");
    div.style.marginBottom = "8px";
    div.innerHTML = `
      <div style="font-size:12px;color:#6b7280">${who}</div>
      <div style="background:${who === "Luci" ? "#eef2ff" : "#f8fafc"};padding:8px;border-radius:8px;margin-top:4px;white-space:pre-line">
        ${escapeHtml(text)}
      </div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function appendMessage(who, text) {
    renderMessage(who, text);
    chatHistory.push({ who, text });
    saveHistory();
  }

  // limpiar y renderizar historial solo una vez
  msgs.innerHTML = "";
  chatHistory.forEach((m) => renderMessage(m.who, m.text));

  // enviar mensaje
  async function send() {
    const text = inp.value.trim();
    if (!text) return;
    inp.value = "";
    appendMessage("Tú", text);

    const thinkingDiv = document.createElement("div");
    thinkingDiv.textContent = "Luci: Pensando... 🤔";
    msgs.appendChild(thinkingDiv);
    msgs.scrollTop = msgs.scrollHeight;

    try {
      const luciCall = httpsCallable(functions, "luciChat");
      const res = await luciCall({
        message: text,
        companyId: currentCompanyId
      });

      thinkingDiv.remove();
      appendMessage("Luci", res.data.answer || "No encontré respuesta 😕");
    } catch (err) {
      console.error("Luci error", err);
      thinkingDiv.remove();
      appendMessage("Luci", "⚠️ Error al consultar a Luci. Intenta de nuevo.");
    }
  }

  sendBtn.onclick = send;
  inp.onkeydown = (e) => { if (e.key === "Enter") send(); };
}

// 🌍 Exponer función global
window.openLuciChat = createLuciUI;
