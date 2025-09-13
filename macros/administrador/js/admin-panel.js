// js/admin-panel.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

import {
  getFirestore, collection, getDocs, query, orderBy, doc, getDoc,
  addDoc, setDoc, updateDoc, deleteDoc, runTransaction, serverTimestamp
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

/* DOM refs */
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
const inpAffFee = $("#inpAffFee");
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

let companiesCache = [];
let affiliatesCache = [];
let paymentsCache = [];
let revenueChart = null;

/* ---------------------------
   AUTH: login + optional register
   --------------------------- */
btnShowRegister?.addEventListener("click", (e) => {
  registerBox.classList.toggle("hidden");
});
btnCancelRegister?.addEventListener("click", () => registerBox.classList.add("hidden"));

loginForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const email = loginEmail.value.trim();
  const pass = loginPass.value.trim();
  if (!email || !pass) return alert("Completa email y contraseña.");
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    console.error("login error", err);
    alert("Error autenticando: " + (err.message || err));
  }
});

registerForm?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const name = regName.value.trim();
  const email = regEmail.value.trim();
  const pass = regPass.value.trim();
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

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    authOverlay.classList.remove("hidden");
    appDiv.classList.add("hidden");
    return;
  }
  authOverlay.classList.add("hidden");
  appDiv.classList.remove("hidden");
  loggedAs.textContent = `Sesión: ${user.email || user.displayName || user.uid}`;
  await loadAll();
});

/* logout */
btnLogout?.addEventListener("click", async () => {
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
      const ingresosSnap = await getDocs(collection(compRef, "ingresos"));
      const egresosSnap = await getDocs(collection(compRef, "egresos"));
      const ventasSnap = await getDocs(collection(compRef, "sales"));
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
    const d = await getDoc(doc(db,"companies",id));
    alert(JSON.stringify(d.data(), null, 2));
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
   AFILIADOS
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
      await setDoc(doc(db,"affiliates",id), { balanceOwed: 0 }, { merge: true });
      await loadAffiliates();
    } catch (err) {
      alert("Error marcando pago: " + (err.message||err));
    }
  });
  $$(".btnEditAff").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    const aff = affiliatesCache.find(x=>x.id===id);
    if (!aff) return;
    const newName = prompt("Nombre:", aff.name||"");
    const newPhone = prompt("Teléfono:", aff.phone||"");
    if (newName) {
      await updateDoc(doc(db,"affiliates",id), { name:newName, phone:newPhone });
      await loadAffiliates();
    }
  });
  $$(".btnDelAff").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    if (!confirm("Eliminar afiliado?")) return;
    await deleteDoc(doc(db,"affiliates",id));
    await loadAffiliates();
  });
}

function populateAffiliateSelect() {
  if (!selAffiliate) return;
  selAffiliate.innerHTML = `<option value="">— Ninguno —</option>`;
  affiliatesCache.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.text = `${a.name||a.id}`;
    selAffiliate.appendChild(opt);
  });
}

/* Crear afiliado */
btnNewAffiliate?.addEventListener("click", () => modalAffiliate.classList.remove("hidden"));
btnCancelAffiliate?.addEventListener("click", () => modalAffiliate.classList.add("hidden"));
formAffiliate?.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  await createAffiliate();
});
btnCreateAffiliate?.addEventListener("click", async (ev) => {
  ev.preventDefault();
  await createAffiliate();
});

async function createAffiliate() {
  const name = affName.value.trim();
  const phone = affPhone.value.trim() || null;
  if (!name) return alert("Nombre requerido");
  try {
    await addDoc(collection(db,"affiliates"), {
      name, phone, balanceOwed: 0, createdAt: serverTimestamp()
    });
    modalAffiliate.classList.add("hidden");
    affName.value = ""; affPhone.value = "";
    await loadAffiliates();
  } catch (err) {
    alert("Error creando afiliado: " + (err.message||err));
  }
}

/* ===========================
   PAGOS
   =========================== */
async function loadRecentPayments() {
  try {
    const payments = [];
    for (const c of companiesCache) {
      const companyRef = doc(db, "companies", c.id);
      const ps = await getDocs(query(collection(companyRef, "payments"), orderBy("createdAt", "desc")));
      ps.docs.forEach(d => payments.push({ companyId: c.id, id: d.id, ...d.data() }));
    }
    paymentsCache = payments;
    renderPayments(payments.slice(0,200));
  } catch (err) {
    paymentsCache = [];
  }
}

function renderPayments(arr) {
  if (!tbPayments) return;
  tbPayments.innerHTML = "";
  arr.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${p.createdAt && p.createdAt.seconds ? new Date(p.createdAt.seconds*1000).toLocaleString() : '-'}</td>
      <td>${escapeHtml(p.companyId || '-')}</td>
      <td>${money(p.amount ?? p.monto ?? 0)}</td>
      <td>${p.monthsPaid||0}</td>
      <td>${escapeHtml(p.affiliateId||'-')}</td>
      <td>${money(p.affiliateFee||0)}</td>
      <td>
        <button class="px-2 py-1 border rounded btnInvoice" data-company="${p.companyId}" data-id="${p.id}">PDF</button>
        <button class="px-2 py-1 border rounded btnEditPay" data-company="${p.companyId}" data-id="${p.id}">Editar</button>
        <button class="px-2 py-1 border rounded btnDelPay" data-company="${p.companyId}" data-id="${p.id}">Eliminar</button>
      </td>`;
    tbPayments.appendChild(tr);
  });

  $$(".btnInvoice").forEach(b => b.onclick = async () => {
    const companyId = b.dataset.company;
    const paymentId = b.dataset.id;
    try {
      const gen = httpsCallable(functions, "generateInvoice");
      const res = await gen({ companyId, paymentId });
      if (res.data && res.data.invoiceBase64) {
        const bin = atob(res.data.invoiceBase64);
        const len = bin.length;
        const buf = new Uint8Array(len);
        for (let i=0;i<len;i++) buf[i]=bin.charCodeAt(i);
        const blob = new Blob([buf], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.data.filename || `factura_${companyId}_${paymentId}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else {
        alert("No se recibió PDF del servidor.");
      }
    } catch (err) {
      alert("Error solicitando factura: "+(err.message||err));
    }
  });

  $$(".btnEditPay").forEach(b => b.onclick = async () => {
    const companyId = b.dataset.company;
    const paymentId = b.dataset.id;
    const pay = paymentsCache.find(p=>p.id===paymentId && p.companyId===companyId);
    if (!pay) return;
    const newAmount = prompt("Nuevo monto:", pay.amount);
    if (!newAmount) return;
    await updateDoc(doc(db,"companies",companyId,"payments",paymentId), { amount:Number(newAmount) });
    await loadAll();
  });

  $$(".btnDelPay").forEach(b => b.onclick = async () => {
    const companyId = b.dataset.company;
    const paymentId = b.dataset.id;
    if (!confirm("Eliminar pago?")) return;
    await deleteDoc(doc(db,"companies",companyId,"payments",paymentId));
    await loadAll();
  });
}

/* ===========================
   KPIs
   =========================== */
function computeKPIs() {
  kCompanies.textContent = companiesCache.length;
  kRevenue.textContent = money(paymentsCache.reduce((s,p)=>s+Number(p.amount ?? 0),0));
  const totalComm = affiliatesCache.reduce((s,a)=> s + (Number(a.balanceOwed||0)),0);
  kCommissions.textContent = money(totalComm);
}

function renderStats() {
  if (typeof Chart==="undefined") return;
  const ctx = $("#revenueChart");
  if (!ctx) return;
  if (revenueChart) revenueChart.destroy();
  const monthly = {};
  paymentsCache.forEach(p=>{
    if (!p.createdAt?.seconds) return;
    const d = new Date(p.createdAt.seconds*1000);
    const k = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}`;
    monthly[k] = (monthly[k]||0)+Number(p.amount||0);
  });
  const labels = Object.keys(monthly).sort();
  const values = labels.map(k=>monthly[k]);
  revenueChart = new Chart(ctx,{
    type:"line",
    data:{labels, datasets:[{label:"Ingresos", data:values, fill:true, borderColor:"#4a90e2"}]},
    options:{scales:{y:{beginAtZero:true}}}
  });
}

/* ===========================
   MODAL REGISTRO PAGO
   =========================== */
btnOpen?.addEventListener("click",()=>modal.classList.remove("hidden"));
btnCancel?.addEventListener("click",()=>modal.classList.add("hidden"));

btnSubmit?.addEventListener("click",async()=>{
  const companyId = selCompany.value;
  const affiliateId = selAffiliate.value || null;
  const amount = Number(inpAmount.value||0);
  const monthsPaid = Number(inpMonths.value||0);
  const promoCode = inpPromo.value||null;
  const note = inpNote.value||null;
  const affiliateFee = Number(inpAffFee.value||0);
  if (!companyId || !amount) return alert("Empresa y monto requeridos");
  try {
    await invokeRecordPayment({companyId,amount,monthsPaid,promoCode,affiliateId,affiliateFee,createdByNote:note});
    modal.classList.add("hidden");
    inpAmount.value=""; inpMonths.value=""; inpPromo.value=""; inpNote.value=""; inpAffFee.value="";
    await loadAll();
  } catch (err) {
    alert("Error registrando pago: "+(err.message||err));
  }
});

/* ===========================
   INVOKE PAYMENT LOGIC
   =========================== */
async function invokeRecordPayment(payload) {
  try {
    const { companyId, amount, monthsPaid, promoCode, affiliateId, affiliateFee = 0, createdByNote } = payload;

    // Crear documento de pago fuera de la transacción
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

    // Ajustar balances dentro de transacción
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


// Listener del formulario (asegurar prevencion del comportamiento por defecto)
const formRegister = document.getElementById("formRegister");
if (formRegister) {
  formRegister.addEventListener("submit", async (ev) => {
    ev.preventDefault(); // <- esto evita recargar
    await submitRegister(); // llama a la función central
  });
}

// Función submitRegister: crea o edita pago (usa invokeRecordPayment)
async function submitRegister() {
  try {
    const companyId = selCompany?.value;
    const amount = Number((inpAmount && inpAmount.value) || 0);
    const monthsPaid = Number((inpMonths && inpMonths.value) || 0);
    const promoCode = (inpPromo && inpPromo.value.trim()) || null;
    const affiliateId = (selAffiliate && selAffiliate.value) || null;
    const affiliateFeeVal = Number((affiliateFee && affiliateFee.value) || 0);
    const note = (inpNote && inpNote.value) || null;

    if (!companyId || !amount || monthsPaid <= 0) {
      return alert("Completa campos obligatorios: empresa, monto y meses.");
    }

    // ¿editando?
    const editingPayment = modal?.dataset?.editingPayment;
    const editingCompany = modal?.dataset?.editingCompany;
    if (editingPayment && editingCompany) {
      // Llamar a tu función de edición (transaccional) si existe:
      await editPaymentWithAdjust(editingCompany, editingPayment, {
        amount, monthsPaid, promoCode, affiliateId, affiliateFee: affiliateFeeVal, note
      });
      alert("Pago editado correctamente.");
      if (modal) modal.classList.add("hidden");
      delete modal.dataset.editingPayment;
      delete modal.dataset.editingCompany;
      await loadAll();
      return;
    }

    // crear nuevo pago (llama invokeRecordPayment que hace addDoc + runTransaction)
    const payload = { companyId, amount, monthsPaid, promoCode, affiliateId, affiliateFee: affiliateFeeVal, createdByNote: note };
    const res = await invokeRecordPayment(payload);
    if (res && res.success) {
      alert("Pago registrado: " + res.paymentId);
      if (modal) modal.classList.add("hidden");
      await loadAll();
    } else {
      throw new Error("Respuesta inesperada al guardar pago.");
    }
  } catch (err) {
    console.error("submitRegister error", err);
    alert("Error registrando pago: " + (err.message || err));
  }
}




/* ===========================
   HELPERS
   =========================== */
function escapeHtml(str) {
  if (typeof str!=="string") return str;
  return str.replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

btnReload?.addEventListener("click", async () => {
  await loadAll();
});
