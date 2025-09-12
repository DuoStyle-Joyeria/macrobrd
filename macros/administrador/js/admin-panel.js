// js/admin-panel.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import { getFirestore, collection, getDocs, query, orderBy, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js";

/* ========== CONFIG (reemplaza si fuera necesario) ========== */
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

/* Auth: asegurarnos que admin esté logueado */
onAuthStateChanged(auth, user => {
  if (!user) {
    alert("Inicia sesión con cuenta admin para usar este panel.");
    window.location.href = "/"; // ajustar a tu login
    return;
  }
  // carga inicial
  loadAll();
});

async function loadAll() {
  await loadCompanies();
  await loadAffiliates();
  await loadRecentPayments();
  computeKPIs();
}

async function loadCompanies() {
  const q = query(collection(db, "companies"), orderBy("createdAt","desc"));
  const snap = await getDocs(q);
  companiesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCompanies();
  populateCompanySelect();
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
      <td>
        <button class="px-2 py-1 border rounded btnView" data-id="${c.id}">Ver</button>
        <button class="px-2 py-1 border rounded btnInvoices" data-id="${c.id}">Facturas</button>
      </td>`;
    tbCompanies.appendChild(tr);
  });

  $$(".btnView").forEach(b => b.onclick = async (e) => {
    const id = b.dataset.id;
    const doc = await getDoc(docRef("companies", id));
    alert(JSON.stringify(doc.data(), null, 2));
  });

  $$(".btnInvoices").forEach(b => b.onclick = async (e) => {
    const id = b.dataset.id;
    // show all payments -> generate combined PDF via client (simple) or call cloud function
    const gen = httpsCallable(functions, "generateInvoice");
    alert("Para descargar factura individual usa el botón PDF en la lista de pagos.");
  });
}

function docRef(col, id) { return doc(db, col, id); }

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

async function loadAffiliates() {
  try {
    const q = query(collection(db,"affiliates"), orderBy("createdAt","desc"));
    const snap = await getDocs(q);
    affiliatesCache = snap.docs.map(d=>({ id: d.id, ...d.data() }));
    renderAffiliates();
    populateAffiliateSelect();
  } catch (err) {
    console.warn("No hay collection 'affiliates' o error:", err);
    affiliatesCache = [];
    renderAffiliates();
  }
}

function renderAffiliates() {
  if (!tbAffiliates) return;
  tbAffiliates.innerHTML = "";
  affiliatesCache.forEach(a => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(a.id)}</td><td>${money(a.balanceOwed||0)}</td><td><button class="px-2 py-1 border rounded btnPay" data-id="${a.id}">Marcar pago</button></td>`;
    tbAffiliates.appendChild(tr);
  });
  $$(".btnPay").forEach(b => b.onclick = async () => {
    const id = b.dataset.id;
    if (!confirm("Marcar saldo como pagado (solo marca local, debes ejecutar el pago real fuera)?")) return;
    // llamada a función o actualización según tu seguridad
    alert("Implementa payout con Cloud Function; aquí solo se marca manual.");
  });
}

function populateAffiliateSelect() {
  if (!selAffiliate) return;
  selAffiliate.innerHTML = `<option value="">— Ninguno —</option>`;
  affiliatesCache.forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.text = `${a.id} — ${money(a.balanceOwed||0)}`;
    selAffiliate.appendChild(opt);
  });
}

async function loadRecentPayments() {
  try {
    const q = query(collection(db, "companies"), orderBy("createdAt","desc"));
    // We'll get recent payments via collectionGroup 'payments'
    const paymentsSnap = await getDocs(query(collection(db, "companies").doc().collectionGroup?.('payments') || collection(db, "companies"))); 
    // Note: above line is placeholder; collectionGroup is not trivial in client - we'll instead fetch per-company small set (simpler)
    // For this admin panel immediate usage: we'll load first 50 from each company (inefficient for big scale)
    const payments = [];
    for (const c of companiesCache) {
      const ps = await getDocs(query(collection(db, "companies").doc(c.id).collection("payments"), orderBy("createdAt","desc")));
      ps.docs.forEach(d => payments.push({ companyId: c.id, id: d.id, ...d.data() }));
    }
    renderPayments(payments.slice(0,200));
  } catch (err) {
    console.error("loadRecentPayments error:", err);
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
      <td>${p.monthsPaid||p.months||0}</td>
      <td>${escapeHtml(p.affiliateId||p.sellerId||'-')}</td>
      <td><button class="px-2 py-1 border rounded btnInvoice" data-company="${p.companyId}" data-id="${p.id}">PDF</button></td>`;
    tbPayments.appendChild(tr);
  });

  $$(".btnInvoice").forEach(b => b.onclick = async (e) => {
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
    } catch (err) { console.error(err); alert("Error solicitando factura: "+(err.message||err)); }
  });
}

function computeKPIs() {
  kCompanies.textContent = companiesCache.length;
  kRevenue.textContent = 'Usar aggregates server (no disponible localmente)';
  const totalComm = affiliatesCache.reduce((s,a)=> s + (Number(a.balanceOwed||0)), 0);
  kCommissions.textContent = money(totalComm);
}

/* Modal handlers */
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
    const res = await recordPayment({ companyId, amount, monthsPaid, promoCode, affiliateId, sellerId: affiliateId, createdByNote: note });
    if (res.data && res.data.success) {
      alert("Pago registrado: " + res.data.paymentId);
      modal.classList.add("hidden");
      await loadAll();
    } else {
      alert("Respuesta inesperada del servidor.");
    }
  } catch (err) {
    console.error("submitRegister error", err);
    alert("Error registrando pago: "+(err.message||err));
  }
}

function escapeHtml(s) { if (!s) return ''; return String(s).replace(/[&<>"'`=\/]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'}[c])); }

/* bootstrap load */
document.addEventListener("DOMContentLoaded", () => {
  // nothing extra; auth triggers load
});
