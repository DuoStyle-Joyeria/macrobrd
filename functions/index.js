// functions/index.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
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
 * 🤖 Función: Chat de Luci (IA híbrida Firestore + OpenAI)
 */
exports.luciChat = onCall(
  { secrets: ["OPENAI_API_KEY"] },
  async (request) => {
    try {
      const { message, companyId } = request.data;
      if (!message) {
        throw new HttpsError("invalid-argument", "Falta el mensaje.");
      }

      // ⚡ Inicializar cliente OpenAI
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      // 🐞 DEBUG MODE
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

      // 📊 Consultar Firestore si hay companyId
      if (companyId) {
        try {
          const companyRef = db.collection("companies").doc(companyId);
          const companySnap = await companyRef.get();

          if (!companySnap.exists) {
            dbAnswer = "❌ No encontré datos de la empresa.";
          } else {
            const companyData = companySnap.data();

            // 🔎 Cargar empleados
            const employeesSnap = await companyRef.collection("employees").get();
            const employees = employeesSnap.docs.map((doc) => doc.data());

            // 🔎 Cargar ventas
            const salesSnap = await companyRef.collection("sales").get();
            const sales = salesSnap.docs.map((doc) => doc.data());

            // 🔎 Analizar producto más vendido
            let productoMasVendido = "N/A";
            let cantidadMax = 0;
            if (sales.length > 0) {
              const contador = {};
              sales.forEach((venta) => {
                if (venta.items && Array.isArray(venta.items)) {
                  venta.items.forEach((item) => {
                    const nombre = item.name || "Desconocido";
                    const cantidad = item.qty || 1;
                    contador[nombre] = (contador[nombre] || 0) + cantidad;
                  });
                }
              });

              for (const [producto, cantidad] of Object.entries(contador)) {
                if (cantidad > cantidadMax) {
                  productoMasVendido = producto;
                  cantidadMax = cantidad;
                }
              }
            }

            // 🔎 Cargar egresos
            const expensesSnap = await companyRef.collection("egresos").get();
            const egresos = expensesSnap.docs.map((doc) => doc.data());

            // 🔎 Cargar ingresos
            const ingresosSnap = await companyRef.collection("ingresos").get();
            const ingresos = ingresosSnap.docs.map((doc) => doc.data());

            // 🔎 Resumen rápido para IA
            dbAnswer = `📊 Empresa: ${companyData.name || "Sin nombre"}
👥 Empleados: ${employees.length}
💰 Ventas registradas: ${sales.length}
🔥 Producto más vendido: ${productoMasVendido} (${cantidadMax} unidades)
📉 Egresos registrados: ${egresos.length}
📈 Ingresos registrados: ${ingresos.length}`;
          }
        } catch (err) {
          console.error("Error Firestore:", err);
          dbAnswer = "⚠️ Error consultando la base de datos.";
        }
      }

      // 🧠 Preparar prompt para OpenAI
      const prompt = dbAnswer
        ? `El usuario dijo: "${message}". Estos son los datos de la empresa:\n${dbAnswer}\nUsa esta información para responder de forma personalizada.`
        : `El usuario dijo: "${message}". Responde como asistente de negocios aunque no tengas datos de Firestore.`;

      // 🚀 Llamada a OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Eres Luci, una asistente experta en negocios y marketing. Siempre responde con datos reales de Firestore si están disponibles. Si no hay datos, responde de forma general como consultora.",
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

/**
 * 🧹 cleanOldMemory
 * Función programada: Limpieza de memoria temporal cada 24h.
 * Elimina documentos de memory/.../history con más de 15 días.
 */

exports.cleanOldMemory = onSchedule("every 24 hours", async () => {
  const cutoff = Date.now() - 15 * 24 * 60 * 60 * 1000; // 15 días
  const companies = await db.collection("companies").get();

  for (const compDoc of companies.docs) {
    const memRef = compDoc.ref.collection("memory");
    const memDocs = await memRef.get();

    for (const memDoc of memDocs.docs) {
      const historyCol = memDoc.ref.collection("history");
      const oldSnap = await historyCol.where("savedAt", "<", cutoff).get();

      if (!oldSnap.empty) {
        const batch = db.batch();
        oldSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        console.log(
          `cleanOldMemory: borradas ${oldSnap.size} entradas en ${compDoc.id}/${memDoc.id}`
        );
      }
    }
  }
});
