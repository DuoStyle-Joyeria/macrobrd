// js/admin-panel.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { 
  getFirestore, collection, getDocs, query, orderBy, doc, getDoc 
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

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => `$${Number(n||0).toLocaleString('es-CO',{maximumFractionDigits:2})}`;

/* DOM refs */
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

let companiesCache = [];
let affiliatesCache = [];
let paymentsCache = [];

/* Auth: asegurarnos que admin esté logueado */
onAuthStateChanged(auth, user => {
  if (!user) {
    alert("Inicia sesión con cuenta admin para usar este panel.");
    window.location.href = "/"; // ajustar a tu login
    return;
  }
  loadAll();
});

async function loadAll() {
  await loadCompanies();
  await loadAffiliates();
  await loadRecentPayments();
  computeKPIs();
  renderStats();
}

/* ========== EMPRESAS ========== */
async function loadCompanies() {
  const q = query(collection(db, "companies"), orderBy("createdAt","desc"));
  const snap = await getDocs(q);
  companiesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  await computeBalances();
  renderCompanies();
  populateCompanySelect();
}

async function computeBalances() {
  for (const c of companiesCache) {
    try {
      const compRef = doc(db, "companies", c.id);
      const ingresosSnap = await getDocs(collection(compRef, "ingresos"));
      const egresosSnap = await getDocs(collection(compRef, "egresos"));
      const ventasSnap = await getDocs(collection(compRef, "sales"));

      const ingresos = ingresosSnap.docs.reduce((s,d)=>s+Number(d.data().amount||0),0);
      const egresos = egresosSnap.docs.reduce((s,d)=>s+Number(d.data().amount||0),0);
      const ventas = ventasSnap.docs.reduce((s,d)=>s+Number(d.data().total||0),0);

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

/* ========== AFILIADOS ========== */
async function loadAffiliates() {
  try {
    const q = query(collection(db,"affiliates"), orderBy("createdAt","desc"));
    const snap = await getDocs(q);
    affiliatesCache = snap.docs.map(d=>({ id: d.id, ...d.data() }));
    renderAffiliates();
    populateAffiliateSelect();
  } catch (err) {
    affiliatesCache = [];
    renderAffiliates();
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

/* ========== PAGOS ========== */
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
    tbPayments.innerHTML = `<tr><td colspan="6">Error cargando pagos.</td></tr>`;
  }
}

function renderPayments(arr) {
  if (!tbPayments) return;
  tbPayments.innerHTML = "";
  arr.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${p.createdAt && p.createdAt.seconds ? new Date(p.createdAt.seconds*1000).toLocaleString() : '-'}</td>
      <td>${escapeHtml(p.companyId || '-')}</td>
      <td>${money(p.amount||0)}</td>
      <td>${p.monthsPaid||0}</td>
      <td>${escapeHtml(p.affiliateId||'-')}</td>
      <td><button class="px-2 py-1 border rounded btnInvoice" data-company="${p.companyId}" data-id="${p.id}">PDF</button></td>`;
    tbPayments.appendChild(tr);
  });
}

/* ========== KPIs ========== */
function computeKPIs() {
  kCompanies.textContent = companiesCache.length;
  kRevenue.textContent = money(paymentsCache.reduce((s,p)=>s+Number(p.amount||0),0));
  const totalComm = affiliatesCache.reduce((s,a)=> s + (Number(a.balanceOwed||0)), 0);
  kCommissions.textContent = money(totalComm);
}

/* ========== ESTADÍSTICAS ========== */
function renderStats() {
  const ctx = document.getElementById("chartRevenue");
  if (!ctx) return;
  const monthly = {};
  paymentsCache.forEach(p=>{
    if (p.createdAt?.seconds) {
      const d = new Date(p.createdAt.seconds*1000);
      const key = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}`;
      monthly[key] = (monthly[key]||0) + (p.amount||0);
    }
  });
  const labels = Object.keys(monthly).sort();
  const data = labels.map(l=>monthly[l]);

  new Chart(ctx,{
    type:"line",
    data:{ labels, datasets:[{ label:"Ingresos", data, borderColor:"rgb(16,185,129)", fill:false }] },
    options:{ responsive:true }
  });
}

/* ========== REGISTRO DE PAGO ========== */
btnOpen.addEventListener("click", () => modal.classList.remove("hidden"));
btnCancel.addEventListener("click", () => modal.classList.add("hidden"));
btnReload.addEventListener("click", () => loadAll());

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
    alert("Error registrando pago: "+(err.message||err));
  }
}

/* ========== UTILS ========== */
function escapeHtml(s) { 
  if (!s) return ''; 
  return String(s).replace(/[&<>"'`=\/]/g, c => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'}[c]
  )); 
}

document.addEventListener("DOMContentLoaded", () => {
  // auth dispara load
});
