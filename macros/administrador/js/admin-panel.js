// js/admin-panel.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

import {
  getFirestore, collection, getDocs, query, orderBy, doc, getDoc,
  addDoc, setDoc, serverTimestamp
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
const affPct = $("#affPct");

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
    // onAuthStateChanged will handle UI
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
    // create minimal user doc if not exists + company doc
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
    // show auth overlay
    authOverlay.classList.remove("hidden");
    appDiv.classList.add("hidden");
    return;
  }
  // hide auth show app
  authOverlay.classList.add("hidden");
  appDiv.classList.remove("hidden");
  loggedAs.textContent = `Sesión: ${user.email || user.displayName || user.uid}`;
  // load data
  await loadAll();
});

/* logout */
btnLogout?.addEventListener("click", async () => {
  await signOut(auth);
  // will show auth overlay by onAuthStateChanged
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

      // soporta campos "amount" o "monto" o "total"
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
      <td>${a.commissionPct||0}%</td>
      <td><button class="px-2 py-1 border rounded btnPay" data-id="${a.id}">Marcar pago</button></td>`;
    tbAffiliates.appendChild(tr);
  });

  $$(".btnPay").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    if (!confirm("Marcar saldo como pagado (registro local, ejecutar pago real fuera)?")) return;
    // Simplemente marcamos balanceOwed = 0 (si deseas, llamar cloud function)
    try {
      await setDoc(doc(db,"affiliates",id), { balanceOwed: 0 }, { merge: true });
      alert("Saldo marcado como pagado (balance a 0).");
      await loadAffiliates();
    } catch (err) {
      console.error("mark payout error", err);
      alert("Error marcando pago: " + (err.message||err));
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

/* Crear afiliado desde modal */
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
  const pct = Number(affPct.value || 0);
  if (!name) return alert("Nombre requerido");
  try {
    const res = await addDoc(collection(db,"affiliates"), {
      name, phone, commissionPct: pct, balanceOwed: 0, createdAt: serverTimestamp()
    });
    alert("Afiliado creado: " + res.id);
    modalAffiliate.classList.add("hidden");
    affName.value = ""; affPhone.value = ""; affPct.value = "30";
    await loadAffiliates();
  } catch (err) {
    console.error("createAffiliate error", err);
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
    console.error("loadRecentPayments error:", err);
    if (tbPayments) tbPayments.innerHTML = `<tr><td colspan="6">Error cargando pagos.</td></tr>`;
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
      <td>${p.monthsPaid||p.months||0}</td>
      <td>${escapeHtml(p.affiliateId||p.sellerId||'-')}</td>
      <td><button class="px-2 py-1 border rounded btnInvoice" data-company="${p.companyId}" data-id="${p.id}">PDF</button></td>`;
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
      console.error("invoice error", err);
      alert("Error solicitando factura: "+(err.message||err));
    }
  });
}

/* ===========================
   KPIs
   =========================== */
function computeKPIs() {
  kCompanies.textContent = companiesCache.length;
  kRevenue.textContent = money(paymentsCache.reduce((s,p)=>s+Number(p.amount ?? p.monto ?? 0),0));
  const totalComm = affiliatesCache.reduce((s,a)=> s + (Number(a.balanceOwed||0)), 0);
  kCommissions.textContent = money(totalComm);
}

/* ===========================
   STATS (Chart.js) - destruye gráfico previo si existe
   =========================== */
function renderStats() {
  const canvas = document.getElementById("chartRevenue");
  if (!canvas) return;

  // preparar datos
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

  // destruir previo si existe
  try {
    if (revenueChart) {
      revenueChart.destroy();
      revenueChart = null;
    }
  } catch (e) { console.warn("destroy chart err", e); }

  const ctx = canvas.getContext("2d");
  revenueChart = new Chart(ctx,{
    type:"line",
    data:{ labels, datasets:[{ label:"Ingresos", data, borderColor:"rgb(16,185,129)", backgroundColor:"rgba(16,185,129,0.12)", fill:true }] },
    options:{ responsive:true, maintainAspectRatio:false }
  });
}

/* ===========================
   REGISTER PAYMENT (modal)
   =========================== */
btnOpen?.addEventListener("click", () => modal.classList.remove("hidden"));
btnCancel?.addEventListener("click", () => modal.classList.add("hidden"));
btnReload?.addEventListener("click", () => loadAll());

document.getElementById("formRegister").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  await submitRegister();
});

async function submitRegister() {
  const companyId = selCompany.value;
  const amount = Number(inpAmount.value || 0);
  const monthsPaid = Number(inpMonths.value || 0);
  const promoCode = inpPromo.value.trim() || null;
  const affiliateId = selAffiliate.value || null;
  const note = inpNote.value || null;

  if (!companyId || !amount || monthsPaid <= 0) return alert("Completa campos obligatorios");

  try {
    // httpsCallable a la cloud function "recordPayment"
    const recordPayment = httpsCallable(functions, "recordPayment");
    const res = await recordPayment({ companyId, amount, monthsPaid, promoCode, affiliateId, createdByNote: note });
    if (res.data?.success) {
      alert("Pago registrado: " + res.data.paymentId);
      modal.classList.add("hidden");
      await loadAll();
    } else {
      alert("Respuesta inesperada del servidor.");
    }
  } catch (err) {
    console.error("submitRegister error", err);
    alert("Error registrando pago: " + (err.message || err));
  }
}

/* ===========================
   UTILS
   =========================== */
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"'`=\/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'}[c]));
}

/* bootstrap (tabs already client-side) */
document.addEventListener("DOMContentLoaded", () => {
  // nothing else; auth will trigger loadAll()
});
