// js/admin-panel.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  sendPasswordResetEmail
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
  Timestamp,
  where
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
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => `$${Number(n || 0).toLocaleString('es-CO',{maximumFractionDigits:2})}`;

// DOM refs (defensivo)
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

const tblCompaniesWrapper = $("#tblCompanies");
const tblAffiliatesWrapper = $("#tblAffiliates");
const tblPaymentsWrapper = $("#tblPayments");

let companiesCache = [];
let affiliatesCache = [];
let paymentsCache = [];
let revenueChart = null;

/* ---------------------------
   AUTH: login + register (admin)
   --------------------------- */
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
      registerBox.classList.add("hidden");
    } catch (err) {
      console.error("register error", err);
      alert("Error creando cuenta: " + (err.message||err));
    }
  });
}

/* ---------------------------
   onAuthStateChanged
   --------------------------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    if (authOverlay) authOverlay.classList.remove("hidden");
    if (appDiv) appDiv.classList.add("hidden");
    return;
  }
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
      const ingresosSnap = await getDocs(collection(compRef, "ingresos")).catch(()=>({docs:[]}));
      const egresosSnap = await getDocs(collection(compRef, "egresos")).catch(()=>({docs:[]}));
      const ventasSnap = await getDocs(collection(compRef, "sales")).catch(()=>({docs:[]}));

      const ingresos = ingresosSnap.docs.reduce((s,d)=> s + Number(d.data().amount ?? d.data().monto ?? 0), 0);
      const egresos  = egresosSnap.docs.reduce((s,d)=> s + Number(d.data().amount ?? d.data().monto ?? 0), 0);
      const ventas   = ventasSnap.docs.reduce((s,d)=> s + Number(d.data().total ?? d.data().amount ?? 0), 0);

      // If company has state/balances doc, include cajaEmpresa else fallback to computed
      try {
        const stateSnap = await getDoc(doc(db, "companies", c.id, "state", "balances"));
        if (stateSnap.exists()) {
          c.balance = Number(stateSnap.data().cajaEmpresa || 0);
        } else {
          c.balance = ingresos + ventas - egresos;
        }
      } catch (err) {
        c.balance = ingresos + ventas - egresos;
      }
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
      <td>${escapeHtml(c.planActive === false ? 'inactivo' : (c.subscriptionStatus || '—'))}</td>
      <td>${c.subscriptionEndsAt ? (c.subscriptionEndsAt.seconds ? new Date(c.subscriptionEndsAt.seconds*1000).toLocaleDateString() : c.subscriptionEndsAt) : '-'}</td>
      <td>${money(c.balance||0)}</td>
      <td>
        <button class="px-2 py-1 border rounded btnView" data-id="${c.id}">Ver</button>
        <button class="px-2 py-1 border rounded btnTogglePlan" data-id="${c.id}">${c.planActive===false ? 'Activar' : 'Desactivar'}</button>
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

  $$(".btnTogglePlan").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    try {
      const cRef = doc(db, "companies", id);
      const snap = await getDoc(cRef);
      const current = snap.exists() ? (snap.data().planActive !== false) : true;
      await updateDoc(cRef, { planActive: !current, updatedAt: serverTimestamp() });
      // try to send notification
      try {
        const fn = httpsCallable(functions, "sendNotification");
        await fn({ companyId: id, type: "planToggled", active: !current });
      } catch(e) { /* best-effort */ }
      await loadCompanies();
      alert(`Plan de la empresa ${!current ? 'activado' : 'desactivado'}.`);
    } catch (err) {
      console.error("toggle plan", err);
      alert("Error cambiando plan: " + (err.message||err));
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
   AFFILIATES
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
        <button class="px-2 py-1 border rounded btnPay" data-id="${a.id}">Pagar comisiones</button>
        <button class="px-2 py-1 border rounded btnEditAff" data-id="${a.id}">Editar</button>
        <button class="px-2 py-1 border rounded btnDelAff" data-id="${a.id}">Eliminar</button>
      </td>`;
    tbAffiliates.appendChild(tr);
  });

  $$(".btnPay").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    const a = affiliatesCache.find(x=>x.id===id);
    if (!a) return alert("Afiliado no encontrado");
    const owe = Number(a.balanceOwed || 0);
    if (!owe || owe <= 0) return alert("No hay saldo pendiente para este afiliado.");
    if (!confirm(`Confirma pagar ${money(owe)} a ${a.name}? Esto registrará el pago en la plataforma y dejará a cero su saldo.`)) return;

    // Prefer server-side: call callable function 'payAffiliate' (must exist).
    try {
      const fn = httpsCallable(functions, "payAffiliate");
      const res = await fn({ affiliateId: id, amount: owe });
      if (res && res.data && res.data.success) {
        alert("Pago de afiliado registrado (server).");
        await loadAffiliates();
        await loadCompanies();
        return;
      }
    } catch (err) {
      // If callable not present or failed, fallback to client transaction (best-effort)
      console.warn("payAffiliate callable failed -> fallback to client tx:", err);
    }

    // fallback: client-side transaction that registers payout doc under affiliates/{id}/payouts
    try {
      await runTransaction(db, async (tx) => {
        const affRef = doc(db, "affiliates", id);
        const affSnap = await tx.get(affRef);
        const current = affSnap.exists() ? Number(affSnap.data().balanceOwed || 0) : 0;
        if (current <= 0) return;
        const payoutRef = doc(collection(db, "affiliates", id, "payouts"));
        // reads done above, now writes:
        tx.set(payoutRef, { amount: current, paidAt: serverTimestamp(), createdBy: auth.currentUser?.uid || null });
        tx.update(affRef, { balanceOwed: 0 });
      });
      alert("Comisión pagada y registrada (cliente).");
      await loadAffiliates();
      await loadCompanies();
    } catch (err) {
      console.error("pay affiliate fallback error", err);
      alert("Error al pagar afiliado: " + (err.message || err));
    }
  });

  $$(".btnEditAff").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    const aff = affiliatesCache.find(x=>x.id===id);
    if (!aff) return;
    const newName = prompt("Nombre:", aff.name||"");
    if (!newName) return;
    const newPhone = prompt("Teléfono:", aff.phone||"");
    try {
      await updateDoc(doc(db,"affiliates",id), { name:newName, phone:newPhone });
      await loadAffiliates();
    } catch (err) {
      console.error("edit aff", err);
      alert("Error actualizando afiliado: " + (err.message||err));
    }
  });

  $$(".btnDelAff").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    if (!confirm("Eliminar afiliado? Esto no eliminará pagos previos pero sí quitará el registro.")) return;
    try {
      await deleteDoc(doc(db,"affiliates",id));
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

/* Affiliate create/edit modal handlers */
if (btnNewAffiliate) btnNewAffiliate.addEventListener("click", () => {
  if (affIdHidden) affIdHidden.value = "";
  if (affName) affName.value = "";
  if (affPhone) affPhone.value = "";
  if (modalAffiliate) modalAffiliate.classList.remove("hidden");
});
if (btnCancelAffiliate) btnCancelAffiliate.addEventListener("click", () => modalAffiliate && modalAffiliate.classList.add("hidden"));
if (formAffiliate) formAffiliate.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  await createOrUpdateAffiliate();
});
if (btnCreateAffiliate) btnCreateAffiliate.addEventListener("click", async (ev) => {
  ev.preventDefault();
  await createOrUpdateAffiliate();
});

async function createOrUpdateAffiliate() {
  const name = affName?.value?.trim();
  const phone = affPhone?.value?.trim() || null;
  const id = affIdHidden?.value || null;
  if (!name) return alert("Nombre requerido");
  try {
    if (id) {
      await updateDoc(doc(db,"affiliates",id), { name, phone });
      alert("Afiliado actualizado");
    } else {
      const res = await addDoc(collection(db,"affiliates"), { name, phone, balanceOwed: 0, createdAt: serverTimestamp() });
      alert("Afiliado creado: " + res.id);
    }
    modalAffiliate && modalAffiliate.classList.add("hidden");
    await loadAffiliates();
  } catch (err) {
    console.error("createOrUpdateAffiliate error", err);
    alert("Error creando/actualizando afiliado: " + (err.message||err));
  }
}


/* =========================
   PAYMENTS: carga y render (parte 2)
   ========================= */

/**
 * Ahora: ADMIN payments se guardan en la colección raíz 'admin_payments'
 * - No modificamos datos dentro de companies/* (no tocamos su caja ni movimientos).
 * - admin_payments: { companyId, amount, monthsPaid, promoCode, affiliateId, affiliateFee, note, createdAt, createdBy }
 *
 * Nota: Pagos históricos que estuvieran en companies/{id}/payments no se borran aquí,
 * este panel ahora muestra exclusivamente lo creado desde el admin (admin_payments).
 */

// 👇 Nueva versión de loadRecentPayments
async function loadRecentPayments(companyId) {
  try {
    // Llamamos a la Cloud Function
    const listFn = httpsCallable(functions, "listPayments");
    const res = await listFn({ companyId });
    return res.data; // Aquí viene el array de pagos
  } catch (err) {
    console.error("loadRecentPayments error:", err);
    throw err;
  }
}


function renderPayments(arr) {
  if (!tbPayments) return;
  tbPayments.innerHTML = "";
  arr.forEach(p=>{
    const dateText = p.createdAt && p.createdAt.seconds ? new Date(p.createdAt.seconds*1000).toLocaleString() : '-';
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${dateText}</td>
      <td>${escapeHtml(p.companyId || '-')}</td>
      <td>${money(p.amount ?? p.monto ?? 0)}</td>
      <td>${p.monthsPaid||p.months||0}</td>
      <td>${escapeHtml(p.affiliateId||p.sellerId||p.affiliateName||'-')}</td>
      <td>${money(p.affiliateFee||0)}</td>
      <td>
        <button class="px-2 py-1 border rounded btnInvoice" data-id="${p.id}">PDF</button>
        <button class="px-2 py-1 border rounded btnEditPayment" data-id="${p.id}">Editar</button>
        <button class="px-2 py-1 border rounded btnDelPayment" data-id="${p.id}">Eliminar</button>
      </td>`;
    tbPayments.appendChild(tr);
  });

  $$(".btnInvoice").forEach(b=>{
    b.onclick = async () => {
      const paymentId = b.dataset.id;
      try {
        const gen = httpsCallable(functions, "generateInvoice");
        // send paymentId (server side should fetch data and return base64 file in res.data.file)
        const res = await gen({ paymentId });
        if (res.data && res.data.file) {
          const bin = atob(res.data.file);
          const len = bin.length;
          const buf = new Uint8Array(len);
          for (let i=0;i<len;i++) buf[i]=bin.charCodeAt(i);
          const blob = new Blob([buf], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `factura_${paymentId}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        } else {
          alert("No se recibió PDF del servidor.");
        }
      } catch (err) {
        console.error("invoice err", err);
        alert("Error solicitando factura: "+(err.message||err));
      }
    };
  });

  $$(".btnEditPayment").forEach(b=>{
    b.onclick = async ()=>{
      const id = b.dataset.id;
      const p = paymentsCache.find(x=> x.id===id);
      if (!p) return alert("Pago no encontrado");
      // prefill modal
      if (selCompany) selCompany.value = p.companyId || "";
      if (inpAmount) inpAmount.value = p.amount ?? p.monto ?? 0;
      if (inpMonths) inpMonths.value = p.monthsPaid ?? p.months ?? 1;
      if (inpPromo) inpPromo.value = p.promoCode || "";
      if (selAffiliate) selAffiliate.value = p.affiliateId || "";
      if (affiliateFee) affiliateFee.value = p.affiliateFee || 0;
      if (inpNote) inpNote.value = p.note || p.createdByNote || "";
      if (modal) {
        modal.dataset.editingPayment = id;
      }
      if (affiliateFeeRow && selAffiliate) affiliateFeeRow.classList.toggle("hidden", !selAffiliate.value);
      if (modal) modal.classList.remove("hidden");
    };
  });

  $$(".btnDelPayment").forEach(b=>{
    b.onclick = async ()=>{
      const id = b.dataset.id;
      if (!confirm("Eliminar pago? Esto ajustará saldos en la plataforma (NO tocará cuentas de las empresas).")) return;
      try {
        await deletePaymentWithAdjust(id);
        alert("Pago eliminado y saldos ajustados (si aplica).");
        await loadAll();
      } catch (err) {
        console.error("delete payment", err);
        alert("Error eliminando pago: " + (err.message||err));
      }
    };
  });
}

/* =========================
   INVOKE RECORD PAYMENT
   - create payment in 'admin_payments' then adjust platform balances and affiliate balances
   - IMPORTANT: NO se modifica nada dentro de companies/* (NO tocar caja ni movimientos de empresas)
   ========================= */
async function invokeRecordPayment(payload) {
  try {
    const { companyId, amount, monthsPaid, promoCode, affiliateId, affiliateFee = 0, createdByNote } = payload;

    // Basic validations
    if (!companyId) throw new Error("Falta companyId");
    if (!amount || Number(amount) <= 0) throw new Error("Monto inválido");

    // 1) create payment doc inside admin_payments (root) -- this is the admin ledger
    const paymentRef = await addDoc(collection(db, "admin_payments"), {
      companyId,
      amount: Number(amount),
      monthsPaid: Number(monthsPaid || 0),
      promoCode: promoCode || null,
      affiliateId: affiliateId || null,
      affiliateFee: Number(affiliateFee || 0),
      note: createdByNote || null,
      createdAt: serverTimestamp(),
      createdBy: auth.currentUser ? auth.currentUser.uid : null
    });
    const paymentId = paymentRef.id;

    // 2) Transaction: update platform balances and affiliate balance (reads first)
    await runTransaction(db, async (tx) => {
      const platformBalancesRef = doc(db, "platform", "state", "balances"); // platform-level balances
      const affRef = affiliateId ? doc(db, "affiliates", affiliateId) : null;

      // READS
      const platformBalancesSnap = await tx.get(platformBalancesRef);
      const affSnap = affRef ? await tx.get(affRef) : null;

      const oldPlatformCaja = platformBalancesSnap.exists() ? Number(platformBalancesSnap.data().cajaPlataforma || 0) : 0;
      const oldAffBal = affSnap && affSnap.exists() ? Number(affSnap.data().balanceOwed || 0) : 0;

      const newPlatformCaja = oldPlatformCaja + Number(amount || 0);

      // WRITES (after reads)
      if (platformBalancesSnap.exists()) {
        tx.update(platformBalancesRef, { cajaPlataforma: newPlatformCaja });
      } else {
        tx.set(platformBalancesRef, { cajaPlataforma: newPlatformCaja, deudasTotales: 0, createdAt: serverTimestamp() });
      }

      // record movement in platform/movements
      const movRef = doc(collection(db, "platform", "movements"));
      tx.set(movRef, {
        tipo: "ingreso",
        cuenta: "cajaPlataforma",
        fecha: new Date().toISOString().slice(0,10),
        monto: Number(amount || 0),
        desc: `Pago admin ID ${paymentId} (empresa ${companyId})`,
        paymentId,
        createdAt: serverTimestamp()
      });

      // update affiliate owed balance (global affiliate record)
      if (affiliateId && Number(affiliateFee || 0) > 0) {
        tx.set(affRef, { balanceOwed: oldAffBal + Number(affiliateFee || 0) }, { merge: true });
      }
    });

    return { success: true, paymentId };
  } catch (err) {
    console.error("invokeRecordPayment error:", err);
    throw err;
  }
}

/* -------------------------
   FORM MODAL behavior
   ------------------------- */
const formRegister = document.getElementById("formRegister");
if (formRegister) {
  formRegister.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    await submitRegister();
  });
}

if (btnOpen) btnOpen.addEventListener("click", ()=>{
  if (modal) {
    delete modal.dataset.editingPayment;
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

if (btnCancel) btnCancel.addEventListener("click", ()=> {
  modal && modal.classList.add("hidden");
  if (modal) {
    delete modal.dataset.editingPayment;
  }
});

if (btnReload) btnReload.addEventListener("click", ()=> loadAll());

if (selAffiliate) selAffiliate.addEventListener("change", () => {
  if (!selAffiliate) return;
  if (affiliateFeeRow) {
    if (selAffiliate.value) affiliateFeeRow.classList.remove("hidden");
    else affiliateFeeRow.classList.add("hidden");
  }
});

/* -------------------------
   submitRegister: create or edit payment
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

  try {
    if (editingPayment) {
      await editPaymentWithAdjust(editingPayment, {
        companyId, amount, monthsPaid, promoCode, affiliateId, affiliateFee: affiliateFeeVal, note
      });
      alert("Pago editado correctamente.");
      modal && modal.classList.add("hidden");
      delete modal.dataset.editingPayment;
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
   EDIT PAYMENT WITH ADJUST (admin_payments)
   - Operamos solo sobre admin_payments y platform balances (NO tocar companies/*)
   - Transacción: LEER todo primero, luego escribir.
   ========================= */
async function editPaymentWithAdjust(paymentId, newData) {
  try {
    await runTransaction(db, async (tx) => {
      const payRef = doc(db, "admin_payments", paymentId);
      const platformBalancesRef = doc(db, "platform", "state", "balances");

      // READS
      const paySnap = await tx.get(payRef);
      if (!paySnap.exists()) throw new Error("Pago no encontrado (admin).");
      const old = paySnap.data();

      const platformSnap = await tx.get(platformBalancesRef);
      const affRefOld = old.affiliateId ? doc(db, "affiliates", old.affiliateId) : null;
      const affRefNew = newData.affiliateId ? doc(db, "affiliates", newData.affiliateId) : null;
      const affSnapOld = affRefOld ? await tx.get(affRefOld) : null;
      const affSnapNew = affRefNew ? await tx.get(affRefNew) : null;

      const oldPlatformCaja = platformSnap.exists() ? Number(platformSnap.data().cajaPlataforma || 0) : 0;

      const oldAmount = Number(old.amount ?? old.monto ?? 0);
      const newAmount = Number(newData.amount ?? newData.monto ?? 0);
      const diff = newAmount - oldAmount;

      const oldAffFee = Number(old.affiliateFee || 0);
      const newAffFee = Number(newData.affiliateFee || 0);

      const newPlatformCaja = oldPlatformCaja + diff;

      // WRITES
      tx.update(payRef, {
        amount: newAmount,
        monthsPaid: newData.monthsPaid || old.monthsPaid || old.months || 1,
        promoCode: newData.promoCode || old.promoCode || null,
        affiliateId: newData.affiliateId || null,
        affiliateFee: newData.affiliateFee || old.affiliateFee || 0,
        note: newData.note || old.note || null,
        updatedAt: serverTimestamp()
      });

      if (platformSnap.exists()) tx.update(platformBalancesRef, { cajaPlataforma: newPlatformCaja });
      else tx.set(platformBalancesRef, { cajaPlataforma: newPlatformCaja, deudasTotales: 0, createdAt: serverTimestamp() });

      const movRef = doc(collection(db, "platform", "movements"));
      tx.set(movRef, {
        tipo: diff >= 0 ? "ingreso" : "egreso",
        cuenta: "cajaPlataforma",
        fecha: new Date().toISOString().slice(0,10),
        monto: Math.abs(diff),
        desc: `Ajuste pago ${paymentId} (edit)`,
        paymentId,
        createdAt: serverTimestamp()
      });

      // Affiliate adjustments (global affiliates)
      const oldAff = old.affiliateId || null;
      const newAff = newData.affiliateId || null;

      if (oldAff && oldAff === newAff) {
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
    });
  } catch (err) {
    console.error("editPaymentWithAdjust error", err);
    throw err;
  }
}

/* =========================
   DELETE PAYMENT WITH ADJUST (admin_payments)
   - Operamos solo sobre admin_payments y platform balances
   - Transacción: LEER todo primero, luego escribir.
   ========================= */
async function deletePaymentWithAdjust(paymentId) {
  try {
    await runTransaction(db, async (tx) => {
      const payRef = doc(db, "admin_payments", paymentId);
      const platformBalancesRef = doc(db, "platform", "state", "balances");

      // READS
      const paySnap = await tx.get(payRef);
      if (!paySnap.exists()) throw new Error("Pago no encontrado (admin).");
      const pay = paySnap.data();

      const platformSnap = await tx.get(platformBalancesRef);
      const affRef = pay.affiliateId ? doc(db, "affiliates", pay.affiliateId) : null;
      const affSnap = affRef ? await tx.get(affRef) : null;

      const oldPlatformCaja = platformSnap.exists() ? Number(platformSnap.data().cajaPlataforma || 0) : 0;
      const amt = Number(pay.amount ?? pay.monto ?? 0);
      const newPlatformCaja = oldPlatformCaja - amt;

      // WRITES
      if (platformSnap.exists()) {
        tx.update(platformBalancesRef, { cajaPlataforma: newPlatformCaja });
      } else {
        tx.set(platformBalancesRef, { cajaPlataforma: newPlatformCaja, deudasTotales: 0, createdAt: serverTimestamp() });
      }

      const movRef = doc(collection(db, "platform", "movements"));
      tx.set(movRef, {
        tipo: "egreso",
        cuenta: "cajaPlataforma",
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
  if (kRevenue) kRevenue.textContent = money(paymentsCache.reduce((s,p)=>s+Number(p.amount ?? p.monto ?? 0),0));
  const totalComm = affiliatesCache.reduce((s,a)=> s + (Number(a.balanceOwed||0)), 0);
  if (kCommissions) kCommissions.textContent = money(totalComm);
}

/* =========================
   STATS (Chart.js)
   ========================= */
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

  try { if (revenueChart) { revenueChart.destroy(); revenueChart = null; } } catch(e){ console.warn(e); }

  const ctx = canvas.getContext("2d");
  revenueChart = new Chart(ctx,{
    type:"line",
    data:{ labels, datasets:[{ label:"Ingresos", data, borderColor:"rgb(16,185,129)", backgroundColor:"rgba(16,185,129,0.12)", fill:true }] },
    options:{ responsive:true, maintainAspectRatio:false }
  });
}

/* =========================
   EXTRA: change user password (admin)
   ========================= */
async function changeUserPassword(userEmail, newPassword) {
  try {
    // try callable adminChangePassword (server must be set up)
    const fn = httpsCallable(functions, "adminChangePassword");
    const res = await fn({ email: userEmail, newPassword });
    if (res && res.data && res.data.success) return { success: true };
    // fallback: send password reset link to user
    await sendPasswordResetEmail(auth, userEmail);
    return { success: true, message: "Se envió email de restablecimiento de contraseña." };
  } catch (err) {
    console.error("changeUserPassword err", err);
    return { success: false, error: err.message || err };
  }
}

/* UI helper */
async function promptChangePasswordFor(email) {
  const newPass = prompt(`Cambiar contraseña para ${email} — ingresa nueva contraseña (o deja vacío para enviar reset email):`);
  if (newPass === null) return; // cancel
  try {
    const res = await changeUserPassword(email, newPass || null);
    if (res.success) {
      alert(res.message || "Cambio de contraseña solicitado / realizado.");
    } else {
      alert("Error cambiando contraseña: " + (res.error || "unknown"));
    }
  } catch (err) {
    console.error("promptChangePasswordFor", err);
    alert("Error: " + (err.message||err));
  }
}

/* =========================
   HELPERS / UTIL
   ========================= */
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"'`=\/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D'}[c]));
}

/* =========================
   BOOTSTRAP CLIENT TABS
   ========================= */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".tablink").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      document.querySelectorAll(".tabcontent").forEach(tab=>tab.classList.add("hidden"));
      document.querySelectorAll(".tablink").forEach(b=>b.classList.remove("border-emerald-600","text-emerald-600"));
      const target = document.getElementById("tab-"+btn.dataset.tab);
      btn.classList.add("border-emerald-600","text-emerald-600");
      if (target) target.classList.remove("hidden");
    });
  });
  const defaultTab = document.querySelector(".tablink[data-tab='dashboard']");
  if (defaultTab) defaultTab.click();
});

/* Expose some functions for console debugging (optional) */
window.__adminPanel = {
  reload: loadAll,
  loadCompanies,
  loadAffiliates,
  loadRecentPayments,
  invokeRecordPayment,
  editPaymentWithAdjust,
  deletePaymentWithAdjust,
  changeUserPassword
};
