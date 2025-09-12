// functions/index.js
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");
const OpenAI = require("openai");
const PDFDocument = require("pdfkit"); // para generar PDFs en server
const { Buffer } = require("buffer");

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

          if (!companySnap.exists()) {
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

/* =============================
   NUEVAS FUNCIONES AÑADIDAS
   - recordPayment
   - updateCompanyPlan
   - generateInvoice
   - calculateCommissions
   ============================= */

/**
 * 💰 recordPayment
 * Callable: Registra un pago (manual o reconciliado), actualiza subscription/activeUntil,
 * guarda referencia de seller/affiliate si aplica y deja movimiento en company/{companyId}/movements.
 *
 * request.data = {
 *   companyId: string,
 *   amount: number,
 *   monthsPaid: number,
 *   promoCode?: string,         // e.g. "PAY2GET3"
 *   affiliateId?: string,       // quien trajo la empresa
 *   sellerId?: string,          // vendedor que hizo la venta
 *   createdByNote?: string
 * }
 */
exports.recordPayment = onCall(async (request) => {
  try {
    if (!request.auth) throw new HttpsError("unauthenticated", "Debes estar autenticado.");
    const callerUid = request.auth.uid;
    const data = request.data || {};

    const companyId = data.companyId;
    const amount = Number(data.amount || 0);
    const monthsPaid = Number(data.monthsPaid || 0);
    const promoCode = data.promoCode || null;
    const affiliateId = data.affiliateId || null;
    const sellerId = data.sellerId || null;
    const createdByNote = data.createdByNote || null;

    if (!companyId || amount <= 0 || monthsPaid <= 0) {
      throw new HttpsError("invalid-argument", "companyId, amount y monthsPaid son obligatorios.");
    }

    // permiso simple: que el caller exista en users (más validaciones si deseas)
    const callerDoc = await db.collection("users").doc(callerUid).get();
    if (!callerDoc.exists) throw new HttpsError("permission-denied", "Usuario no encontrado.");

    // lógica promo: PAY2GET3 -> por cada 2 pagados, 1 gratis
    let monthsGranted = monthsPaid;
    if (promoCode && String(promoCode).toUpperCase() === "PAY2GET3") {
      const extra = Math.floor(monthsPaid / 2);
      monthsGranted = monthsPaid + extra;
    }

    // calcular affiliate split (ejemplo: afiliado obtiene 30k por mes pagado)
    const AFFILIATE_FIXED_PER_MONTH = 30000;
    let affiliateAmount = 0;
    let ownerAmount = amount;
    if (affiliateId) {
      affiliateAmount = AFFILIATE_FIXED_PER_MONTH * monthsPaid;
      ownerAmount = amount - affiliateAmount;
      if (ownerAmount < 0) ownerAmount = 0;
    }

    // Payment doc in company payments subcollection
    const paymentRef = db.collection("companies").doc(companyId).collection("payments").doc();
    const paymentDoc = {
      amount,
      monthsPaid,
      monthsGranted,
      promoCode: promoCode || null,
      affiliateId: affiliateId || null,
      sellerId: sellerId || null,
      affiliateAmount,
      ownerAmount,
      createdBy: callerUid,
      createdAt: FieldValue.serverTimestamp(),
      note: createdByNote || null
    };

    // Transaction: write payment, update subscription, balances, affiliate balance, movements
    await db.runTransaction(async (tx) => {
      tx.set(paymentRef, paymentDoc);

      // subscription doc: subscriptions/{companyId}
      const subRef = db.collection("subscriptions").doc(companyId);
      const subSnap = await tx.get(subRef);
      let newStart = FieldValue.serverTimestamp();
      let newEnd = null;

      if (subSnap.exists) {
        const sub = subSnap.data();
        // choose base date for extension: existing endDate if in future else now
        const existingEnd = sub.endDate && sub.endDate.toDate ? sub.endDate.toDate() : null;
        let baseDate = new Date();
        if (existingEnd && existingEnd > baseDate) baseDate = existingEnd;
        const endDateObj = new Date(baseDate);
        endDateObj.setMonth(endDateObj.getMonth() + monthsGranted);
        newEnd = endDateObj;
        tx.update(subRef, {
          monthsPaid: (Number(sub.monthsPaid || 0) + monthsPaid),
          monthsGranted: (Number(sub.monthsGranted || 0) + monthsGranted),
          status: "active",
          endDate: Timestamp.fromDate(endDateObj),
          updatedAt: FieldValue.serverTimestamp()
        });
      } else {
        const startDateObj = new Date();
        const endDateObj = new Date();
        endDateObj.setMonth(endDateObj.getMonth() + monthsGranted);
        newEnd = endDateObj;
        tx.set(subRef, {
          companyId,
          planId: null,
          monthsPaid: monthsPaid,
          monthsGranted: monthsGranted,
          status: "active",
          startDate: FieldValue.serverTimestamp(),
          endDate: Timestamp.fromDate(endDateObj),
          createdAt: FieldValue.serverTimestamp()
        });
      }

      // Movements (company-level) and balances
      const balancesRef = db.collection("companies").doc(companyId).collection("state").doc("balances");
      const balancesSnap = await tx.get(balancesRef);
      const oldCaja = balancesSnap.exists ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;
      const newCaja = oldCaja + Number(amount);

      const movRef = db.collection("companies").doc(companyId).collection("movements").doc();
      tx.set(movRef, {
        tipo: "ingreso",
        cuenta: "cajaEmpresa",
        fecha: new Date().toISOString().slice(0,10),
        monto: amount,
        desc: `Pago ${paymentRef.id} (meses: ${monthsPaid}, promo: ${promoCode || '-'})`,
        paymentId: paymentRef.id,
        createdAt: FieldValue.serverTimestamp()
      });

      if (balancesSnap.exists) tx.update(balancesRef, { cajaEmpresa: newCaja });
      else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: FieldValue.serverTimestamp() });

      // Update affiliate balanceOwed
      if (affiliateId && affiliateAmount > 0) {
        const affRef = db.collection("affiliates").doc(affiliateId);
        const affSnap = await tx.get(affRef);
        if (affSnap.exists) {
          const cur = Number(affSnap.data().balanceOwed || 0);
          tx.update(affRef, { balanceOwed: cur + affiliateAmount });
        } else {
          tx.set(affRef, { balanceOwed: affiliateAmount, createdAt: FieldValue.serverTimestamp(), referredCount: 1 });
        }
      }

      // Audit
      const auditRef = db.collection("auditLogs").doc();
      tx.set(auditRef, {
        action: "recordPayment",
        paymentId: paymentRef.id,
        companyId,
        performedBy: callerUid,
        data: paymentDoc,
        createdAt: FieldValue.serverTimestamp()
      });

      // Optionally update companies doc summary
      const companyDocRef = db.collection("companies").doc(companyId);
      const companySnap = await tx.get(companyDocRef);
      if (companySnap.exists) {
        tx.update(companyDocRef, { subscriptionStatus: "active", subscriptionEndsAt: newEnd ? Timestamp.fromDate(newEnd) : FieldValue.serverTimestamp() });
      } else {
        tx.set(companyDocRef, { name: `Empresa ${companyId}`, subscriptionStatus: "active", subscriptionEndsAt: newEnd ? Timestamp.fromDate(newEnd) : FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() });
      }
    });

    return { success: true, paymentId: paymentRef.id, monthsGranted };
  } catch (error) {
    console.error("recordPayment error:", error);
    throw new HttpsError("internal", error.message || "Error registrando pago.");
  }
});

/**
 * 📝 updateCompanyPlan
 * Callable: cambiar precio de plan, añadir meses o setear fecha de expiración manualmente.
 * request.data = { companyId, newPrice?, addMonths?, setEndDateISO? }
 */
exports.updateCompanyPlan = onCall(async (request) => {
  try {
    if (!request.auth) throw new HttpsError("unauthenticated", "Autenticación requerida.");
    const callerUid = request.auth.uid;
    const { companyId, newPrice, addMonths, setEndDateISO } = request.data;
    if (!companyId) throw new HttpsError("invalid-argument", "companyId requerido.");

    // optional permission checks (caller admin)
    const userSnap = await db.collection("users").doc(callerUid).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    if (!userData) throw new HttpsError("permission-denied", "Usuario no encontrado.");

    // update company doc
    const compRef = db.collection("companies").doc(companyId);
    const compSnap = await compRef.get();
    if (!compSnap.exists) throw new HttpsError("not-found", "Empresa no encontrada.");

    const updates = {};
    if (typeof newPrice !== "undefined") updates.price = Number(newPrice);
    if (addMonths) {
      // compute new endDate based on existing
      const existingEnd = compSnap.data().subscriptionEndsAt && compSnap.data().subscriptionEndsAt.toDate ? compSnap.data().subscriptionEndsAt.toDate() : null;
      const base = existingEnd && existingEnd > new Date() ? existingEnd : new Date();
      const newDate = new Date(base);
      newDate.setMonth(newDate.getMonth() + Number(addMonths));
      updates.subscriptionEndsAt = Timestamp.fromDate(newDate);
    }
    if (setEndDateISO) {
      const d = new Date(setEndDateISO);
      if (!isNaN(d)) updates.subscriptionEndsAt = Timestamp.fromDate(d);
    }

    if (Object.keys(updates).length === 0) throw new HttpsError("invalid-argument", "Nada para actualizar.");

    await compRef.update({ ...updates, updatedAt: FieldValue.serverTimestamp() });

    // audit
    await db.collection("auditLogs").add({
      action: "updateCompanyPlan",
      companyId,
      updatedBy: callerUid,
      updates,
      createdAt: FieldValue.serverTimestamp()
    });

    return { success: true, updates };
  } catch (error) {
    console.error("updateCompanyPlan error:", error);
    throw new HttpsError("internal", error.message || "Error actualizando plan");
  }
});

/**
 * 📄 generateInvoice
 * Callable: genera factura PDF (retorna base64)
 * request.data = { companyId, paymentId }
 */
exports.generateInvoice = onCall(async (request) => {
  try {
    if (!request.auth) throw new HttpsError("unauthenticated", "Autenticación requerida.");
    const { companyId, paymentId } = request.data;
    if (!companyId || !paymentId) throw new HttpsError("invalid-argument", "Faltan datos.");

    const payRef = db.collection("companies").doc(companyId).collection("payments").doc(paymentId);
    const paySnap = await payRef.get();
    if (!paySnap.exists) throw new HttpsError("not-found", "Pago no encontrado.");

    const payment = paySnap.data();

    // company info (optional)
    const compSnap = await db.collection("companies").doc(companyId).get();
    const company = compSnap.exists ? compSnap.data() : { name: companyId };

    // create PDF using pdfkit in memory
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const buffers = [];
    doc.on("data", (chunk) => buffers.push(chunk));
    doc.on("end", () => {});

    // header
    doc.fontSize(18).text("Factura - Luci", { align: "center" });
    doc.moveDown();
    doc.fontSize(12).text(`Empresa: ${company.name || companyId}`);
    doc.text(`ID Pago: ${paymentId}`);
    if (payment.sellerId) doc.text(`Vendedor: ${payment.sellerId}`);
    if (payment.affiliateId) doc.text(`Referido por: ${payment.affiliateId}`);
    doc.text(`Monto: $${Number(payment.amount).toLocaleString('es-CO')}`);
    doc.text(`Meses pagados: ${payment.monthsPaid}`);
    doc.text(`Meses otorgados: ${payment.monthsGranted || payment.monthsPaid}`);
    doc.text(`Promo: ${payment.promoCode || '-'}`);
    doc.text(`Fecha: ${payment.createdAt ? payment.createdAt.toDate().toLocaleString() : new Date().toLocaleString()}`);
    doc.moveDown();
    doc.text("Gracias por tu compra.", { align: "center" });

    doc.end();

    const pdfBuffer = await new Promise((resolve) => {
      doc.on("end", () => resolve(Buffer.concat(buffers)));
    });

    // return base64 to client
    return { invoiceBase64: pdfBuffer.toString("base64"), filename: `factura_${companyId}_${paymentId}.pdf` };
  } catch (error) {
    console.error("generateInvoice error:", error);
    throw new HttpsError("internal", error.message || "Error generando factura");
  }
});

/**
 * 🤝 calculateCommissions
 * Recorre payments y calcula comisiones por seller/affiliate (ejemplo simplificado).
 */
exports.calculateCommissions = onCall(async (request) => {
  try {
    // opcional: permiso admin
    if (!request.auth) throw new HttpsError("unauthenticated", "Autenticación requerida.");
    const callerUid = request.auth.uid;
    const callerDoc = await db.collection("users").doc(callerUid).get();
    if (!callerDoc.exists) throw new HttpsError("permission-denied", "Usuario no encontrado.");

    // collect payments (collectionGroup)
    const paymentsSnap = await db.collectionGroup("payments").get();
    const byAffiliate = {};
    const bySeller = {};

    paymentsSnap.forEach(doc => {
      const d = doc.data();
      if (d.affiliateId) {
        byAffiliate[d.affiliateId] = (byAffiliate[d.affiliateId] || 0) + (Number(d.affiliateAmount || 0));
      }
      if (d.sellerId) {
        bySeller[d.sellerId] = (bySeller[d.sellerId] || 0) + (Number(d.affiliateAmount || 0)); // if seller earns same as affiliate per month
      }
    });

    return { success: true, byAffiliate, bySeller };
  } catch (error) {
    console.error("calculateCommissions error:", error);
    throw new HttpsError("internal", error.message || "Error calculando comisiones");
  }
});
