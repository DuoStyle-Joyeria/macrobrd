// functions/index.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const OpenAI = require("openai");

// ✅ Inicializar Firebase Admin una sola vez
initializeApp();
const auth = getAuth();
const db = getFirestore();

/**
 * 📌 Función: Crear empleados
 */
exports.createEmployee = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Debes estar autenticado.");
    }

    const { email, password, name, companyId, role } = request.data;
    if (!email || !password || !name || !companyId) {
      throw new HttpsError("invalid-argument", "Faltan datos requeridos.");
    }

    // ✅ Validar permisos
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!callerDoc.exists) {
      throw new HttpsError("permission-denied", "Usuario no encontrado.");
    }

    const callerData = callerDoc.data();
    if (callerData.role !== "admin" || callerData.companyId !== companyId) {
      throw new HttpsError("permission-denied", "No tienes permisos.");
    }

    // ✅ Crear usuario en Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
    });

    // ✅ Guardar en Firestore
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
    console.error("Error en createEmployee:", error);
    throw new HttpsError("internal", error.message || "Error interno");
  }
});

/**
 * 🤖 Función: Chat de Luci (IA)
 */
exports.luciChat = onCall(
  { secrets: ["OPENAI_API_KEY"] },
  async (request) => {
    try {
      const { message, companyId, intent } = request.data;
      if (!message) {
        throw new HttpsError("invalid-argument", "Falta el mensaje.");
      }

      // ⚡ Inicializar cliente OpenAI **dentro de la función**
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      // 🐞 DEBUG MODE → devuelve datos crudos de Firestore
      if (message.toLowerCase() === "debug" && companyId) {
        const companyRef = db.collection("companies").doc(companyId);
        const companySnap = await companyRef.get();

        if (!companySnap.exists) {
          return { answer: "❌ Empresa no encontrada en Firestore." };
        }

        const companyData = companySnap.data();
        return {
          answer: `🔍 Debug info:\nEmpresa: ${companyData.name || "Sin nombre"}\nOwners: ${JSON.stringify(
            companyData.owners || []
          )}`,
        };
      }

      let dbAnswer = null;

      // 📊 Si pidieron análisis, consultar Firestore
      if (companyId && intent === "analysis") {
        try {
          const companyRef = db.collection("companies").doc(companyId);
          const companySnap = await companyRef.get();

          if (!companySnap.exists) {
            dbAnswer = "❌ No encontré datos de la empresa.";
          } else {
            const companyData = companySnap.data();
            const employeesSnap = await companyRef.collection("employees").get();
            const employees = employeesSnap.docs.map((doc) => doc.data());

            dbAnswer = `📊 Empresa: ${
              companyData.name || "Sin nombre"
            }\n👥 Empleados: ${employees.length}`;
          }
        } catch (err) {
          console.error("Error Firestore:", err);
          dbAnswer = "⚠️ Error consultando la base de datos.";
        }
      }

      // 🧠 Preparar prompt
      const prompt = dbAnswer
        ? `El usuario dijo: "${message}". Datos de la empresa:\n${dbAnswer}`
        : `El usuario dijo: "${message}". Responde como asistente de negocios.`;

      // 🚀 Llamada a OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Eres Luci, una asistente experta en negocios y marketing. Siempre usa datos de Firestore si están disponibles para dar respuestas personalizadas a cada empresa o usuario.",
          },
          { role: "user", content: prompt },
        ],
      });

      return { answer: completion.choices[0].message.content };
    } catch (error) {
      console.error("Error en luciChat:", error);
      throw new HttpsError("internal", error.message || "Error en Luci.");
    }
  }
);
