// js/admin-panel.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  query,
  orderBy,
  doc,
  getDoc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js";

/* CONFIG FIREBASE */
const firebaseConfig = {
  apiKey: "AIzaSyCTFSlLoKv6KKujTqjMeMjNc-AlKQ2-rng",
  authDomain: "duostyle01-611b9.firebaseapp.com",
  projectId: "duostyle01-611b9",
  storageBucket: "duostyle01-611b9.firebasestorage.app",
  messagingSenderId: "4630065257",
  appId: "1:4630065257:web:11b7b0a0ac2fa776bbf2f8",
  measurementId: "G-FW6QEJMZKT"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

/* HELPERS */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => `$${Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 2 })}`;

/* DOM REFS (defensivo) */
const authOverlay = $("#authOverlay");
const loginForm = $("#loginForm");
const loginEmail = $("#loginEmail");
const loginPass = $("#loginPass");
const btnShowRegister = $("#btnShowRegister");
const registerBox = $("#registerBox");
const registerForm = $("#registerForm");
const regName = $("#regName");
const regEmail = $("#regEmail");
const regPass = $("#regPass");
const btnCancelRegister = $("#btnCancelRegister");

const appDiv = $("#app");
const loggedAs = $("#loggedAs");

const tbCompanies = $("#tbCompanies");
const kCompanies = $("#kCompanies");
const kRevenue = $("#kRevenue");
const kCommissions = $("#kCommissions");
const tbAffiliates = $("#tbAffiliates");
const tbPayments = $("#tbPayments");

const modal = $("#modalRegister");
const btnOpen = $("#btnOpenRegister");
const btnCancel = $("#btnCancel");
const selCompany = $("#selCompany");
const selAffiliate = $("#selAffiliate");
const inpAmount = $("#inpAmount");
const inpMonths = $("#inpMonths");
const inpPromo = $("#inpPromo");
const inpNote = $("#inpNote");
const affiliateFeeRow = $("#affiliateFeeRow");
const affiliateFee = $("#affiliateFee");
const btnSubmit = $("#btnSubmit");
const btnReload = $("#btnReload");
const btnLogout = $("#btnLogout");

const btnNewAffiliate = $("#btnNewAffiliate");
const modalAffiliate = $("#modalAffiliate");
const formAffiliate = $("#formAffiliate");
const btnCancelAffiliate = $("#btnCancelAffiliate");
const btnCreateAffiliate = $("#btnCreateAffiliate");
const affName = $("#affName");
const affPhone = $("#affPhone");
const affIdHidden = $("#affIdHidden");

let companiesCache = [];
let affiliatesCache = [];
let paymentsCache = [];
let revenueChart = null;

/* ---------------- AUTH UI ---------------- */
if (btnShowRegister) btnShowRegister.addEventListener("click", () => registerBox && registerBox.classList.toggle("hidden"));
if (btnCancelRegister) btnCancelRegister.addEventListener("click", () => registerBox && registerBox.classList.add("hidden"));

if (loginForm) {
  loginForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = loginEmail?.value?.trim();
    const pass = loginPass?.value?.trim();
    if (!email || !pass) return alert("Completa email y contraseña.");
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
      console.error("login error", err);
      alert("Error autenticando: " + (err.message || err));
    }
  });
}

if (registerForm) {
  registerForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = regName?.value?.trim();
    const email = regEmail?.value?.trim();
    const pass = regPass?.value?.trim();
    if (!name || !email || !pass) return alert("Completa todos los campos.");
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      const uid = cred.user.uid;
      const cid = `${uid}-company`;
      await setDoc(doc(db, "users", uid), {
        displayName: name,
        email,
        role: "admin",
        planActive: true,
        companyId: cid,
        createdAt: serverTimestamp()
      });
      await setDoc(doc(db, "companies", cid), {
        name: `${name} — Empresa`,
        owners: [{ uid, name }],
        createdAt: serverTimestamp(),
        planActive: true
      });
      await setDoc(doc(db, "companies", cid, "state", "balances"), { cajaEmpresa: 0, deudasTotales: 0 });
      alert("Cuenta creada. Ya puedes iniciar sesión.");
      registerBox && registerBox.classList.add("hidden");
    } catch (err) {
      console.error("register error", err);
      alert("Error creando cuenta: " + (err.message || err));
    }
  });
}

/* ---------------- AUTH STATE ---------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    authOverlay && authOverlay.classList.remove("hidden");
    appDiv && appDiv.classList.add("hidden");
    return;
  }
  authOverlay && authOverlay.classList.add("hidden");
  appDiv && appDiv.classList.remove("hidden");
  if (loggedAs) loggedAs.textContent = `Sesión: ${user.email || user.displayName || user.uid}`;
  await loadAll();
});

/* ---------------- LOGOUT ---------------- */
if (btnLogout) btnLogout.addEventListener("click", async () => {
  await signOut(auth);
});

/* ---------------- BOOT: load sequence ---------------- */
async function loadAll() {
  try {
    await loadCompanies();
    await loadAffiliates();
    await loadRecentPayments();
    computeKPIs();
    renderStats();
  } catch (err) {
    console.error("loadAll error", err);
  }
}

/* =========================
   COMPANIES
   ========================= */
async function loadCompanies() {
  try {
    const q = query(collection(db, "companies"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    companiesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    await computeBalances();
    renderCompanies();
    populateCompanySelect();
  } catch (err) {
    console.error("loadCompanies error", err);
    companiesCache = [];
    renderCompanies();
    populateCompanySelect();
  }
}

async function computeBalances() {
  for (const c of companiesCache) {
    try {
      const compRef = doc(db, "companies", c.id);
      const ingresosSnap = await getDocs(collection(compRef, "ingresos")).catch(() => ({ docs: [] }));
      const egresosSnap = await getDocs(collection(compRef, "egresos")).catch(() => ({ docs: [] }));
      const ventasSnap = await getDocs(collection(compRef, "sales")).catch(() => ({ docs: [] }));

      const ingresos = ingresosSnap.docs.reduce((s, d) => s + Number(d.data().amount ?? d.data().monto ?? 0), 0);
      const egresos = egresosSnap.docs.reduce((s, d) => s + Number(d.data().amount ?? d.data().monto ?? 0), 0);
      const ventas = ventasSnap.docs.reduce((s, d) => s + Number(d.data().total ?? d.data().amount ?? 0), 0);

      c.balance = ingresos + ventas - egresos;
    } catch (err) {
      console.warn("Error calculando saldo empresa:", c.id, err);
      c.balance = 0;
    }
  }
}

function renderCompanies() {
  if (!tbCompanies) return;
  tbCompanies.innerHTML = "";
  companiesCache.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(c.name || c.id)}</td>
      <td>${escapeHtml(c.planId || (c.price ? `${c.price}` : '-'))}</td>
      <td>${escapeHtml(c.subscriptionStatus || '—')}</td>
      <td>${c.subscriptionEndsAt ? (c.subscriptionEndsAt.seconds ? new Date(c.subscriptionEndsAt.seconds * 1000).toLocaleDateString() : c.subscriptionEndsAt) : '-'}</td>
      <td>${money(c.balance || 0)}</td>
      <td>
        <button class="px-2 py-1 border rounded btnView" data-id="${c.id}">Ver</button>
        <button class="px-2 py-1 border rounded btnInvoices" data-id="${c.id}">Facturas</button>
      </td>`;
    tbCompanies.appendChild(tr);
  });

  $$(".btnView").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    try {
      const d = await getDoc(doc(db, "companies", id));
      alert(JSON.stringify(d.data(), null, 2));
    } catch (err) {
      console.error("btnView error", err);
      alert("Error cargando empresa: " + (err.message || err));
    }
  });

  $$(".btnInvoices").forEach(b => b.onclick = async () => {
    alert("Para descargar facturas use los botones PDF en la lista de pagos.");
  });
}

function populateCompanySelect() {
  if (!selCompany) return;
  selCompany.innerHTML = "";
  companiesCache.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.text = `${c.name || c.id}`;
    selCompany.appendChild(opt);
  });
}

/* =========================
   AFFILIATES
   ========================= */
async function loadAffiliates() {
  try {
    const q = query(collection(db, "affiliates"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    affiliatesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAffiliates();
    populateAffiliateSelect();
  } catch (err) {
    console.warn("loadAffiliates:", err);
    affiliatesCache = [];
    renderAffiliates();
    populateAffiliateSelect();
  }
}

function renderAffiliates() {
  if (!tbAffiliates) return;
  tbAffiliates.innerHTML = "";
  affiliatesCache.forEach(a => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(a.name || a.id)}</td>
      <td>${escapeHtml(a.phone || '-')}</td>
      <td>${money(a.balanceOwed || 0)}</td>
      <td>
        <button class="px-2 py-1 border rounded btnPay" data-id="${a.id}">Marcar pago</button>
        <button class="px-2 py-1 border rounded btnEditAff" data-id="${a.id}">Editar</button>
        <button class="px-2 py-1 border rounded btnDelAff" data-id="${a.id}">Eliminar</button>
      </td>`;
    tbAffiliates.appendChild(tr);
  });

  $$(".btnPay").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    if (!confirm("Marcar saldo como pagado?")) return;
    try {
      await setDoc(doc(db, "affiliates", id), { balanceOwed: 0 }, { merge: true });
      await loadAffiliates();
    } catch (err) {
      console.error("mark pay error", err);
      alert("Error marcando pago: " + (err.message || err));
    }
  });

  $$(".btnEditAff").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    const a = affiliatesCache.find(x => x.id === id);
    if (!a) return alert("Afiliado no encontrado");
    affIdHidden && (affIdHidden.value = id);
    affName && (affName.value = a.name || "");
    affPhone && (affPhone.value = a.phone || "");
    modalAffiliate && modalAffiliate.classList.remove("hidden");
  });

  $$(".btnDelAff").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    if (!confirm("Eliminar afiliado? Esto no eliminará pagos previos pero sí quitará el registro.")) return;
    try {
      await deleteDoc(doc(db, "affiliates", id));
      await loadAffiliates();
    } catch (err) {
      console.error("delete affiliate", err);
      alert("Error eliminando afiliado: " + (err.message || err));
    }
  });
}

function populateAffiliateSelect() {
  if (!selAffiliate) return;
  selAffiliate.innerHTML = `<option value="">— Ninguno —</option>`;
  affiliatesCache.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.text = `${a.name || a.id} (${money(a.balanceOwed || 0)})`;
    selAffiliate.appendChild(opt);
  });
}

/* CREATE / UPDATE AFFILIATE (modal) */
if (btnNewAffiliate) btnNewAffiliate.addEventListener("click", () => {
  affIdHidden && (affIdHidden.value = "");
  affName && (affName.value = "");
  affPhone && (affPhone.value = "");
  modalAffiliate && modalAffiliate.classList.remove("hidden");
});
if (btnCancelAffiliate) btnCancelAffiliate.addEventListener("click", () => modalAffiliate && modalAffiliate.classList.add("hidden"));

if (formAffiliate) {
  formAffiliate.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await createOrUpdateAffiliate();
  });
}
if (btnCreateAffiliate) {
  btnCreateAffiliate.addEventListener("click", async (ev) => {
    ev.preventDefault();
    await createOrUpdateAffiliate();
  });
}

async function createOrUpdateAffiliate() {
  const name = affName?.value?.trim();
  const phone = affPhone?.value?.trim() || null;
  const id = affIdHidden?.value || null;
  if (!name) return alert("Nombre requerido");
  try {
    if (id) {
      await updateDoc(doc(db, "affiliates", id), { name, phone });
      alert("Afiliado actualizado");
    } else {
      const res = await addDoc(collection(db, "affiliates"), { name, phone, balanceOwed: 0, createdAt: serverTimestamp() });
      alert("Afiliado creado: " + res.id);
    }
    modalAffiliate && modalAffiliate.classList.add("hidden");
    await loadAffiliates();
  } catch (err) {
    console.error("createOrUpdateAffiliate error", err);
    alert("Error creando/actualizando afiliado: " + (err.message || err));
  }
}

/* =========================
   PAYMENTS: carga y render
   ========================= */
async function loadRecentPayments() {
  try {
    const payments = [];
    for (const c of companiesCache) {
      const companyRef = doc(db, "companies", c.id);
      const ps = await getDocs(query(collection(companyRef, "payments"), orderBy("createdAt", "desc"))).catch(() => ({ docs: [] }));
      ps.docs.forEach(d => payments.push({ companyId: c.id, id: d.id, ...d.data() }));
    }
    payments.sort((a, b) => {
      const ta = a.createdAt?.seconds ? a.createdAt.seconds : 0;
      const tb = b.createdAt?.seconds ? b.createdAt.seconds : 0;
      return tb - ta;
    });
    paymentsCache = payments;
    renderPayments(payments.slice(0, 200));
  } catch (err) {
    console.error("loadRecentPayments error:", err);
    paymentsCache = [];
    if (tbPayments) tbPayments.innerHTML = `<tr><td colspan="7">Error cargando pagos.</td></tr>`;
  }
}

function renderPayments(arr) {
  if (!tbPayments) return;
  tbPayments.innerHTML = "";
  arr.forEach(p => {
    const dateText = p.createdAt && p.createdAt.seconds ? new Date(p.createdAt.seconds * 1000).toLocaleString() : '-';
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${dateText}</td>
      <td>${escapeHtml(p.companyId || '-')}</td>
      <td>${money(p.amount ?? p.monto ?? 0)}</td>
      <td>${p.monthsPaid || p.months || 0}</td>
      <td>${escapeHtml(p.affiliateId || p.sellerId || p.affiliateName || '-')}</td>
      <td>${money(p.affiliateFee || 0)}</td>
      <td>
        <button class="px-2 py-1 border rounded btnInvoice" data-company="${p.companyId}" data-id="${p.id}">PDF</button>
        <button class="px-2 py-1 border rounded btnEditPayment" data-company="${p.companyId}" data-id="${p.id}">Editar</button>
        <button class="px-2 py-1 border rounded btnDelPayment" data-company="${p.companyId}" data-id="${p.id}">Eliminar</button>
      </td>`;
    tbPayments.appendChild(tr);
  });

  $$(".btnInvoice").forEach(b => b.onclick = async () => {
    alert("Descarga PDF via cloud function (si existe).");
  });

  $$(".btnEditPayment").forEach(b => b.onclick = async () => {
    const cid = b.dataset.company;
    const id = b.dataset.id;
    const p = paymentsCache.find(x => x.companyId === cid && x.id === id);
    if (!p) return alert("Pago no encontrado");
    selCompany && (selCompany.value = cid);
    inpAmount && (inpAmount.value = p.amount ?? p.monto ?? 0);
    inpMonths && (inpMonths.value = p.monthsPaid ?? p.months ?? 1);
    inpPromo && (inpPromo.value = p.promoCode || "");
    selAffiliate && (selAffiliate.value = p.affiliateId || "");
    if (affiliateFee) affiliateFee.value = p.affiliateFee || 0;
    inpNote && (inpNote.value = p.note || p.createdByNote || "");
    if (modal) {
      modal.dataset.editingCompany = cid;
      modal.dataset.editingPayment = id;
    }
    if (affiliateFeeRow && selAffiliate) affiliateFeeRow.classList.toggle("hidden", !selAffiliate.value);
    modal && modal.classList.remove("hidden");
  });

  $$(".btnDelPayment").forEach(b => b.onclick = async () => {
    const cid = b.dataset.company;
    const id = b.dataset.id;
    if (!confirm("Eliminar pago? Esto ajustará saldos (se intentará revertir el pago).")) return;
    try {
      await deletePaymentWithAdjust(cid, id);
      alert("Pago eliminado y saldos ajustados (si aplica).");
      await loadAll();
    } catch (err) {
      console.error("delete payment", err);
      alert("Error eliminando pago: " + (err.message || err));
    }
  });
}

/* =========================
   INVOKE RECORD PAYMENT
   - addDoc (fuera tx) para crear pago
   - luego runTransaction donde SE HACEN TODAS LAS LECTURAS PRIMERO y despues las escrituras
   ========================= */
async function invokeRecordPayment(payload) {
  try {
    const { companyId, amount, monthsPaid, promoCode, affiliateId, affiliateFee = 0, createdByNote } = payload;

    // 1) crear documento de pago fuera de la transacción (para no bloquear)
    const paymentRef = await addDoc(collection(db, "companies", companyId, "payments"), {
      amount,
      monthsPaid,
      promoCode: promoCode || null,
      affiliateId: affiliateId || null,
      affiliateFee: affiliateFee || 0,
      note: createdByNote || null,
      createdAt: serverTimestamp()
    });
    const paymentId = paymentRef.id;

    // 2) transacción: LEER primero todo lo necesario, luego escribir
    await runTransaction(db, async (tx) => {
      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const compRef = doc(db, "companies", companyId);
      const affRef = affiliateId ? doc(db, "affiliates", affiliateId) : null;

      // READS (todos antes de las escrituras)
      const balancesSnap = await tx.get(balancesRef);
      const compSnap = await tx.get(compRef);
      const affSnap = affRef ? await tx.get(affRef) : null;

      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;
      const oldAffBal = affSnap ? (affSnap.exists() ? Number(affSnap.data().balanceOwed || 0) : 0) : 0;

      const newCaja = oldCaja + Number(amount || 0);

      // WRITES (después de todas las lecturas)
      if (balancesSnap.exists()) {
        tx.update(balancesRef, { cajaEmpresa: newCaja });
      } else {
        tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });
      }

      // movimiento
      const movRef = doc(collection(db, "companies", companyId, "movements"));
      tx.set(movRef, {
        tipo: "ingreso",
        cuenta: "cajaEmpresa",
        fecha: new Date().toISOString().slice(0, 10),
        monto: amount,
        desc: `Pago ID ${paymentId}`,
        paymentId,
        createdAt: serverTimestamp()
      });

      // actualizar datos de empresa (estado suscripción y cashBalance)
      const nextDueDate = Timestamp.fromDate(new Date(Date.now() + (Number(monthsPaid || 0) * 30 * 24 * 60 * 60 * 1000)));
      tx.set(compRef, {
        subscriptionStatus: "activo",
        subscriptionEndsAt: nextDueDate,
        cashBalance: newCaja
      }, { merge: true });

      // ajustar afiliado (si corresponde)
      if (affiliateId && Number(affiliateFee || 0) > 0) {
        // affSnap ya leído arriba
        tx.set(affRef, { balanceOwed: oldAffBal + Number(affiliateFee || 0) }, { merge: true });
      }
    });

    return { success: true, paymentId };
  } catch (err) {
    console.error("Fallback recordPayment error:", err);
    throw err;
  }
}

/* -------------------------
   MODAL: abrir / cerrar / submit
   ------------------------- */
const formRegister = document.getElementById("formRegister");
if (formRegister) {
  formRegister.addEventListener("submit", async (ev) => {
    ev.preventDefault(); // importante: evita recarga
    await submitRegister();
  });
}

if (btnOpen) btnOpen.addEventListener("click", () => {
  if (modal) {
    delete modal.dataset.editingPayment;
    delete modal.dataset.editingCompany;
  }
  if (selCompany) selCompany.value = companiesCache[0]?.id || "";
  if (inpAmount) inpAmount.value = 80000;
  if (inpMonths) inpMonths.value = 1;
  if (inpPromo) inpPromo.value = "";
  if (selAffiliate) selAffiliate.value = "";
  if (affiliateFee) affiliateFee.value = 0;
  if (affiliateFeeRow) affiliateFeeRow.classList.add("hidden");
  if (inpNote) inpNote.value = "";
  modal && modal.classList.remove("hidden");
});

if (btnCancel) btnCancel.addEventListener("click", () => {
  modal && modal.classList.add("hidden");
  if (modal) {
    delete modal.dataset.editingPayment;
    delete modal.dataset.editingCompany;
  }
});

if (btnReload) btnReload.addEventListener("click", () => loadAll());

if (selAffiliate) selAffiliate.addEventListener("change", () => {
  if (!selAffiliate) return;
  if (affiliateFeeRow) {
    if (selAffiliate.value) affiliateFeeRow.classList.remove("hidden");
    else affiliateFeeRow.classList.add("hidden");
  }
});

/* -------------------------
   SUBMIT REGISTER (crear o editar pago)
   ------------------------- */
async function submitRegister() {
  const companyId = selCompany?.value;
  const amount = Number(inpAmount?.value || 0);
  const monthsPaid = Number(inpMonths?.value || 0);
  const promoCode = inpPromo?.value?.trim() || null;
  const affiliateId = selAffiliate?.value || null;
  const affiliateFeeVal = Number((affiliateFee && affiliateFee.value) || 0);
  const note = inpNote?.value || null;

  if (!companyId || !amount || monthsPaid <= 0) return alert("Completa campos obligatorios: empresa, monto y meses.");

  const editingPayment = modal?.dataset?.editingPayment;
  const editingCompany = modal?.dataset?.editingCompany;

  try {
    if (editingPayment && editingCompany) {
      await editPaymentWithAdjust(editingCompany, editingPayment, {
        amount, monthsPaid, promoCode, affiliateId, affiliateFee: affiliateFeeVal, note
      });
      alert("Pago editado correctamente.");
      modal && modal.classList.add("hidden");
      delete modal.dataset.editingPayment;
      delete modal.dataset.editingCompany;
      await loadAll();
      return;
    }

    const payload = { companyId, amount, monthsPaid, promoCode, affiliateId, affiliateFee: affiliateFeeVal, createdByNote: note };
    const res = await invokeRecordPayment(payload);
    if (res && res.success) {
      alert("Pago registrado: " + res.paymentId);
      modal && modal.classList.add("hidden");
      await loadAll();
    } else {
      throw new Error("Error guardando pago (respuesta inesperada).");
    }
  } catch (err) {
    console.error("submitRegister error", err);
    alert("Error registrando pago: " + (err.message || err));
  }
}

/* =========================
   EDIT PAYMENT WITH ADJUST
   - Se aseguran lecturas antes de escrituras
   ========================= */
async function editPaymentWithAdjust(companyId, paymentId, newData) {
  try {
    await runTransaction(db, async (tx) => {
      const payRef = doc(db, "companies", companyId, "payments", paymentId);
      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const compRef = doc(db, "companies", companyId);

      // Old and new affiliate refs (si existen)
      const oldPaySnap = await tx.get(payRef);
      if (!oldPaySnap.exists()) throw new Error("Pago no encontrado");
      const old = oldPaySnap.data();

      const oldAff = old.affiliateId || null;
      const newAff = newData.affiliateId || null;

      const affRefOld = oldAff ? doc(db, "affiliates", oldAff) : null;
      const affRefNew = newAff ? doc(db, "affiliates", newAff) : null;

      // READS: balances + affiliate snaps + company
      const balancesSnap = await tx.get(balancesRef);
      const compSnap = await tx.get(compRef);
      const affSnapOld = affRefOld ? await tx.get(affRefOld) : null;
      const affSnapNew = affRefNew ? await tx.get(affRefNew) : null;

      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;
      const oldAmount = Number(old.amount ?? old.monto ?? 0);
      const newAmount = Number(newData.amount ?? newData.monto ?? 0);
      const diff = newAmount - oldAmount;

      const oldAffFee = Number(old.affiliateFee || 0);
      const newAffFee = Number(newData.affiliateFee || 0);

      // Compute new balances
      const newCaja = oldCaja + diff;

      // WRITES: update payment, balances, movement, affiliates, company
      tx.update(payRef, {
        amount: newAmount,
        monthsPaid: newData.monthsPaid || old.monthsPaid || old.months || 1,
        promoCode: newData.promoCode || old.promoCode || null,
        affiliateId: newData.affiliateId || null,
        affiliateFee: newData.affiliateFee || old.affiliateFee || 0,
        note: newData.note || old.note || null,
        updatedAt: serverTimestamp()
      });

      if (balancesSnap.exists()) tx.update(balancesRef, { cajaEmpresa: newCaja });
      else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });

      const movRef = doc(collection(db, "companies", companyId, "movements"));
      tx.set(movRef, {
        tipo: diff >= 0 ? "ingreso" : "egreso",
        cuenta: "cajaEmpresa",
        fecha: new Date().toISOString().slice(0, 10),
        monto: Math.abs(diff),
        desc: `Ajuste pago ${paymentId} (edit)`,
        paymentId,
        createdAt: serverTimestamp()
      });

      // Affiliate adjustments
      if (oldAff && oldAff === newAff) {
        // same affiliate -> adjust delta
        const delta = newAffFee - oldAffFee;
        if (delta !== 0 && affSnapOld) {
          const oldBal = affSnapOld.exists() ? Number(affSnapOld.data().balanceOwed || 0) : 0;
          tx.update(affRefOld, { balanceOwed: oldBal + delta });
        }
      } else {
        if (oldAff && oldAffFee && affSnapOld) {
          const oldBal = affSnapOld.exists() ? Number(affSnapOld.data().balanceOwed || 0) : 0;
          tx.update(affRefOld, { balanceOwed: Math.max(0, oldBal - oldAffFee) });
        }
        if (newAff && newAffFee) {
          const newBal = affSnapNew && affSnapNew.exists() ? Number(affSnapNew.data().balanceOwed || 0) : 0;
          tx.set(affRefNew, { balanceOwed: newBal + newAffFee }, { merge: true });
        }
      }

      // Company subscription adjustment
      const currentSubEnds = compSnap.exists() ? compSnap.data()?.subscriptionEndsAt : null;
      let nextDueDate = currentSubEnds && currentSubEnds.seconds ? new Date(currentSubEnds.seconds * 1000) : new Date();
      nextDueDate = new Date(nextDueDate.getTime() + (Number(newData.monthsPaid || 0) * 30 * 24 * 60 * 60 * 1000));
      tx.update(compRef, { subscriptionEndsAt: Timestamp.fromDate(nextDueDate), cashBalance: newCaja }, { merge: true });
    });
  } catch (err) {
    console.error("editPaymentWithAdjust error", err);
    throw err;
  }
}

/* =========================
   DELETE PAYMENT WITH ADJUST
   - Lecturas antes de escrituras
   ========================= */
async function deletePaymentWithAdjust(companyId, paymentId) {
  try {
    await runTransaction(db, async (tx) => {
      const payRef = doc(db, "companies", companyId, "payments", paymentId);
      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const compRef = doc(db, "companies", companyId);

      // READS
      const paySnap = await tx.get(payRef);
      if (!paySnap.exists()) throw new Error("Pago no encontrado");
      const pay = paySnap.data();

      const balancesSnap = await tx.get(balancesRef);
      const affRef = pay.affiliateId ? doc(db, "affiliates", pay.affiliateId) : null;
      const affSnap = affRef ? await tx.get(affRef) : null;

      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;
      const amt = Number(pay.amount ?? pay.monto ?? 0);
      const newCaja = oldCaja - amt;

      // WRITES
      if (balancesSnap.exists()) tx.update(balancesRef, { cajaEmpresa: newCaja });
      else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });

      const movRef = doc(collection(db, "companies", companyId, "movements"));
      tx.set(movRef, {
        tipo: "egreso",
        cuenta: "cajaEmpresa",
        fecha: new Date().toISOString().slice(0, 10),
        monto: amt,
        desc: `Eliminación pago ${paymentId}`,
        paymentId,
        createdAt: serverTimestamp()
      });

      if (affRef && affSnap && affSnap.exists()) {
        const oldBal = Number(affSnap.data().balanceOwed || 0);
        const affFee = Number(pay.affiliateFee || 0);
        tx.update(affRef, { balanceOwed: Math.max(0, oldBal - affFee) });
      }

      tx.delete(payRef);

      const compSnap = await tx.get(compRef);
      if (compSnap.exists()) {
        tx.update(compRef, { cashBalance: newCaja });
      }
    });
  } catch (err) {
    console.error("deletePaymentWithAdjust", err);
    throw err;
  }
}

/* =========================
   KPIs
   ========================= */
function computeKPIs() {
  if (kCompanies) kCompanies.textContent = companiesCache.length;
  if (kRevenue) kRevenue.textContent = money(paymentsCache.reduce((s, p) => s + Number(p.amount ?? p.monto ?? 0), 0));
  const totalComm = affiliatesCache.reduce((s, a) => s + (Number(a.balanceOwed || 0)), 0);
  if (kCommissions) kCommissions.textContent = money(totalComm);
}

/* =========================
   STATS (Chart.js)
   ========================= */
function renderStats() {
  const canvas = document.getElementById("chartRevenue");
  if (!canvas) return;
  const monthly = {};
  paymentsCache.forEach(p => {
    const secs = p.createdAt?.seconds;
    if (!secs) return;
    const d = new Date(secs * 1000);
    const key = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
    monthly[key] = (monthly[key] || 0) + Number(p.amount ?? p.monto ?? 0);
  });
  const labels = Object.keys(monthly).sort();
  const data = labels.map(l => monthly[l]);

  try {
    if (revenueChart) {
      revenueChart.destroy();
      revenueChart = null;
    }
  } catch (e) {
    console.warn("destroy chart err", e);
  }

  const ctx = canvas.getContext("2d");
  revenueChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [{ label: "Ingresos", data, borderColor: "rgb(16,185,129)", backgroundColor: "rgba(16,185,129,0.12)", fill: true }] },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

/* =========================
   UTILS
   ========================= */
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"'`=\/]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;' }[c]));
}

/* BOOTSTRAP CLIENT TABS */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tablink").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tabcontent").forEach(tab => tab.classList.add("hidden"));
      document.querySelectorAll(".tablink").forEach(b => b.classList.remove("border-emerald-600", "text-emerald-600"));
      const target = document.getElementById("tab-" + btn.dataset.tab);
      btn.classList.add("border-emerald-600", "text-emerald-600");
      if (target) target.classList.remove("hidden");
    });
  });
  const defaultTab = document.querySelector(".tablink[data-tab='dashboard']");
  if (defaultTab) defaultTab.click();
});
