// functions/index.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

// Inicializar Firebase Admin
initializeApp();
const auth = getAuth();
const db = getFirestore();

/**
 * Cloud Function HTTPS Callable para crear empleados
 * Solo los administradores pueden usarla.
 */
exports.createEmployee = onCall(async (request) => {
  try {
    // 1. Validar autenticación
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "Debes estar autenticado para usar esta función."
      );
    }

    // 2. Leer datos enviados
    const { email, password, name, companyId, role } = request.data;

    if (!email || !password || !name || !companyId) {
      throw new HttpsError(
        "invalid-argument",
        "Faltan datos requeridos (email, password, name, companyId)."
      );
    }

    // 3. Verificar que el que llama sea admin de esa empresa
    const callerDoc = await db.collection("users").doc(request.auth.uid).get();
    if (!callerDoc.exists) {
      throw new HttpsError("permission-denied", "Usuario no encontrado.");
    }

    const callerData = callerDoc.data();
    if (callerData.role !== "admin" || callerData.companyId !== companyId) {
      throw new HttpsError(
        "permission-denied",
        "No tienes permisos para crear empleados en esta empresa."
      );
    }

    // 4. Crear usuario en Firebase Auth
    const userRecord = await auth.createUser({
      email,
      password,
      displayName: name,
    });

    // 5. Guardar datos en Firestore
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
