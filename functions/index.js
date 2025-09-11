// functions/index.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const OpenAI = require("openai");

// Inicializar Firebase Admin
initializeApp();
const auth = getAuth();
const db = getFirestore();

/**
 * createEmployee (callable)
 * - Lo dejé igual que antes (verifica permisos desde users doc).
 */
exports.createEmployee = onCall(async (request) => {
  try {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes estar autenticado.");

    const { email, password, name, companyId, role } = request.data;
    if (!email || !password || !name || !companyId) throw new HttpsError("invalid-argument", "Faltan datos requeridos.");

    const callerDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!callerDoc.exists) throw new HttpsError("permission-denied", "Usuario no encontrado.");
    const callerData = callerDoc.data();
    if (callerData.role !== "admin" || callerData.companyId !== companyId) {
      throw new HttpsError("permission-denied", "No tienes permisos para crear empleados.");
    }

    const userRecord = await auth.createUser({ email, password, displayName: name });

    await db.collection("users").doc(userRecord.uid).set({
      name,
      email,
      role: role || "empleado",
      companyId,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: request.auth.uid,
    });

    return { success: true, uid: userRecord.uid };
  } catch (error) {
    console.error("createEmployee error:", error);
    throw new HttpsError("internal", error.message || "Error interno");
  }
});

/**
 * luciChat (callable)
 *
 * - Secrets: OPENAI_API_KEY (configúralo con firebase functions:secrets:set ...)
 * - Parámetros esperados en request.data:
 *    { message, companyId, intent = 'general', chatId = null, userId = null }
 *
 * - Intents:
 *    'general'  -> uso de modelo barato (gpt-4o-mini), max_tokens pequeño
 *    'analysis' -> usa datos Firestore + modelo más potente (p. ej. gpt-4o), más tokens
 *
 * - Guarda historial en Firestore:
 *    companies/{companyId}/chats/{chatId}/messages
 */
exports.luciChat = onCall(
  { secrets: ["OPENAI_API_KEY"] },
  async (request) => {
    try {
      const { message, companyId = null, intent = "general", chatId = null, userId = null } = request.data || {};
      if (!message || typeof message !== "string" || !message.trim()) {
        throw new HttpsError("invalid-argument", "Falta el mensaje.");
      }

      // Inicializar OpenAI dentro de la función (buena práctica)
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      // Selección de modelo y políticas de tokens (ahorro de costos)
      let model = "gpt-4o-mini";        // por defecto (barato)
      let max_tokens = 400;            // límite por defecto (reduce costos)
      let temperature = 0.25;          // respuestas más deterministas

      if (intent === "analysis" || intent === "advanced") {
        model = "gpt-4o";             // usa un modelo más potente para análisis
        max_tokens = 900;             // más tokens para análisis profundos
        temperature = 0.2;
      }

      // DEBUG shortcut: si escriben "debug" devolvemos info sin pasar por IA
      if (message.trim().toLowerCase() === "debug" && companyId) {
        const compRef = db.collection("companies").doc(companyId);
        const cs = await compRef.get();
        if (!cs.exists) return { answer: "❌ No encontré la empresa con ese ID." };
        const comp = cs.data();
        return { answer: `🔍 Debug info:\nEmpresa: ${comp.name || "Sin nombre"}\nOwners: ${JSON.stringify(comp.owners || [])}` };
      }

      // Si se pidió 'analysis' intent: agregar contexto corto desde Firestore (solo lo necesario)
      let dbContext = "";
      if (companyId && intent === "analysis") {
        try {
          const compRef = db.collection("companies").doc(companyId);
          const compSnap = await compRef.get();
          if (compSnap.exists) {
            const compData = compSnap.data();
            // ejemplo de datos útiles: nombre, número de ventas totales en últimos 90 días (si lo tienes en una colección)
            dbContext += `Empresa: ${compData.name || "sin-nombre"}\n`;
            // intenta leer conteos simples (no traigas listas grandes)
            const salesCol = await compRef.collection("sales").limit(1).get(); // solo prueba para exist
            // si quieres más métricas, calcula y guarda en un campo 'analytics.summary' para evitar lecturas masivas
            dbContext += `Nota: Esta empresa tiene ventas guardadas (no se obtuvieron totales aquí).\n`;
          } else {
            dbContext += "Empresa no encontrada.\n";
          }
        } catch (e) {
          console.error("Error leyendo Firestore para contexto:", e);
        }
      }

      // Armar mensajes para la llamada a OpenAI (sólo incluir dbContext si es corto)
      const systemContent = `Eres Luci, asistente experta en negocios y marketing. Responde de forma clara y profesional. Usa datos de la empresa si están disponibles: ${dbContext ? "sí" : "no"}.`;
      const userContent = dbContext ? `${dbContext}\nPregunta: ${message}` : message;

      // Llamada a OpenAI (control de tokens y modelo)
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: userContent }
        ],
        max_tokens,
        temperature,
        // noprobs, top_p pueden ajustarse si quieres
      });

      // Obtener respuesta
      const answer = (completion?.choices?.[0]?.message?.content) ? completion.choices[0].message.content : "Lo siento, no tuve respuesta del modelo.";

      // Guardar en Firestore (historial) — si tenemos companyId y chatId (si no, intentamos crear chatId por user)
      try {
        if (companyId) {
          const finalChatId = chatId || (userId ? `${userId}_default` : `guest_${Date.now()}`);
          const messagesRef = db.collection("companies").doc(companyId).collection("chats").doc(finalChatId).collection("messages");
          const ts = FieldValue.serverTimestamp();
          // Guardar usuario mensaje
          await messagesRef.add({ role: "user", text: message, ts, userId: userId || null });
          // Guardar luci respuesta
          await messagesRef.add({ role: "luci", text: answer, ts, model, tokensUsed: (completion.usage || null) });
        }
      } catch (e) {
        // no interrumpimos la respuesta si falla el guardado
        console.warn("No se pudo guardar historial de chat:", e);
      }

      // Responder al cliente
      return { answer, model, usage: completion.usage || null };
    } catch (err) {
      console.error("luciChat error:", err);
      throw new HttpsError("internal", err.message || "Error interno en Luci.");
    }
  }
);
