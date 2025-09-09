// functions/index.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const OpenAI = require("openai");

// ✅ Inicializar Firebase Admin
initializeApp();
const auth = getAuth();
const db = getFirestore();

/**
 * 📌 Función para crear empleados
 */
exports.createEmployee = onCall(async (request) => {
  try {
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Debes estar autenticado para usar esta función."
      );
    }

    const { email, password, name, companyId, role } = request.data;
    if (!email || !password || !name || !companyId) {
      throw new HttpsError("invalid-argument", "Faltan datos requeridos.");
    }

    // Validar que el usuario autenticado tenga permisos
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!callerDoc.exists) {
      throw new HttpsError("permission-denied", "Usuario no encontrado.");
    }

    const callerData = callerDoc.data();
    if (callerData.role !== "admin" || callerData.companyId !== companyId) {
      throw new HttpsError(
        "permission-denied",
        "No tienes permisos para crear empleados."
      );
    }

    // Crear usuario en Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
    });

    // Guardar datos en Firestore
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
 * 🌟 Función: luciChat (IA + Firestore)
 */
exports.luciChat = onCall(
  { secrets: ["OPENAI_API_KEY"] }, // ✅ Secreto configurado en Firebase
  async (request) => {
    try {
      if (!request.auth) {
        throw new HttpsError(
          "unauthenticated",
          "Debes iniciar sesión para usar Luci."
        );
      }

      const { message, companyId, intent } = request.data;
      if (!message) {
        throw new HttpsError("invalid-argument", "Falta el mensaje del usuario.");
      }

      // 🔑 Inicializar OpenAI con secret
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      // 📂 Obtener datos del usuario autenticado
      const userDoc = await db.collection("users").doc(request.auth.uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};

      let dbAnswer = null;

      // 🔍 Si hay companyId e intención de análisis → consultar Firestore
      if (companyId && intent === "analysis") {
        try {
          const companyRef = db.collection("companies").doc(companyId);
          const companySnap = await companyRef.get();

          if (!companySnap.exists) {
            dbAnswer = "❌ No encontré datos de la empresa en la base.";
          } else {
            const companyData = companySnap.data();
            const employeesSnap = await companyRef.collection("employees").get();
            const employees = employeesSnap.docs.map((doc) => doc.data());

            dbAnswer = `📊 Datos de la empresa:\n- Nombre: ${
              companyData.name || "Sin nombre"
            }\n- Total empleados: ${employees.length}`;
          }
        } catch (err) {
          console.error("Error leyendo Firestore:", err);
          dbAnswer = "⚠️ No pude consultar la base de datos.";
        }
      }

      // 🧠 Crear prompt para la IA
      const prompt = dbAnswer
        ? `El usuario preguntó: "${message}".\nEstos son datos desde Firebase:\n${dbAnswer}\n\nResponde de forma clara, profesional y útil.`
        : `El usuario preguntó: "${message}".\nResponde como asistente experto en marketing, negocios y análisis de datos.`;

      // 🚀 Llamada a OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Eres Luci, una asistente experta en marketing digital, negocios y análisis empresarial. Siempre responde de manera clara, útil y profesional.",
          },
          { role: "user", content: prompt },
        ],
      });

      const reply =
        completion.choices?.[0]?.message?.content ||
        "🤖 No encontré respuesta.";

      return { reply };
    } catch (error) {
      console.error("Error en luciChat:", error);
      throw new HttpsError(
        "internal",
        error.message || "Error interno en Luci."
      );
    }
  }
);
