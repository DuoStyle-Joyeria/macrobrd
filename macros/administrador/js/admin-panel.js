// js/admin-panel.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

import {
  getFirestore, collection, getDocs, query, orderBy, doc, getDoc,
  addDoc, setDoc, serverTimestamp, runTransaction, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js";

/* ========== CONFIG FIREBASE ========== */
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

// helpers
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => `$${Number(n||0).toLocaleString('es-CO',{maximumFractionDigits:2})}`;

/* DOM refs (defensivo: puede que algunos no existan en HTML) */
const authOverlay = $("#authOverlay");
const loginForm = $("#loginForm");
const loginEmail = $("#loginEmail");
const loginPass  = $("#loginPass");
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
const affiliateFeeRow = $("#affiliateFeeRow"); // opcional, si está en tu HTML
const affiliateFee = $("#affiliateFee"); // opcional, si está en tu HTML
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
const affIdHidden = $("#affIdHidden"); // campo hidden para editar afiliado

// defensiva: si la fila/field de affiliateFee no existe, crear referencia vacía para no romper
if (!affiliateFeeRow && selAffiliate) {
  // No hacemos nada, seguirá sin mostrar fila; el código usa optional chaining
}

let companiesCache = [];
let affiliatesCache = [];
let paymentsCache = [];
let revenueChart = null;

/* ---------------------------
   AUTH: login + optional register
   --------------------------- */
if (btnShowRegister) btnShowRegister.addEventListener("click", (e) => {
  if (registerBox) registerBox.classList.toggle("hidden");
});
if (btnCancelRegister) btnCancelRegister.addEventListener("click", () => {
  if (registerBox) registerBox.classList.add("hidden");
});

if (loginForm) {
  loginForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = loginEmail?.value?.trim();
    const pass = loginPass?.value?.trim();
    if (!email || !pass) return alert("Completa email y contraseña.");
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      // onAuthStateChanged handles UI changes
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
      // create balances doc (state/balances)
      await setDoc(doc(db, "companies", cid, "state", "balances"), { cajaEmpresa: 0, deudasTotales: 0 });
      alert("Cuenta creada. Ya puedes iniciar sesión.");
      if (registerBox) registerBox.classList.add("hidden");
    } catch (err) {
      console.error("register error", err);
      alert("Error creando cuenta: " + (err.message||err));
    }
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // show auth overlay
    if (authOverlay) authOverlay.classList.remove("hidden");
    if (appDiv) appDiv.classList.add("hidden");
    return;
  }
  // hide auth show app
  if (authOverlay) authOverlay.classList.add("hidden");
  if (appDiv) appDiv.classList.remove("hidden");
  if (loggedAs) loggedAs.textContent = `Sesión: ${user.email || user.displayName || user.uid}`;
  await loadAll();
});

/* logout */
if (btnLogout) btnLogout.addEventListener("click", async () => {
  await signOut(auth);
});

/* ---------------------------
   BOOT: load sequence
   --------------------------- */
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

/* ===========================
   COMPANIES
   =========================== */
async function loadCompanies() {
  try {
    const q = query(collection(db, "companies"), orderBy("createdAt","desc"));
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
      // Defensive: guard collections possibly missing
      const ingresosSnap = await getDocs(collection(compRef, "ingresos")).catch(()=>({docs:[]}));
      const egresosSnap = await getDocs(collection(compRef, "egresos")).catch(()=>({docs:[]}));
      const ventasSnap = await getDocs(collection(compRef, "sales")).catch(()=>({docs:[]}));

      const ingresos = ingresosSnap.docs.reduce((s,d)=> s + Number(d.data().amount ?? d.data().monto ?? 0), 0);
      const egresos  = egresosSnap.docs.reduce((s,d)=> s + Number(d.data().amount ?? d.data().monto ?? 0), 0);
      const ventas   = ventasSnap.docs.reduce((s,d)=> s + Number(d.data().total ?? d.data().amount ?? 0), 0);

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
      <td>${c.subscriptionEndsAt ? (c.subscriptionEndsAt.seconds ? new Date(c.subscriptionEndsAt.seconds*1000).toLocaleDateString() : c.subscriptionEndsAt) : '-'}</td>
      <td>${money(c.balance||0)}</td>
      <td>
        <button class="px-2 py-1 border rounded btnView" data-id="${c.id}">Ver</button>
        <button class="px-2 py-1 border rounded btnInvoices" data-id="${c.id}">Facturas</button>
      </td>`;
    tbCompanies.appendChild(tr);
  });

  $$(".btnView").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    try {
      const d = await getDoc(doc(db,"companies",id));
      alert(JSON.stringify(d.data(), null, 2));
    } catch (err) {
      console.error("btnView error", err);
      alert("Error cargando empresa: " + (err.message||err));
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

/* ===========================
   AFILIADOS (solo nombre + telefono)
   =========================== */
async function loadAffiliates() {
  try {
    const q = query(collection(db,"affiliates"), orderBy("createdAt","desc"));
    const snap = await getDocs(q);
    affiliatesCache = snap.docs.map(d=>({ id: d.id, ...d.data() }));
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
    tr.innerHTML = `<td>${escapeHtml(a.name||a.id)}</td>
      <td>${escapeHtml(a.phone||'-')}</td>
      <td>${money(a.balanceOwed||0)}</td>
      <td>
        <button class="px-2 py-1 border rounded btnEditAff" data-id="${a.id}">Editar</button>
        <button class="px-2 py-1 border rounded btnDelAff" data-id="${a.id}">Eliminar</button>
      </td>`;
    tbAffiliates.appendChild(tr);
  });

  $$(".btnEditAff").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    const a = affiliatesCache.find(x=>x.id===id);
    if (!a) return alert("Afiliado no encontrado");
    if (affIdHidden) affIdHidden.value = id;
    if (affName) affName.value = a.name || "";
    if (affPhone) affPhone.value = a.phone || "";
    if (modalAffiliate) modalAffiliate.classList.remove("hidden");
  });

  $$(".btnDelAff").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    if (!confirm("Eliminar afiliado? Esto no eliminará pagos previos pero sí quitará el registro.")) return;
    try {
      await deleteDoc(doc(db,"affiliates",id));
      alert("Afiliado eliminado");
      await loadAffiliates();
    } catch (err) {
      console.error("delete affiliate", err);
      alert("Error eliminando afiliado: " + (err.message||err));
    }
  });
}

function populateAffiliateSelect() {
  if (!selAffiliate) return;
  selAffiliate.innerHTML = `<option value="">— Ninguno —</option>`;
  affiliatesCache.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.text = `${a.name||a.id} (${money(a.balanceOwed||0)})`;
    selAffiliate.appendChild(opt);
  });
}

/* Crear / Editar afiliado desde modal */
if (btnNewAffiliate) btnNewAffiliate.addEventListener("click", () => {
  if (affIdHidden) affIdHidden.value = "";
  if (affName) affName.value = "";
  if (affPhone) affPhone.value = "";
  if (modalAffiliate) modalAffiliate.classList.remove("hidden");
});
if (btnCancelAffiliate) btnCancelAffiliate.addEventListener("click", () => {
  if (modalAffiliate) modalAffiliate.classList.add("hidden");
});

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
      // update
      await updateDoc(doc(db,"affiliates",id), { name, phone });
      alert("Afiliado actualizado");
    } else {
      const res = await addDoc(collection(db,"affiliates"), { name, phone, balanceOwed: 0, createdAt: serverTimestamp() });
      alert("Afiliado creado: " + res.id);
    }
    if (modalAffiliate) modalAffiliate.classList.add("hidden");
    await loadAffiliates();
  } catch (err) {
    console.error("createAffiliate error", err);
    alert("Error creando/actualizando afiliado: " + (err.message||err));
  }
}

/* ===========================
   PAGOS (listar / crear / editar / eliminar)
   =========================== */
async function loadRecentPayments() {
  try {
    const payments = [];
    for (const c of companiesCache) {
      const companyRef = doc(db, "companies", c.id);
      const ps = await getDocs(query(collection(companyRef, "payments"), orderBy("createdAt", "desc"))).catch(()=>({docs:[]}));
      ps.docs.forEach(d => payments.push({ companyId: c.id, id: d.id, ...d.data() }));
    }
    // sort by createdAt desc
    payments.sort((a,b)=> {
      const ta = a.createdAt?.seconds ? a.createdAt.seconds : 0;
      const tb = b.createdAt?.seconds ? b.createdAt.seconds : 0;
      return tb - ta;
    });
    paymentsCache = payments;
    renderPayments(payments.slice(0,200));
  } catch (err) {
    console.error("loadRecentPayments error", err);
    if (tbPayments) tbPayments.innerHTML = `<tr><td colspan="6">Error cargando pagos.</td></tr>`;
    paymentsCache = [];
  }
}

function renderPayments(arr) {
  if (!tbPayments) return;
  tbPayments.innerHTML = "";
  arr.forEach(p => {
    const dateText = p.createdAt && p.createdAt.seconds ? new Date(p.createdAt.seconds*1000).toLocaleString() : '-';
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${dateText}</td>
      <td>${escapeHtml(p.companyId || '-')}</td>
      <td>${money(p.amount ?? p.monto ?? 0)}</td>
      <td>${p.monthsPaid||p.months||0}</td>
      <td>${escapeHtml(p.affiliateId||p.sellerId||p.affiliateName||'-')}</td>
      <td>
        <button class="px-2 py-1 border rounded btnInvoice" data-company="${p.companyId}" data-id="${p.id}">PDF</button>
        <button class="px-2 py-1 border rounded btnEditPayment" data-company="${p.companyId}" data-id="${p.id}">Editar</button>
        <button class="px-2 py-1 border rounded btnDelPayment" data-company="${p.companyId}" data-id="${p.id}">Eliminar</button>
      </td>`;
    tbPayments.appendChild(tr);
  });

  $$(".btnInvoice").forEach(b => b.onclick = async (e) => {
    alert("Descarga PDF por ahora via cloud function (si existe). Se implementa con httpsCallable si tienes 'generateInvoice'.");
  });

  $$(".btnEditPayment").forEach(b => b.onclick = async () => {
    const cid = b.dataset.company;
    const id = b.dataset.id;
    const p = paymentsCache.find(x=> x.companyId===cid && x.id===id);
    if (!p) return alert("Pago no encontrado");
    // Pre-fill modal to edit
    if (selCompany) selCompany.value = cid;
    if (inpAmount) inpAmount.value = p.amount ?? p.monto ?? 0;
    if (inpMonths) inpMonths.value = p.monthsPaid ?? p.months ?? 1;
    if (inpPromo) inpPromo.value = p.promoCode || "";
    if (selAffiliate) selAffiliate.value = p.affiliateId || "";
    if (affiliateFee) affiliateFee.value = p.affiliateFee || 0;
    if (inpNote) inpNote.value = p.note || p.createdByNote || "";
    // store editing markers on modal element
    if (modal) {
      modal.dataset.editingCompany = cid;
      modal.dataset.editingPayment = id;
    }
    // show affiliateFee row if affiliate selected
    if (affiliateFeeRow && selAffiliate) affiliateFeeRow.classList.toggle("hidden", !selAffiliate.value);
    if (modal) modal.classList.remove("hidden");
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
      alert("Error eliminando pago: " + (err.message||err));
    }
  });
}

/**
 * Try to call cloud function recordPayment; if it fails, fallback to client-side transaction.
 * Returns { success:true, paymentId } on success.
 */
async function invokeRecordPayment(payload) {
  try {
    const { companyId, amount, monthsPaid, promoCode, affiliateId, affiliateFee = 0, createdByNote } = payload;

    // 1️⃣ Crear documento de pago fuera de la transacción
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

    // 2️⃣ Ajustar balances dentro de transacción
    await runTransaction(db, async (tx) => {
      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const balancesSnap = await tx.get(balancesRef);
      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;
      const newCaja = oldCaja + Number(amount || 0);

      if (balancesSnap.exists()) {
        tx.update(balancesRef, { cajaEmpresa: newCaja });
      } else {
        tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });
      }

      // Registrar movimiento
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

      // Ajustar afiliado
      if (affiliateId && Number(affiliateFee || 0) > 0) {
        const affRef = doc(db, "affiliates", affiliateId);
        const affSnap = await tx.get(affRef);
        const oldBal = affSnap.exists() ? Number(affSnap.data().balanceOwed || 0) : 0;
        tx.set(affRef, { balanceOwed: oldBal + Number(affiliateFee || 0) }, { merge: true });
      }
    });

    return { success: true, paymentId };
  } catch (err) {
    console.error("invokeRecordPayment error:", err);
    throw err;
  }
}


/* Submit payment: handles create and edit (if modal has editing flags) */
if (document.getElementById("formRegister")) {
  document.getElementById("formRegister").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await submitRegister();
  });
}

if (btnOpen) btnOpen.addEventListener("click", () => {
  // clear editing flags
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
  if (modal) modal.classList.remove("hidden");
});
if (btnCancel) btnCancel.addEventListener("click", () => {
  if (modal) modal.classList.add("hidden");
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

async function submitRegister() {
  const companyId = selCompany?.value;
  const amount = Number(inpAmount?.value || 0);
  const monthsPaid = Number(inpMonths?.value || 0);
  const promoCode = inpPromo?.value?.trim() || null;
  const affiliateId = selAffiliate?.value || null;
  const affiliateFeeVal = Number((affiliateFee && affiliateFee.value) || 0);
  const note = inpNote?.value || null;

  if (!companyId || !amount || monthsPaid <= 0) return alert("Completa campos obligatorios");

  // If modal contained editing flags -> update existing payment
  const editingPayment = modal?.dataset?.editingPayment;
  const editingCompany = modal?.dataset?.editingCompany;

  try {
    if (editingPayment && editingCompany) {
      // Edit existing payment doc and adjust balances (transactional)
      await editPaymentWithAdjust(editingCompany, editingPayment, {
        amount, monthsPaid, promoCode, affiliateId, affiliateFee: affiliateFeeVal, note
      });
      alert("Pago editado correctamente.");
      if (modal) modal.classList.add("hidden");
      if (modal) {
        delete modal.dataset.editingPayment;
        delete modal.dataset.editingCompany;
      }
      await loadAll();
      return;
    }

    // Create new payment via callable or fallback
    const payload = {
      companyId, amount, monthsPaid, promoCode,
      affiliateId, affiliateFee: affiliateFeeVal, createdByNote: note
    };

    const res = await invokeRecordPayment(payload);
    if (res && res.success) {
      alert("Pago registrado: " + res.paymentId);
      if (modal) modal.classList.add("hidden");
      await loadAll();
    } else {
      throw new Error("Error guardando pago (respuesta inesperada).");
    }
  } catch (err) {
    console.error("submitRegister error", err);
    alert("Error registrando pago: " + (err.message || err));
  }
}

/* Edit payment: must adjust company balances and affiliate balances as needed */
async function editPaymentWithAdjust(companyId, paymentId, newData) {
  // We'll run a transaction: read existing payment, compute diffs, apply updates
  try {
    await runTransaction(db, async (tx) => {
      const payRef = doc(db, "companies", companyId, "payments", paymentId);
      const paySnap = await tx.get(payRef);
      if (!paySnap.exists()) throw new Error("Pago no encontrado");
      const old = paySnap.data();

      const oldAmount = Number(old.amount ?? old.monto ?? 0);
      const newAmount = Number(newData.amount ?? newData.monto ?? 0);
      const diff = newAmount - oldAmount;

      // Update payment document
      tx.update(payRef, {
        amount: newAmount,
        monthsPaid: newData.monthsPaid || old.monthsPaid || old.months || 1,
        promoCode: newData.promoCode || old.promoCode || null,
        affiliateId: newData.affiliateId || null,
        affiliateFee: newData.affiliateFee || old.affiliateFee || 0,
        note: newData.note || old.note || null,
        updatedAt: serverTimestamp()
      });

      // Update company balances (cajaEmpresa)
      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const balancesSnap = await tx.get(balancesRef);
      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;
      const newCaja = oldCaja + diff;
      if (balancesSnap.exists()) tx.update(balancesRef, { cajaEmpresa: newCaja });
      else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });

      // Add a movement to record edit (optional)
      const movRef = doc(collection(db, "companies", companyId, "movements"));
      tx.set(movRef, {
        tipo: diff >= 0 ? "ingreso" : "egreso",
        cuenta: "cajaEmpresa",
        fecha: new Date().toISOString().slice(0,10),
        monto: Math.abs(diff),
        desc: `Ajuste pago ${paymentId} (edit)`,
        paymentId,
        createdAt: serverTimestamp()
      });

      // Affiliate adjustments (if affiliate changed or affiliateFee changed)
      const oldAff = old.affiliateId || null;
      const oldAffFee = Number(old.affiliateFee || 0);
      const newAff = newData.affiliateId || null;
      const newAffFee = Number(newData.affiliateFee || 0);

      // If affiliate unchanged, just adjust difference between oldAffFee and newAffFee
      if (oldAff && oldAff === newAff) {
        const affRef = doc(db, "affiliates", oldAff);
        const affSnap = await tx.get(affRef);
        const oldBal = affSnap.exists() ? Number(affSnap.data().balanceOwed || 0) : 0;
        const delta = newAffFee - oldAffFee;
        if (delta !== 0) tx.update(affRef, { balanceOwed: oldBal + delta });
      } else {
        // If affiliate changed: subtract oldAffFee from old affiliate, add newAffFee to new affiliate
        if (oldAff && oldAffFee) {
          const refOld = doc(db, "affiliates", oldAff);
          const sOld = await tx.get(refOld);
          const oldBal = sOld.exists() ? Number(sOld.data().balanceOwed || 0) : 0;
          tx.update(refOld, { balanceOwed: Math.max(0, oldBal - oldAffFee) });
        }
        if (newAff && newAffFee) {
          const refNew = doc(db, "affiliates", newAff);
          const sNew = await tx.get(refNew);
          const newBal = sNew.exists() ? Number(sNew.data().balanceOwed || 0) : 0;
          tx.set(refNew, { balanceOwed: newBal + newAffFee }, { merge: true });
        }
      }
    });
  } catch (err) {
    console.error("editPaymentWithAdjust error", err);
    throw err;
  }
}

/* Delete payment with attempt to revert balances */
async function deletePaymentWithAdjust(companyId, paymentId) {
  try {
    await runTransaction(db, async (tx) => {
      const payRef = doc(db, "companies", companyId, "payments", paymentId);
      const paySnap = await tx.get(payRef);
      if (!paySnap.exists()) throw new Error("Pago no encontrado");
      const pay = paySnap.data();

      const amt = Number(pay.amount ?? pay.monto ?? 0);
      const affId = pay.affiliateId || null;
      const affFee = Number(pay.affiliateFee || 0);

      // Update balances (subtract amount)
      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const balancesSnap = await tx.get(balancesRef);
      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;
      const newCaja = oldCaja - amt;
      if (balancesSnap.exists()) tx.update(balancesRef, { cajaEmpresa: newCaja });
      else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });

      // movement to record elimination
      const movRef = doc(collection(db, "companies", companyId, "movements"));
      tx.set(movRef, { tipo: "egreso", cuenta: "cajaEmpresa", fecha: new Date().toISOString().slice(0,10), monto: amt, desc: `Eliminación pago ${paymentId}`, paymentId, createdAt: serverTimestamp() });

      // Adjust affiliate balance (subtract affiliateFee if present)
      if (affId && affFee) {
        const affRef = doc(db, "affiliates", affId);
        const affSnap = await tx.get(affRef);
        const oldBal = affSnap.exists() ? Number(affSnap.data().balanceOwed || 0) : 0;
        tx.update(affRef, { balanceOwed: Math.max(0, oldBal - affFee) });
      }

      // Delete payment
      tx.delete(payRef);
    });
  } catch (err) {
    console.error("deletePaymentWithAdjust", err);
    throw err;
  }
}

/* ===========================
   KPIs
   =========================== */
function computeKPIs() {
  if (kCompanies) kCompanies.textContent = companiesCache.length;
  if (kRevenue) kRevenue.textContent = money(paymentsCache.reduce((s,p)=>s+Number(p.amount ?? p.monto ?? 0),0));
  const totalComm = affiliatesCache.reduce((s,a)=> s + (Number(a.balanceOwed||0)), 0);
  if (kCommissions) kCommissions.textContent = money(totalComm);
}

/* ===========================
   STATS (Chart.js) - destruye gráfico previo si existe
   =========================== */
function renderStats() {
  const canvas = document.getElementById("chartRevenue");
  if (!canvas) return;

  const monthly = {};
  paymentsCache.forEach(p=>{
    const secs = p.createdAt?.seconds;
    if (!secs) return;
    const d = new Date(secs*1000);
    const key = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}`;
    monthly[key] = (monthly[key]||0) + Number(p.amount ?? p.monto ?? 0);
  });
  const labels = Object.keys(monthly).sort();
  const data = labels.map(l=>monthly[l]);

  try { if (revenueChart) { revenueChart.destroy(); revenueChart = null; } } catch(e) { console.warn(e); }

  const ctx = canvas.getContext("2d");
  revenueChart = new Chart(ctx,{
    type:"line",
    data:{ labels, datasets:[{ label:"Ingresos", data, borderColor:"rgb(16,185,129)", backgroundColor:"rgba(16,185,129,0.12)", fill:true }] },
    options:{ responsive:true, maintainAspectRatio:false }
  });
}

/* ===========================
   UTILS
   =========================== */
function escapeHtml(s) {
  if (!s && s !== 0) return '';
  return String(s).replace(/[&<>"'`=\/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D'}[c]));
}

/* bootstrap (tabs already client-side) */
document.addEventListener("DOMContentLoaded", () => {
  // nothing else; auth triggers loadAll()
});
