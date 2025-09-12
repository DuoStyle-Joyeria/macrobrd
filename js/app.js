

/**************************************************************************
 * FIREBASE CONFIG
 **************************************************************************/
const firebaseConfig = {
  apiKey: "AIzaSyCTFSlLoKv6KKujTqjMeMjNc-AlKQ2-rng",
  authDomain: "duostyle01-611b9.firebaseapp.com",
  projectId: "duostyle01-611b9",
  storageBucket: "duostyle01-611b9.firebasestorage.app",
  messagingSenderId: "4630065257",
  appId: "1:4630065257:web:11b7b0a0ac2fa776bbf2f8",
  measurementId: "G-FW6QEJMZKT"
};

/* ======================
   IMPORTS (Firebase modular SDK)
   ====================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";

import {
  getFirestore, doc, setDoc, getDoc, addDoc, getDocs, onSnapshot,
  collection, query, orderBy, serverTimestamp, updateDoc, deleteDoc,
  runTransaction, where, limit
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js";

/* ======================
   INIT
   ====================== */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

/* ======================
   HELPERS UI
   ====================== */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const money = n => `$${Number(n||0).toLocaleString('es-CO',{maximumFractionDigits:2})}`;

/* ======================
   STATE
   ====================== */
let currentUser = null;
let companyId = null;
let unsubscribers = [];
let inventoryCache = new Map();
let salesCache = [];
let userRole = "admin"; // 'admin' | 'empleado'

/* ======================
   AUTH: login / register (UI)
   - Nota: dejamos el registro por cliente solo para ADMIN.
   - Crear EMPLEADOS debe hacerlo el ADMIN desde el panel (usa Cloud Function).
   ====================== */
const regRoleSel = $("#regRole");
const employeeExtra = $("#employeeExtra");
regRoleSel?.addEventListener("change", () => {
  if (!employeeExtra) return;
  employeeExtra.classList.toggle("hidden", regRoleSel.value !== "empleado");
});

$("#loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim();
  const pass = $("#loginPass").value.trim();
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    alert("Error login: " + err.message);
  }
});

$("#registerForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#regName").value.trim();
  const email = $("#regEmail").value.trim();
  const pass = $("#regPass").value.trim();
  const role = $("#regRole").value || "admin";

  if (role === "empleado") {
    alert("Los empleados deben ser creados por un administrador desde el panel (no por registro público).");
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await updateProfile(cred.user, { displayName: name });

    // usuario doc
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

    // company doc
    await setDoc(doc(db, "companies", cid), {
      name: `${name} — Empresa`,
      owners: [{ uid, name }],
      createdAt: serverTimestamp(),
      planActive: true
    });

    // balances iniciales
    await setDoc(doc(db, "companies", cid, "state", "balances"), { cajaEmpresa: 0, deudasTotales: 0 });

    alert("Cuenta de administrador creada. Inicia sesión.");
  } catch (err) {
    console.error("register error:", err);
    alert("Error creating account: " + err.message);
  }
});

$("#btnLogout")?.addEventListener("click", () => signOut(auth));

/* ======================
   onAuthStateChanged: multi-tenant + planActive + role
   ====================== */
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  // cleanup subs
  unsubscribers.forEach(u => u && u());
  unsubscribers = [];
  inventoryCache.clear();
  salesCache = [];
  userRole = "admin";
  companyId = null;

  if (!user) {
    $("#authView").classList.remove("hidden");
    $("#mainView").classList.add("hidden");
    return;
  }

  try {
    // load user doc (if missing, create minimal fallback)
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      // fallback (this should be rare)
      await setDoc(userRef, {
        displayName: user.displayName || "User",
        email: user.email || null,
        role: "admin",
        planActive: true,
        companyId: `${user.uid}-company`,
        createdAt: serverTimestamp()
      });
    }
    const userData = (await getDoc(userRef)).data();
    userRole = userData?.role || "admin";
    companyId = userData?.companyId || `${user.uid}-company`;

    // load company doc (create if missing)
    const compRef = doc(db, "companies", companyId);
    if (!(await getDoc(compRef)).exists()) {
      await setDoc(compRef, {
        name: `${user.displayName || "Empresa"} — Empresa`,
        owners: [{ uid: user.uid, name: user.displayName || "Owner" }],
        createdAt: serverTimestamp(),
        planActive: true
      });
      await setDoc(doc(db, "companies", companyId, "state", "balances"), { cajaEmpresa: 0, deudasTotales: 0 });
    }
    const compData = (await getDoc(compRef)).data();

    // check planActive
    if (compData && compData.planActive === false) {
      alert("⚠️ Esta empresa está INACTIVA. Contacta soporte.");
      await signOut(auth);
      return;
    }

    // show UI
    $("#authView").classList.add("hidden");
    $("#mainView").classList.remove("hidden");
    $("#companyName").textContent = compData?.name || "Empresa — Demo";
    $("#userRole").textContent = `Rol: ${userRole}`;
    const lbl = $("#companyIdLabel"); if (lbl) lbl.textContent = companyId;

    // realtime listener company -> sign out if planActive switches to false
    const unsubComp = onSnapshot(compRef, snap => {
      const d = snap.exists() ? snap.data() : null;
      if (d && d.planActive === false) {
        alert("El plan fue desactivado. Se cerrará la sesión.");
        signOut(auth);
      }
    });
    unsubscribers.push(unsubComp);

    // init UI & subs
    setupTabs();
    setupInventoryHandlers();
    setupPosHandlers();
    setupPosSearch();
    setupCharts();
    setupCajaControls();
    setupEgresosHandlers();
    setupIngresosHandlers();

    subscribeInventory();
    subscribeSales();
    subscribeBalances();
    await loadSalesOnce();
    await loadEgresosOnce();
    await loadIngresosOnce();
    await loadMovimientos("7d");

    // users (admin functions) - render list & hook create employee
    setupUsersHandlers();
    subscribeUsersIfAdmin();

    // role-based UI
    applyRoleVisibility();

  } catch (err) {
    console.error("onAuthStateChanged error:", err);
    try { await signOut(auth); } catch(e) {}
    alert("Error verificando cuenta. Intenta de nuevo.");
  }
});

function applyRoleVisibility() {
  const cajaEmpresa = document.querySelector(".caja-empresa");

  if (userRole === "empleado") {
    // 🔒 Mostrar solo ventas de hoy en la caja empresa
    if (cajaEmpresa) {
      cajaEmpresa.innerHTML = `
        <h3>💰 Ventas de hoy</h3>
        <p id="ventas-hoy-valor" style="font-size:1.5rem;font-weight:bold;color:#10b981;">
          Cargando...
        </p>
      `;
      cargarVentasHoy();
    }

    // 🔒 Mostrar solo pestañas permitidas
    $$(".tab-btn").forEach(btn => {
      const t = btn.dataset.tab;
      btn.style.display = (t === "ventas" || t === "egresos" || t === "ingresos" || t === "inventario") ? "" : "none";
    });
    $("[data-tab='ventas']").click();

  } else {
    // 🔓 Jefes: acceso completo (dejas la caja original normal)
    $$(".tab-btn").forEach(btn => btn.style.display = "");
  }
}

/* ======================
   Función que calcula SOLO ventas de hoy
   ====================== */
async function cargarVentasHoy() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  try {
    const salesRef = collection(db, "ventas");
    const q = query(
      salesRef,
      where("fecha", ">=", today),
      where("fecha", "<", tomorrow)
    );
    const querySnapshot = await getDocs(q);

    let totalHoy = 0;
    querySnapshot.forEach(doc => {
      totalHoy += doc.data().monto || 0;
    });

    const ventasHoyValor = document.getElementById("ventas-hoy-valor");
    if (ventasHoyValor) {
      ventasHoyValor.textContent = `$${totalHoy.toLocaleString("es-CO")}`;
    }
  } catch (err) {
    console.error("❌ Error al cargar ventas del día:", err);
    const ventasHoyValor = document.getElementById("ventas-hoy-valor");
    if (ventasHoyValor) {
      ventasHoyValor.textContent = "Error al cargar";
    }
  }
}


/* ======================
   TABS UI
   ====================== */
function setupTabs() {
  $$(".tab-btn").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.tab;
      $$(".tab-btn").forEach(b => b.classList.remove("bg-slate-900","text-white"));
      btn.classList.add("bg-slate-900","text-white");
      $$(".tab").forEach(t => t.classList.add("hidden"));
      const el = $(`#tab-${id}`);
      if (el) el.classList.remove("hidden");
    };
  });
  $("[data-tab='ventas']").click();
}

/* ======================
   SUBSCRIPTIONS (inventory / sales / balances)
   ====================== */
function subscribeInventory() {
  const invCol = collection(db, "companies", companyId, "inventory");
  const q = query(invCol, orderBy("name"));
  const unsub = onSnapshot(q, snap => {
    snap.docChanges().forEach(ch => {
      const id = ch.doc.id;
      const data = { id, ...ch.doc.data() };
      if (ch.type === "removed") inventoryCache.delete(id);
      else inventoryCache.set(id, data);
    });
    renderInventoryTable();
    populateProductSelects();
    updateInventarioKPI();
  });
  unsubscribers.push(unsub);
}

async function loadSalesOnce() {
  try {
    const q = query(collection(db, "companies", companyId, "sales"), orderBy("createdAt"));
    const docs = await getDocs(q);
    salesCache = docs.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSalesTable();
    updateCharts();
  } catch (err) { console.error("loadSalesOnce", err); }
}

function subscribeSales() {
  const salesCol = collection(db, "companies", companyId, "sales");
  const q = query(salesCol, orderBy("createdAt","desc"));
  const unsub = onSnapshot(q, snap => {
    salesCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderSalesTable();
    updateCharts();
  });
  unsubscribers.push(unsub);
}

function subscribeBalances() {
  const ref = doc(db, "companies", companyId, "state", "balances");
  const unsub = onSnapshot(ref, snap => {
    const d = snap.exists() ? snap.data() : {};
    $("#kpiCajaEmpresa").textContent = money(d.cajaEmpresa || 0);
    $("#kpiDeudas").textContent = money(d.deudasTotales || 0);
  });
  unsubscribers.push(unsub);
}

function updateInventarioKPI() {
  let total = 0;
  for (const p of inventoryCache.values()) total += Number(p.stock || 0);
  $("#kpiInventarioTotal").textContent = total;
}

/* ======================
   INVENTORY CRUD
   ====================== */
function setupInventoryHandlers() {
  $("#btnCreateProduct")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await handleCreateProduct();
  });
}

async function handleCreateProduct() {
  const name = $("#prodName").value.trim();
  if (!name) return alert("Nombre requerido");
  const sku = $("#prodSku").value.trim() || null;
  const gender = $("#prodGender").value.trim() || null;
  const size = $("#prodSize").value.trim() || null;
  const color = $("#prodColor").value.trim() || null;
  const team = $("#prodTeam").value.trim() || null;
  const cost = Number($("#prodCost").value || 0);
  const price = Number($("#prodPrice").value || 0);
  const initialStock = Number($("#prodInitialStock").value || 0);
  const notes = $("#prodNotes").value.trim() || null;

  try {
    const newRef = doc(collection(db, "companies", companyId, "inventory"));
    await setDoc(newRef, {
      name, sku, attributes: { gender, size, color, team },
      cost, price, stock: initialStock, notes, createdAt: serverTimestamp()
    });

    await runTransaction(db, async (tx) => {
      const batchRef = doc(collection(db, "companies", companyId, "inventory", newRef.id, "batches"));
      tx.set(batchRef, { quantity_added: initialStock, remaining: initialStock, received_at: serverTimestamp(), note: "Stock inicial" });
      const movRef = doc(collection(db, "companies", companyId, "stock_movements"));
      tx.set(movRef, { productId: newRef.id, qty: initialStock, type: "in", note: "Stock inicial", refId: newRef.id, createdAt: serverTimestamp() });
    });

    // limpiar
    ["#prodName","#prodSku","#prodGender","#prodSize","#prodColor","#prodTeam","#prodCost","#prodPrice","#prodInitialStock","#prodNotes"].forEach(s => { try { $(s).value=""; } catch(e){} });
    alert("Producto creado correctamente");
  } catch (err) {
    console.error("handleCreateProduct error", err);
    alert("Error creando producto: " + err.message);
  }
}

function renderInventoryTable() {
  const tb = $("#tbInventory");
  if (!tb) return;
  tb.innerHTML = "";
  const arr = Array.from(inventoryCache.values());
  if (!arr.length) {
    tb.innerHTML = `<tr><td colspan="5" class="small text-slate-500">No hay productos aún.</td></tr>`;
    // aplicar paginador (vacío)
    aplicarPaginacion("tbInventory", "pagerInventory", 10);
    return;
  }
  arr.forEach(p => {
    const attrs = [];
    if (p.attributes?.gender) attrs.push(p.attributes.gender);
    if (p.attributes?.size) attrs.push(p.attributes.size);
    if (p.attributes?.color) attrs.push(p.attributes.color);
    if (p.attributes?.team) attrs.push(p.attributes.team);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${escapeHtml(p.name)}</strong><div class="text-xs text-slate-500">${p.sku || ''}</div></td>
      <td class="small">${attrs.join(' • ')}</td>
      <td>${money(p.price)}</td>
      <td>${Number(p.stock || 0)}</td>
      <td>
        <button data-id="${p.id}" class="btnAddStock px-2 py-1 border rounded text-sm">+ Stock</button>
        <button data-id="${p.id}" class="btnEditProduct px-2 py-1 border rounded text-sm">Editar</button>
        <button data-id="${p.id}" class="btnDeleteProduct px-2 py-1 border rounded text-sm">Borrar</button>
      </td>
    `;
    tb.appendChild(tr);
  });

  $$(".btnAddStock").forEach(b => b.onclick = (ev) => promptAddStock(ev.currentTarget.dataset.id));
  $$(".btnDeleteProduct").forEach(b => b.onclick = (ev) => { if (confirm("Borrar producto?")) deleteProduct(ev.currentTarget.dataset.id); });
  $$(".btnEditProduct").forEach(b => b.onclick = (ev) => editProductModal(ev.currentTarget.dataset.id));

  // paginador inventario
  aplicarPaginacion("tbInventory", "pagerInventory", 10);
}

async function promptAddStock(productId) {
  const qtyStr = prompt("¿Cuántas unidades quieres añadir al stock?");
  if (!qtyStr) return;
  const qty = Number(qtyStr);
  if (!qty || qty <= 0) return alert("Cantidad inválida");
  const note = prompt("Nota (opcional)", "Producción semanal");

  try {
    await runTransaction(db, async (tx) => {
      const prodRef = doc(db, "companies", companyId, "inventory", productId);
      const prodSnap = await tx.get(prodRef);
      if (!prodSnap.exists()) throw new Error("Producto no existe");
      const newStock = Number(prodSnap.data().stock || 0) + qty;
      tx.update(prodRef, { stock: newStock });

      const batchRef = doc(collection(db, "companies", companyId, "inventory", productId, "batches"));
      tx.set(batchRef, { quantity_added: qty, remaining: qty, received_at: serverTimestamp(), note: note || null });

      const movRef = doc(collection(db, "companies", companyId, "stock_movements"));
      tx.set(movRef, { productId, qty, type: "in", note: note || null, refId: batchRef.id, createdAt: serverTimestamp() });
    });
    alert("Stock actualizado");
  } catch (err) {
    console.error("promptAddStock error", err);
    alert("Error en agregar stock: " + err.message);
  }
}

async function deleteProduct(productId) {
  try {
    await deleteDoc(doc(db, "companies", companyId, "inventory", productId));
    alert("Producto eliminado");
  } catch (err) {
    console.error(err);
    alert("Error al eliminar");
  }
}

function editProductModal(productId) {
  const p = inventoryCache.get(productId);
  if (!p) return alert("No encontrado");
  const newPrice = prompt("Nuevo precio", p.price || 0);
  if (newPrice === null) return;
  const newCost = prompt("Nuevo costo", p.cost || 0);
  if (newCost === null) return;
  updateDoc(doc(db, "companies", companyId, "inventory", productId), { price: Number(newPrice), cost: Number(newCost) })
    .then(() => alert("Producto actualizado")).catch(err => { console.error(err); alert("Error actualizando"); });
}

/* ======================
   POS / VENTAS
   ====================== */
function setupPosHandlers() {
  $("#btnAddCartLine").onclick = () => createCartLine();
  $("#btnClearCart").onclick   = () => { $("#cartBody").innerHTML = ""; updateCartTotal(); };
  $("#btnSubmitSale").onclick  = submitSaleHandler;
  $("#btnExportSalesRange")?.addEventListener("click", exportSalesRangePrompt);
  
}

function createCartLine() {
  const tr = document.createElement("tr");
  const selectHtml = `
    <div>
      <input type="text" class="prodSearch w-full border rounded p-1 mb-1" placeholder="Buscar producto (nombre, color, talla, sku...)">
      <select class="prodSelect w-full border rounded p-1">
        <option value="">-- seleccionar --</option>
      </select>
    </div>
  `;
  tr.innerHTML = `
    <td>${selectHtml}</td>
    <td><input type="number" class="lineQty border rounded p-1 w-24" min="1" value="1"></td>
    <td><input type="number" class="linePrice border rounded p-1 w-32" min="0" step="0.01"></td>
    <td class="lineSubtotal">${money(0)}</td>
    <td><button class="btnRemoveLine px-2 py-1 border rounded">Eliminar</button></td>
  `;
  $("#cartBody").appendChild(tr);

  const selectEl = tr.querySelector(".prodSelect");
  const searchInput = tr.querySelector(".prodSearch");
  populateProductSelectElement(selectEl);

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    Array.from(selectEl.options).forEach(opt => {
      if (!opt.value) { opt.hidden = false; return; }
      opt.hidden = q ? !opt.text.toLowerCase().includes(q) : false;
    });
  });
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = Array.from(selectEl.options).find(o => !o.hidden && o.value);
      if (first) {
        selectEl.value = first.value;
        selectEl.dispatchEvent(new Event('change'));
      }
    }
  });

  selectEl.onchange = (e) => {
    const pid = e.target.value;
    if (!pid) {
      tr.querySelector(".linePrice").value = 0;
      tr.querySelector(".lineQty").value   = 1;
      updateLineSubtotal(tr);
      return;
    }
    const p = inventoryCache.get(pid);
    tr.dataset.productId = pid;
    tr.querySelector(".linePrice").value = p.price || 0;
    tr.querySelector(".lineQty").value   = 1;
    updateLineSubtotal(tr);
  };

  tr.querySelector(".lineQty").oninput   = () => updateLineSubtotal(tr);
  tr.querySelector(".linePrice").oninput = () => updateLineSubtotal(tr);
  tr.querySelector(".btnRemoveLine").onclick = () => { tr.remove(); updateCartTotal(); };
}

function populateProductSelectElement(selectEl) {
  const current = selectEl.value || "";
  selectEl.innerHTML = `<option value="">-- seleccionar --</option>`;
  Array.from(inventoryCache.values()).forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.id;
    const attrs = [];
    if (p.attributes?.gender) attrs.push(p.attributes.gender);
    if (p.attributes?.size)   attrs.push(p.attributes.size);
    if (p.attributes?.color)  attrs.push(p.attributes.color);
    if (p.attributes?.team)   attrs.push(p.attributes.team);
    const skuPart = p.sku ? ` SKU:${p.sku}` : '';
    opt.text = `${p.name} ${attrs.length ? "(" + attrs.join(" • ") + ")" : ""}${skuPart} — Stock: ${p.stock || 0}`;
    selectEl.appendChild(opt);
  });
  if (current) selectEl.value = current;
}

function populateProductSelects() { $$(".prodSelect").forEach(sel => populateProductSelectElement(sel)); }

function updateLineSubtotal(tr) {
  const q = Number(tr.querySelector(".lineQty").value || 0);
  const p = Number(tr.querySelector(".linePrice").value || 0);
  const sub = q * p;
  tr.querySelector(".lineSubtotal").textContent = money(sub);
  updateCartTotal();
}

function updateCartTotal() {
  const rows = Array.from($("#cartBody").querySelectorAll("tr"));
  let total = 0;
  rows.forEach(r => {
    const subStr = r.querySelector(".lineSubtotal").textContent || "$0";
    const sub = Number(subStr.replace(/\$/g,'').replace(/\./g,'').replace(/\,/g,'.')) || 0;
    total += sub;
  });
  $("#cartTotal").textContent = money(total);
}

function setupPosSearch() {
  const input = $("#posSearchInput");
  const resultsDiv = $("#posSearchResults");
  if (!input) return;

  document.addEventListener("click", (ev) => {
    if (!resultsDiv.contains(ev.target) && !input.contains(ev.target)) resultsDiv.classList.add("hidden");
  });

  input.oninput = () => {
    const q = normalizeForSearch(input.value.trim());
    resultsDiv.innerHTML = "";
    if (!q) { resultsDiv.classList.add("hidden"); return; }

    const matches = Array.from(inventoryCache.values()).filter(p => {
      const haystack = [
        p.name, p.sku, p.attributes?.gender, p.attributes?.size, p.attributes?.color, p.attributes?.team
      ].filter(Boolean).map(normalizeForSearch).join(" ");
      return haystack.includes(q);
    });

    if (!matches.length) {
      resultsDiv.innerHTML = `<div class="p-2 text-slate-500">Sin resultados</div>`;
      resultsDiv.classList.remove("hidden");
      return;
    }

    matches.forEach(p => {
      const div = document.createElement("div");
      div.className = "p-2 hover:bg-slate-100 cursor-pointer text-sm";
      div.dataset.pid = p.id;
      const attrs = [];
      if (p.attributes?.gender) attrs.push(p.attributes.gender);
      if (p.attributes?.size)   attrs.push(p.attributes.size);
      if (p.attributes?.color)  attrs.push(p.attributes.color);
      if (p.attributes?.team)   attrs.push(p.attributes.team);
      div.textContent = `${p.name}${attrs.length ? " (" + attrs.join(" • ") + ")" : ""} — Stock: ${p.stock || 0}`;
      div.onclick = () => { addProductToCart(p.id); resultsDiv.classList.add("hidden"); input.value = ""; };
      resultsDiv.appendChild(div);
    });

    resultsDiv.classList.remove("hidden");
  };

  input.onkeydown = (ev) => {
    if (ev.key === "Enter") {
      const candidate = resultsDiv.querySelector("div[data-pid]");
      if (candidate) {
        addProductToCart(candidate.dataset.pid);
        resultsDiv.classList.add("hidden");
        input.value = "";
        ev.preventDefault();
      }
    }
  };
}

function addProductToCart(productId) {
  const prod = inventoryCache.get(productId);
  if (!prod) return alert("Producto no encontrado");

  const tr = document.createElement("tr");
  tr.dataset.productId = productId;
  tr.innerHTML = `
    <td>${escapeHtml(prod.name)}</td>
    <td><input type="number" class="lineQty border rounded p-1 w-24" min="1" value="1"></td>
    <td><input type="number" class="linePrice border rounded p-1 w-32" min="0" step="0.01" value="${Number(prod.price || 0)}"></td>
    <td class="lineSubtotal">${money(Number(prod.price || 0))}</td>
    <td><button class="btnRemoveLine px-2 py-1 border rounded">Eliminar</button></td>
  `;
  $("#cartBody").appendChild(tr);

  tr.querySelector(".lineQty").oninput = () => updateLineSubtotal(tr);
  tr.querySelector(".linePrice").oninput = () => updateLineSubtotal(tr);
  tr.querySelector(".btnRemoveLine").onclick = () => { tr.remove(); updateCartTotal(); };

  updateLineSubtotal(tr);
}

async function submitSaleHandler() {
  const rows = Array.from($("#cartBody").querySelectorAll("tr"));
  if (!rows.length) return alert("El carrito está vacío");

  const items = [];
  for (const r of rows) {
    const pid = r.dataset.productId;
    if (!pid) return alert("Selecciona producto en todas las líneas");
    const qty = Number(r.querySelector(".lineQty").value || 0);
    const price = Number(r.querySelector(".linePrice").value || 0);
    if (qty <= 0) return alert("Cantidad inválida");
    const prod = inventoryCache.get(pid);
    if (!prod) return alert("Producto no encontrado (recarga)");
    items.push({ productId: pid, name: prod.name, qty, price });
  }
  const total = items.reduce((s, it) => s + (it.qty * it.price), 0);
  const saleDoc = {
    createdAt: serverTimestamp(),
    createdBy: currentUser.uid,
    client: $("#saleClient").value.trim() || null,
    type: $("#saleType").value,
    channel: $("#saleChannel").value,
    total, items
  };

  try {
    await runTransaction(db, async (tx) => {
      // Productos
      const prodSnaps = {};
      for (const it of items) {
        const prodRef = doc(db, "companies", companyId, "inventory", it.productId);
        const snap = await tx.get(prodRef);
        if (!snap.exists()) throw new Error(`Producto ${it.name} no existe`);
        prodSnaps[it.productId] = { ref: prodRef, data: snap.data() };
      }

      // Balances
      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const balancesSnap = await tx.get(balancesRef);
      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;

      // validar stock
      for (const it of items) {
        const currentStock = Number(prodSnaps[it.productId].data.stock || 0);
        if (currentStock < it.qty) throw new Error(`Stock insuficiente para ${it.name}. Disponible: ${currentStock}`);
      }

      // actualizar stock
      for (const it of items) {
        const prodRef = prodSnaps[it.productId].ref;
        const currentStock = Number(prodSnaps[it.productId].data.stock || 0);
        tx.update(prodRef, { stock: currentStock - it.qty });
      }

      // crear venta
      const saleRef = doc(collection(db, "companies", companyId, "sales"));
      tx.set(saleRef, saleDoc);

      // movimientos de stock
      for (const it of items) {
        const movRef = doc(collection(db, "companies", companyId, "stock_movements"));
        tx.set(movRef, { productId: it.productId, qty: -it.qty, type: "out", note: `Venta (${it.qty} x ${it.name})`, refId: saleRef.id, createdAt: serverTimestamp() });
      }

      // movimiento caja
      const movCajaRef = doc(collection(db, "companies", companyId, "movements"));
      tx.set(movCajaRef, { tipo: "ingreso", cuenta: "cajaEmpresa", fecha: new Date().toISOString().slice(0,10), monto: total, desc: `Venta total ID ${saleRef.id}`, saleId: saleRef.id, createdAt: serverTimestamp() });

      // actualizar balances
      const newCaja = oldCaja + Number(total || 0);
      if (balancesSnap.exists()) tx.update(balancesRef, { cajaEmpresa: newCaja });
      else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });
    });

    alert("Venta registrada correctamente");
    $("#cartBody").innerHTML = "";
    updateCartTotal();
  } catch (err) {
    console.error("submitSaleHandler error:", err);
    alert("Error al crear venta: " + (err.message || err));
  }
}

/* ======================
   ELIMINAR VENTA
   ====================== */
async function deleteSale(ventaId) {
  try {
    await runTransaction(db, async (tx) => {
      const ventaRef = doc(db, "companies", companyId, "sales", ventaId);
      const ventaSnap = await tx.get(ventaRef);
      if (!ventaSnap.exists()) throw new Error("Venta no encontrada");
      const venta = ventaSnap.data();

      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const balancesSnap = await tx.get(balancesRef);
      const balances = balancesSnap.exists() ? balancesSnap.data() : { cajaEmpresa: 0 };

      const productos = [];
      if (Array.isArray(venta.items)) {
        for (const item of venta.items) {
          const prodRef = doc(db, "companies", companyId, "inventory", item.productId);
          const prodSnap = await tx.get(prodRef);
          if (prodSnap.exists()) productos.push({ ref: prodRef, data: prodSnap.data(), item });
        }
      }

      // reponer stock
      for (const { ref, data, item } of productos) {
        const newStock = (Number(data.stock || 0) + Number(item.qty || 0));
        tx.update(ref, { stock: newStock });
      }

      const totalVenta = Number(venta.total || 0);
      const movRef = doc(collection(db, "companies", companyId, "movements"));
      tx.set(movRef, { tipo: "egreso", cuenta: "cajaEmpresa", fecha: new Date().toISOString().slice(0,10), monto: totalVenta, desc: `Eliminación venta ID ${ventaId}`, saleId: ventaId, createdAt: serverTimestamp() });

      const newCaja = (Number(balances.cajaEmpresa || 0) - totalVenta);
      if (balancesSnap.exists()) tx.update(balancesRef, { cajaEmpresa: newCaja });
      else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });

      tx.delete(ventaRef);
    });

    alert("Venta eliminada correctamente y caja/stock ajustados.");
  } catch (err) {
    console.error("Error al eliminar venta:", err);
    alert("Error al eliminar venta: " + (err.message || err));
  }
}

/* ======================
   RENDER ventas (tabla)
   ====================== */
function renderSalesTable() {
  const tbody = $("#tbVentas");
  if (!tbody) return;
  tbody.innerHTML = "";

  salesCache.forEach(sale => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="border px-2 py-1">${new Date(sale.createdAt?.toDate?.() || Date.now()).toLocaleString()}</td>
      <td class="border px-2 py-1">${sale.client || '-'}</td>
      <td class="border px-2 py-1">${money(sale.total)}</td>
      <td class="border px-2 py-1">${(sale.items || []).map(i => `${i.qty} x ${i.name}`).join("<br>")}</td>
      <td class="border px-2 py-1">
        <button class="bg-red-500 text-white px-2 py-1 rounded text-xs delete-sale" data-id="${sale.id}">Eliminar</button>
        <button class="bg-slate-800 text-white px-2 py-1 rounded text-xs ml-1 btnDownloadSalePdf" data-id="${sale.id}">PDF</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  $$(".delete-sale").forEach(btn => {
    btn.onclick = async () => {
      const saleId = btn.dataset.id;
      if (confirm("¿Seguro que deseas eliminar esta venta?")) await deleteSale(saleId);
    };
  });

  $$(".btnDownloadSalePdf").forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.id;
    const saleSnap = await getDoc(doc(db, "companies", companyId, "sales", id));
    if (!saleSnap.exists()) return alert("Venta no encontrada");
    const sale = saleSnap.data();
    downloadSalePdf(id, sale);
  });

  aplicarPaginacion("tbVentas", "pagerVentas", 10);
}
/* ======================
   PDF helpers (ventas / egresos / ingresos / movimientos)
   ====================== */
async function downloadSalePdf(saleId, sale) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("Factura", 14, 20);
    doc.setFontSize(10);
    doc.text(`ID: ${saleId}`, 14, 28);
    doc.text(`Fecha: ${new Date(sale.createdAt?.toDate?.() || Date.now()).toLocaleString()}`, 14, 34);
    if (sale.client) doc.text(`Cliente: ${sale.client}`, 14, 40);
    doc.text(`Total: ${money(sale.total)}`, 14, 46);

    const rows = (sale.items || []).map(it => [it.name, String(it.qty), money(it.price), money(it.qty * it.price)]);
    doc.autoTable({
      startY: 60,
      head: [['Producto','Cant.','Precio','Subtotal']],
      body: rows
    });

    doc.save(`factura_${saleId}.pdf`);
  } catch (err) {
    console.error("downloadSalePdf error", err);
    alert("Error generando PDF: " + err.message);
  }
}

async function exportCollectionToPdf(title, docsArray, columns, filename) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(title, 14, 20);
    doc.setFontSize(10);

    // Convertir documentos a filas
    const rows = docsArray.map(d => columns.map(c => {
      const v = d[c.key];
      if (c.format === 'money') return money(v);
      if (c.format === 'date') {
        return d.createdAt?.toDate
          ? d.createdAt.toDate().toLocaleString()
          : (d.fecha || '-');
      }
      return v ?? '-';
    }));

    // 👉 Calcular total solo si hay una columna money
    const moneyColIndex = columns.findIndex(c => c.format === 'money');
    if (moneyColIndex >= 0) {
      const total = docsArray.reduce((acc, d) => acc + Number(d[columns[moneyColIndex].key] || 0), 0);
      const totalRow = Array(columns.length).fill("");
      totalRow[moneyColIndex] = money(total);
      totalRow[0] = "TOTAL GENERAL";
      rows.push(totalRow);
    }

    doc.autoTable({
      startY: 30,
      head: [columns.map(c => c.title)],
      body: rows,
      didParseCell: function (data) {
        // Resaltar la última fila (total)
        if (data.row.index === rows.length - 1 && data.section === "body") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [240, 240, 240];
        }
      }
    });

    doc.save(filename);
  } catch (err) {
    console.error("exportCollectionToPdf error", err);
    alert("Error exportando PDF: " + err.message);
  }
}

/* ======================
   CHARTS
   ====================== */
let chartTopProducts = null;
let chartVentasPorDia = null;

function setupCharts() {
  try {
    const ctx1 = document.getElementById("chartTopProducts").getContext("2d");
    chartTopProducts = new Chart(ctx1, { type: 'bar', data: { labels: [], datasets: [{ label: 'Vendidos', data: [], backgroundColor: 'rgba(16,185,129,0.8)' }] }, options: {} });

    const ctx2 = document.getElementById("chartVentasPorDia").getContext("2d");
    chartVentasPorDia = new Chart(ctx2, { type: 'line', data: { labels: [], datasets: [{ label: 'Ventas', data: [], borderColor: 'rgba(15,118,110,1)', backgroundColor: 'rgba(15,118,110,0.2)' }] }, options: {} });
  } catch (err) {
    console.warn("Charts not available");
  }
}

function updateCharts() {
  if (!chartTopProducts || !chartVentasPorDia) return;

  const counter = {};
  salesCache.forEach(s => (s.items || []).forEach(it => counter[it.productId] = (counter[it.productId] || 0) + it.qty));
  const top = Object.entries(counter).sort((a,b) => b[1]-a[1]).slice(0,8);
  const labels = top.map(([pid]) => {
    const p = inventoryCache.get(pid);
    return p ? `${p.name} ${p.attributes?.size||''} ${p.attributes?.color||''}` : pid;
  });
  const data = top.map(([_,qty]) => qty);
  chartTopProducts.data.labels = labels;
  chartTopProducts.data.datasets[0].data = data;
  chartTopProducts.update();

  const mapDays = {};
  const now = new Date();
  for (let i=29;i>=0;i--) { const d = new Date(now); d.setDate(now.getDate()-i); mapDays[d.toISOString().slice(0,10)] = 0; }
  salesCache.forEach(s => {
    const key = s.createdAt?.seconds ? new Date(s.createdAt.seconds*1000).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
    if (mapDays[key] !== undefined) mapDays[key] += Number(s.total || 0);
  });
  chartVentasPorDia.data.labels = Object.keys(mapDays);
  chartVentasPorDia.data.datasets[0].data = Object.values(mapDays);
  chartVentasPorDia.update();
}

/* ======================
   CAJA por rango / Movimientos
   ====================== */
async function computeCajaTotal(fromDate, toDate) {
  try {
    const movCol = collection(db, "companies", companyId, "movements");
    const qy = query(movCol, where("cuenta","==","cajaEmpresa"), orderBy("createdAt","desc"));
    const snap = await getDocs(qy);
    let total = 0;
    snap.forEach(d => {
      const md = d.data();
      const m = Number(md.monto || 0);
      const createdAt = md.createdAt?.toDate ? md.createdAt.toDate() : (md.createdAt ? new Date(md.createdAt) : null);
      if (!createdAt) return;
      if (createdAt >= fromDate && createdAt <= toDate) total += (md.tipo === "egreso") ? -m : m;
    });
    return total;
  } catch (err) {
    console.error("computeCajaTotal error:", err);
    throw err;
  }
}

function formatDateForLabel(d) { return d.toISOString().slice(0,10); }

function setupCajaControls() {
  $("#btnCajaCustomToggle")?.addEventListener("click", () => $("#cajaCustom").classList.toggle("hidden"));

  $("#btnCajaHoy")?.addEventListener("click", async () => {
    const today = new Date(); const from = new Date(today); from.setHours(0,0,0,0); const to = new Date(today); to.setHours(23,59,59,999);
    try { const total = await computeCajaTotal(from,to); $("#kpiCajaRangeResult").textContent = `Caja hoy (${formatDateForLabel(from)}): ${money(total)}`; } catch (err) { alert("Error calculando caja hoy: " + err.message); }
  });

  $("#btnCaja7d")?.addEventListener("click", async () => {
    const today = new Date(); const from = new Date(today); from.setDate(today.getDate()-6); from.setHours(0,0,0,0); const to = new Date(today); to.setHours(23,59,59,999);
    try { const total = await computeCajaTotal(from,to); $("#kpiCajaRangeResult").textContent = `Caja últimos 7 días (${formatDateForLabel(from)} → ${formatDateForLabel(to)}): ${money(total)}`; } catch (err) { alert("Error calculando 7 días: " + err.message); }
  });

  $("#btnCaja30d")?.addEventListener("click", async () => {
    const today = new Date(); const from = new Date(today); from.setDate(today.getDate()-29); from.setHours(0,0,0,0); const to = new Date(today); to.setHours(23,59,59,999);
    try { const total = await computeCajaTotal(from,to); $("#kpiCajaRangeResult").textContent = `Caja últimos 30 días (${formatDateForLabel(from)} → ${formatDateForLabel(to)}): ${money(total)}`; } catch (err) { alert("Error calculando 30 días: " + err.message); }
  });

  $("#btnCajaCustom")?.addEventListener("click", async () => {
    const fromStr = $("#cajaFrom").value; const toStr = $("#cajaTo").value; if (!fromStr||!toStr) return alert("Selecciona fechas");
    const from = new Date(fromStr); from.setHours(0,0,0,0); const to = new Date(toStr); to.setHours(23,59,59,999); if (to<from) return alert("Rango inválido");
    try { const total = await computeCajaTotal(from,to); $("#kpiCajaRangeResult").textContent = `Caja (${formatDateForLabel(from)} → ${formatDateForLabel(to)}): ${money(total)}`; } catch (err) { alert("Error calculando rango: " + err.message); }
  });
}

/* ======================
   EGRESOS (antes 'Gastos')
   ====================== */
function setupEgresosHandlers() {
  $("#btnSaveEgreso")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await createEgreso();
  });

  $("#btnExportEgresosRange")?.addEventListener("click", exportEgresosRangePrompt);
}

async function createEgreso() {
  const fechaStr = $("#egresoFecha").value;
  const cat = $("#egresoCat").value.trim();
  const monto = Number($("#egresoMonto").value || 0);
  const desc = $("#egresoDesc").value.trim() || null;
  const pagadoPor = $("#egresoPagadoPor").value || "empresa";
  if (!fechaStr || !cat || !monto || monto <= 0) return alert("Completa fecha, categoría y monto válidos");

  try {
    await runTransaction(db, async (tx) => {
      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const balancesSnap = await tx.get(balancesRef);
      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;

      const gastoRef = doc(collection(db, "companies", companyId, "egresos"));
      tx.set(gastoRef, { fecha: fechaStr, categoria: cat, monto, descripcion: desc, pagadoPor, createdAt: serverTimestamp(), createdBy: currentUser.uid });

      if (pagadoPor === "empresa") {
        const movRef = doc(collection(db, "companies", companyId, "movements"));
        tx.set(movRef, { 
          tipo: "egreso", 
          cuenta: "cajaEmpresa", 
          fecha: fechaStr, 
          monto, 
          categoria: cat,          // 🔥 guardamos categoría en el movimiento
          desc: `Egreso: ${cat} ${desc?('- '+desc):''}`, 
          egresoId: gastoRef.id, 
          createdAt: serverTimestamp() 
        });

        const newCaja = oldCaja - monto;
        if (balancesSnap.exists()) tx.update(balancesRef, { cajaEmpresa: newCaja });
        else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });
      }
    });

    alert("Egreso registrado correctamente.");
    ["#egresoFecha","#egresoCat","#egresoMonto","#egresoDesc"].forEach(s => { try { $(s).value=""; } catch(e){} });
    $("#egresoPagadoPor").value = "empresa";
    await loadEgresosOnce();
  } catch (err) {
    console.error("createEgreso error", err);
    alert("Error registrando egreso: " + err.message);
  }
}

async function loadEgresosOnce() {
  try {
    const q = query(collection(db, "companies", companyId, "egresos"), orderBy("createdAt","desc"));
    const docs = await getDocs(q);
    const arr = docs.docs.map(d => ({ id: d.id, ...d.data() }));
    renderEgresosTable(arr);
  } catch (err) { console.error("loadEgresosOnce", err); }
}

function renderEgresosTable(egresosArray) {
  const tb = $("#tbEgresos");
  if (!tb) return;
  tb.innerHTML = "";
  if (!egresosArray.length) {
    tb.innerHTML = `<tr><td colspan="5" class="small text-slate-500">No hay egresos registrados.</td></tr>`;
    aplicarPaginacion("tbEgresos", "pagerEgresos", 10);
    return;
  }
  egresosArray.forEach(g => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${g.fecha}</td>
      <td>${escapeHtml(g.categoria)}</td>
      <td>${money(g.monto)}</td>
      <td>${escapeHtml(g.descripcion || '')}</td>
      <td><button class="bg-red-500 text-white px-2 py-1 rounded text-xs delete-egreso" data-id="${g.id}">Eliminar</button></td>
    `;
    tb.appendChild(tr);
  });

  $$(".delete-egreso").forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.id;
    if (confirm("Eliminar egreso? Esto restaurará el dinero en caja si el egreso salió de la empresa.")) {
      await deleteEgreso(id);
    }
  });

  // paginador egresos
  aplicarPaginacion("tbEgresos", "pagerEgresos", 10);
}

async function deleteEgreso(egresoId) {
  try {
    await runTransaction(db, async (tx) => {
      const egresoRef = doc(db, "companies", companyId, "egresos", egresoId);
      const egresoSnap = await tx.get(egresoRef);
      if (!egresoSnap.exists()) throw new Error("Egreso no encontrado");
      const egreso = egresoSnap.data();

      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const balancesSnap = await tx.get(balancesRef);
      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;

      if (egreso.pagadoPor === "empresa") {
        const newCaja = oldCaja + Number(egreso.monto || 0);
        if (balancesSnap.exists()) tx.update(balancesRef, { cajaEmpresa: newCaja });
        else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });

        const movRef = doc(collection(db, "companies", companyId, "movements"));
        tx.set(movRef, { tipo: "ingreso", cuenta: "cajaEmpresa", fecha: new Date().toISOString().slice(0,10), monto: egreso.monto, desc: `Reversión Egreso ID ${egresoId}`, egresoId, createdAt: serverTimestamp() });
      }

      tx.delete(egresoRef);
    });

    alert("Egreso eliminado y caja ajustada (si aplica).");
    await loadEgresosOnce();
  } catch (err) {
    console.error("deleteEgreso error", err);
    alert("Error al eliminar egreso: " + err.message);
  }
}

/* ======================
   INGRESOS
   ====================== */
function setupIngresosHandlers() {
  $("#btnSaveIngreso")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await createIngreso();
  });

  $("#btnExportIngresosRange")?.addEventListener("click", exportIngresosRangePrompt);
}

async function createIngreso() {
  const fechaStr = $("#ingresoFecha").value;
  const cat = $("#ingresoCat").value.trim();
  const monto = Number($("#ingresoMonto").value || 0);
  const desc = $("#ingresoDesc").value.trim() || null;
  if (!fechaStr || !cat || !monto || monto <= 0) return alert("Completa fecha, categoría y monto válidos");

  try {
    await runTransaction(db, async (tx) => {
      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const balancesSnap = await tx.get(balancesRef);
      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;

      const ingresoRef = doc(collection(db, "companies", companyId, "ingresos"));
      tx.set(ingresoRef, { fecha: fechaStr, categoria: cat, monto, descripcion: desc, createdAt: serverTimestamp(), createdBy: currentUser.uid });

      const movRef = doc(collection(db, "companies", companyId, "movements"));
      tx.set(movRef, { 
        tipo: "ingreso", 
        cuenta: "cajaEmpresa", 
        fecha: fechaStr, 
        monto, 
        categoria: cat,          // 🔥 guardamos categoría en el movimiento
        desc: `Ingreso: ${cat} ${desc?('- '+desc):''}`, 
        ingresoId: ingresoRef.id, 
        createdAt: serverTimestamp() 
      });

      const newCaja = oldCaja + monto;
      if (balancesSnap.exists()) tx.update(balancesRef, { cajaEmpresa: newCaja });
      else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });
    });

    alert("Ingreso registrado correctamente.");
    ["#ingresoFecha","#ingresoCat","#ingresoMonto","#ingresoDesc"].forEach(s => { try { $(s).value=""; } catch(e){} });
    await loadIngresosOnce();
  } catch (err) {
    console.error("createIngreso error", err);
    alert("Error registrando ingreso: " + err.message);
  }
}

async function loadIngresosOnce() {
  try {
    const q = query(collection(db, "companies", companyId, "ingresos"), orderBy("createdAt","desc"));
    const docs = await getDocs(q);
    const arr = docs.docs.map(d => ({ id: d.id, ...d.data() }));
    renderIngresosTable(arr);
  } catch (err) { console.error("loadIngresosOnce", err); }
}

function renderIngresosTable(arr) {
  const tb = $("#tbIngresos");
  if (!tb) return;
  tb.innerHTML = "";
  if (!arr.length) { tb.innerHTML = `<tr><td colspan="4" class="small text-slate-500">No hay ingresos registrados.</td></tr>`; aplicarPaginacion("tbIngresos", "pagerIngresos", 10); return; }
  arr.forEach(i => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i.fecha}</td><td>${escapeHtml(i.categoria)}</td><td>${money(i.monto)}</td><td>${escapeHtml(i.descripcion || '')}</td>`;
    tb.appendChild(tr);
  });
  aplicarPaginacion("tbIngresos", "pagerIngresos", 10);
}

/* ======================
   MOVIMIENTOS
   ====================== */
async function loadMovimientos(range = "7d") {
  try {
    const movCol = collection(db, "companies", companyId, "movements");
    const qy = query(movCol, orderBy("createdAt","desc"));
    const snap = await getDocs(qy);
    const arr = [];
    snap.forEach(d => arr.push({ id: d.id, ...d.data() }));

    const now = new Date();
    let from;
    if (range === "today") { from = new Date(now); from.setHours(0,0,0,0); }
    else if (range === "7d") { from = new Date(now); from.setDate(now.getDate()-6); from.setHours(0,0,0,0); }
    else if (range === "30d") { from = new Date(now); from.setDate(now.getDate()-29); from.setHours(0,0,0,0); }
    else from = new Date(0);

    const filtered = arr.filter(m => {
      const created = m.createdAt?.toDate ? m.createdAt.toDate() : (m.createdAt ? new Date(m.createdAt) : null);
      return created && created >= from;
    });

    renderMovimientosTable(filtered);
  } catch (err) { console.error("loadMovimientos", err); }
}

/* ======================
   MOVIMIENTOS: render + export PDF (reemplazar función existente)
   ====================== */

// mantengo último listado renderizado para usar al exportar
let lastMovimientosRendered = [];

/**
 * Obtiene un texto descriptivo para el movimiento:
 * - Detecta ventas si tiene saleId
 * - Detecta gastos si tiene gastoId
 * - Usa tipo/categoria/desc como fallback
 */
function getMovimientoDetalle(mov) {
  // Si viene de una venta
  if (mov.saleId) {
    const canal = mov.canal || mov.channel || '';
    return canal ? `Venta (${canal})` : `Venta`;
  }

  // Si es un ingreso manual
  if (mov.tipo === 'ingreso') {
    const cat = mov.categoria || extraerCategoriaDesdeDesc(mov.desc) || 'General';
    return `Ingreso — ${cat}`;
  }

  // Si es un egreso manual
  if (mov.tipo === 'egreso') {
    const cat = mov.categoria || extraerCategoriaDesdeDesc(mov.desc) || 'General';
    return `Egreso — ${cat}`;
  }

  // Si es un egreso guardado con gastoId
  if (mov.gastoId) {
    const cat = mov.categoria || extraerCategoriaDesdeDesc(mov.desc) || 'Egreso';
    return `Egreso — ${cat}`;
  }

  // Si es un ingreso guardado con ingresoId
  if (mov.ingresoId) {
    const cat = mov.categoria || extraerCategoriaDesdeDesc(mov.desc) || 'Ingreso';
    return `Ingreso — ${cat}`;
  }

  // Fallback
  return mov.tipo || 'Movimiento';
}

// Función auxiliar para intentar extraer la categoría desde el campo desc
function extraerCategoriaDesdeDesc(desc) {
  if (!desc) return null;
  // ejemplo: "Ingreso: Ventas adicionales - pago contado"
  const m = desc.match(/(Ingreso|Egreso|Gasto):\s*([^-\n]+)/i);
  return m ? m[2].trim() : null;
}


function formatDateForMov(d) {
  if (!d) return '';
  const dt = (d?.toDate) ? d.toDate() : (d instanceof Date ? d : new Date(d));
  return dt.toLocaleString();
}


/**
 * Reemplaza la función antigua renderMovimientosTable(arr)
 * Renderiza la tabla y guarda últimos movimientos en lastMovimientosRendered
 */

function renderMovimientosTable(arr) {
  lastMovimientosRendered = Array.isArray(arr) ? arr.slice() : [];

  const tb = $("#tbMovimientos");
  if (!tb) return;
  tb.innerHTML = "";
  if (!arr || !arr.length) {
    tb.innerHTML = `<tr><td colspan="5" class="small text-slate-500">No hay movimientos en este rango.</td></tr>`;
    aplicarPaginacion("tbMovimientos", "pagerMovimientos", 50);
    return;
  }

  arr.forEach(m => {
    const fecha = m.fecha || (m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString() : '');
    const detalle = getMovimientoDetalle(m);
    const cuenta = m.cuenta || "";
    const monto = money(m.monto || 0);
    const desc = escapeHtml(m.desc || m.descripcion || "");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(fecha)}</td>
      <td>${escapeHtml(detalle)}</td>
      <td>${escapeHtml(cuenta)}</td>
      <td>${monto}</td>
      <td>${desc}</td>
    `;
    tb.appendChild(tr);
  });

  // aplicar paginación movimientos
  aplicarPaginacion("tbMovimientos", "pagerMovimientos", 15);
}

/**
 * Exportar movimientos a PDF usando jsPDF + autoTable.
 * Si no pasas `movs`, exporta `lastMovimientosRendered`.
 */
// Reemplaza completamente la función exportMovimientosToPDF existente por esta
function exportMovimientosToPDF(movs = null, filename = null) {
  try {
    const list = Array.isArray(movs) ? movs : lastMovimientosRendered;
    if (!list || !list.length) return alert("No hay movimientos para exportar.");

    // Verificar jsPDF
    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
      alert("jsPDF no está cargado. Añade el script de jsPDF en el HTML.");
      return;
    }

    // Asegurar que getMovimientoDetalle existe (si no, fallback simple)
    if (typeof getMovimientoDetalle !== "function") {
      window.getMovimientoDetalle = (mov) => {
        if (mov.saleId) return "Venta";
        if (mov.ingresoId) return "Ingreso";
        if (mov.egresoId) return "Egreso";
        return mov.tipo || "";
      };
    }

    // Determinar rango de fechas (para título / nombre de archivo)
    const dates = list.map(m => {
      const d = m.createdAt?.toDate ? m.createdAt.toDate() : (m.fecha ? new Date(m.fecha) : null);
      return (d instanceof Date && !isNaN(d)) ? d : null;
    }).filter(Boolean);

    const minDate = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
    const maxDate = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();
    const startLabel = minDate.toISOString().slice(0,10);
    const endLabel = maxDate.toISOString().slice(0,10);

    // Crear documento
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    doc.setFontSize(14);
    doc.text(`Movimientos ${startLabel} → ${endLabel}`, 40, 40);

    // Construir filas y total neto
    const rows = [];
    let totalNet = 0;
    for (const mov of list) {
      const fecha = mov.fecha || (mov.createdAt?.toDate ? mov.createdAt.toDate().toLocaleString() : '');
      const tipo = mov.tipo || '';
      const detalle = String(getMovimientoDetalle(mov) || '').replace(/\s+/g,' ').trim();
      const cuenta = mov.cuenta || '';
      const montoNum = Number(mov.monto || 0);
      // Mostrar monto con signo visual para egresos
      const montoStr = (tipo === 'egreso' ? `-${money(montoNum)}` : money(montoNum));
      totalNet += (tipo === 'egreso' ? -montoNum : montoNum);

      rows.push([ fecha, tipo, detalle, cuenta, montoStr ]);
    }

    // Añadir fila final TOTAL GENERAL
    rows.push([ '', '', 'TOTAL GENERAL', '', money(totalNet) ]);

    // Generar tabla con autoTable
    doc.autoTable({
      startY: 70,
      head: [['Fecha','Tipo','Detalle','Cuenta','Monto']],
      body: rows,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [14,78,94], textColor: 255, halign: 'center' },
      columnStyles: {
        0: { cellWidth: 110 }, // fecha
        1: { cellWidth: 60 },  // tipo
        2: { cellWidth: 220 }, // detalle
        3: { cellWidth: 100 }, // cuenta
        4: { cellWidth: 80, halign: 'right' } // monto
      },
      didParseCell: function (data) {
        // estilizar la última fila (TOTAL) en negrita
        if (data.section === 'body' && data.row.index === rows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: 40, right: 40 }
    });

    // Nombre de archivo por defecto
    const fname = filename || `movimientos_${startLabel}_${endLabel}.pdf`;
    doc.save(fname);

  } catch (err) {
    console.error("exportMovimientosToPDF error:", err);
    alert("Error exportando Movimientos a PDF: " + (err.message || err));
  }
}

/* Hook para botón de export (si lo agregas al HTML) */
document.addEventListener("click", (ev) => {
  if (ev.target && ev.target.id === "btnExportMovimientosPDF") {
    exportMovimientosToPDF();
  }
});

/* quick mov buttons */
document.addEventListener("click", (ev) => {
  if (ev.target && ev.target.id === "btnMovHoy") loadMovimientos("today");
  if (ev.target && ev.target.id === "btnMov7d") loadMovimientos("7d");
  if (ev.target && ev.target.id === "btnMov30d") loadMovimientos("30d");
  if (ev.target && ev.target.id === "btnExportMovimientosRange") exportMovimientosRangePrompt();
});

/* ======================
   USUARIOS (ADMIN) -> crear empleado vía Cloud Function
   ====================== */
function setupUsersHandlers() {
  // si existe el botón de crear empleado, lo dejamos para crear cuenta + contraseña
  const createBtn = $("#btnCreateEmployee");
  if (!createBtn) return;

  createBtn.onclick = async () => {
    const name = $("#invName").value.trim() || null;
    const email = $("#invEmail").value.trim() || null;
    const pass = $("#invPass").value || null;
    const role = $("#invRole").value || "empleado";

    if (!email || !pass) return alert("Email y contraseña requeridos para crear empleado.");

    try {
      // Llamada a la Cloud Function "createEmployee" (callable)
      const createEmployee = httpsCallable(functions, "createEmployee");
      const res = await createEmployee({
        email,
        password: pass,
        name,
        role,
        companyId
      });

      alert("Empleado creado correctamente (uid: " + res.data.uid + ").");

      // limpiar form
      $("#invName").value = "";
      $("#invEmail").value = "";
      if ($("#invPass")) $("#invPass").value = "";
      $("#invRole").value = "empleado";
    } catch (err) {
      console.error("createEmployee error:", err);
      const msg = (err?.message || err?.code || "Error creando empleado");
      alert("Error creando empleado: " + msg);
    }
  };
}

/* listar usuarios vinculados a la company (solo admin) */
function subscribeUsersIfAdmin() {
  if (userRole !== "admin") {
    // hide users tab
    const btn = document.querySelector("[data-tab='usuarios']");
    if (btn) btn.style.display = "none";
    return;
  }
  const btn = document.querySelector("[data-tab='usuarios']");
  if (btn) btn.style.display = "";

  const q = query(collection(db, "users"), where("companyId","==",companyId), orderBy("createdAt","desc"));
  const unsub = onSnapshot(q, snap => {
    const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUsersTable(arr);
  });
  unsubscribers.push(unsub);
}

function renderUsersTable(users) {
  const tb = $("#tbEmployees") || $("#tbInvites") || $("#tbUsers");
  if (!tb) return;
  tb.innerHTML = "";
  if (!users.length) {
    tb.innerHTML = `<tr><td colspan="6" class="small text-slate-500">No hay usuarios.</td></tr>`;
    aplicarPaginacion("tbEmployees", "pagerEmployees", 10);
    return;
  }
  users.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(u.displayName || "")}</td>
      <td>${u.email || "-"}</td>
      <td>${u.role || "empleado"}</td>
      <td>${u.createdAt?.toDate ? u.createdAt.toDate().toLocaleString() : "-"}</td>
      <td>
        ${u.role === "empleado" ? `<button class="px-2 py-1 border rounded text-xs btnMakeAdmin" data-uid="${u.id}">Hacer admin</button>` : ""}
      </td>
    `;
    tb.appendChild(tr);
  });

  $$(".btnMakeAdmin").forEach(b => b.onclick = async () => {
    const uid = b.dataset.uid;
    if (!confirm("Convertir usuario en administrador?")) return;
    try {
      await updateDoc(doc(db, "users", uid), { role: "admin" });
      alert("Usuario actualizado a admin (el usuario debe reloguear para ver cambios).");
    } catch (err) { console.error(err); alert("Error actualizando rol: "+err.message); }
  });

  aplicarPaginacion("tbEmployees", "pagerEmployees", 8);
}

/* ======================
   EXPORT / PDF range prompts
   ====================== */
function parseDateInput(str) {
  if (!str) return null;
  const d = new Date(str);
  if (isNaN(d)) return null;
  d.setHours(0,0,0,0);
  return d;
}

async function exportSalesRangePrompt() {
  const fromStr = prompt("Fecha desde (YYYY-MM-DD)");
  const toStr = prompt("Fecha hasta (YYYY-MM-DD)");
  const from = parseDateInput(fromStr); const to = parseDateInput(toStr);
  if (!from || !to) return alert("Fechas inválidas");
  to.setHours(23,59,59,999);
  // fetch sales in range
  const snap = await getDocs(query(collection(db,"companies",companyId,"sales"), orderBy("createdAt","desc")));
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const filtered = arr.filter(s => {
    const created = s.createdAt?.toDate ? s.createdAt.toDate() : null;
    return created && created >= from && created <= to;
  });
  await exportCollectionToPdf(`Ventas ${formatDateForLabel(from)} → ${formatDateForLabel(to)}`, filtered, [
    { key: 'createdAt', title: 'Fecha', format: 'date' },
    { key: 'client', title: 'Cliente' },
    { key: 'total', title: 'Total', format: 'money' }
  ], `ventas_${formatDateForLabel(from)}_${formatDateForLabel(to)}.pdf`);
}

async function exportEgresosRangePrompt() {
  const fromStr = prompt("Fecha desde (YYYY-MM-DD)");
  const toStr = prompt("Fecha hasta (YYYY-MM-DD)");
  const from = parseDateInput(fromStr); const to = parseDateInput(toStr);
  if (!from || !to) return alert("Fechas inválidas");
  to.setHours(23,59,59,999);
  const snap = await getDocs(query(collection(db,"companies",companyId,"egresos"), orderBy("createdAt","desc")));
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const filtered = arr.filter(s => {
    const created = s.createdAt?.toDate ? s.createdAt.toDate() : (s.fecha ? new Date(s.fecha) : null);
    return created && created >= from && created <= to;
  });
  await exportCollectionToPdf(`Egresos ${formatDateForLabel(from)} → ${formatDateForLabel(to)}`, filtered, [
    { key: 'fecha', title: 'Fecha' },
    { key: 'categoria', title: 'Categoria' },
    { key: 'monto', title: 'Monto', format: 'money' }
  ], `egresos_${formatDateForLabel(from)}_${formatDateForLabel(to)}.pdf`);
}

async function exportIngresosRangePrompt() {
  const fromStr = prompt("Fecha desde (YYYY-MM-DD)");
  const toStr = prompt("Fecha hasta (YYYY-MM-DD)");
  const from = parseDateInput(fromStr); const to = parseDateInput(toStr);
  if (!from || !to) return alert("Fechas inválidas");
  to.setHours(23,59,59,999);
  const snap = await getDocs(query(collection(db,"companies",companyId,"ingresos"), orderBy("createdAt","desc")));
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const filtered = arr.filter(s => {
    const created = s.createdAt?.toDate ? s.createdAt.toDate() : (s.fecha ? new Date(s.fecha) : null);
    return created && created >= from && created <= to;
  });
  await exportCollectionToPdf(`Ingresos ${formatDateForLabel(from)} → ${formatDateForLabel(to)}`, filtered, [
    { key: 'fecha', title: 'Fecha' },
    { key: 'categoria', title: 'Categoria' },
    { key: 'monto', title: 'Monto', format: 'money' }
  ], `ingresos_${formatDateForLabel(from)}_${formatDateForLabel(to)}.pdf`);
}

async function exportMovimientosRangePrompt() {
  const fromStr = prompt("Fecha desde (YYYY-MM-DD)");
  const toStr = prompt("Fecha hasta (YYYY-MM-DD)");
  const from = parseDateInput(fromStr); 
  const to = parseDateInput(toStr);
  if (!from || !to) return alert("Fechas inválidas");
  to.setHours(23,59,59,999);

  const snap = await getDocs(
    query(collection(db,"companies",companyId,"movements"), orderBy("createdAt","desc"))
  );
  const arr = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Filtrar por rango
  const filtered = arr.filter(s => {
    const created = s.createdAt?.toDate ? s.createdAt.toDate() : (s.fecha ? new Date(s.fecha) : null);
    return created && created >= from && created <= to;
  });

  // 🔥 Agregar el campo `detalle` a cada movimiento usando tu función
  const enriched = filtered.map(mov => ({
    ...mov,
    detalle: getMovimientoDetalle(mov)   // <- aquí se calcula antes de exportar
  }));

  // Exportar
  await exportCollectionToPdf(
    `Movimientos ${formatDateForLabel(from)} → ${formatDateForLabel(to)}`,
    enriched,
    [
      { key: 'fecha', title: 'Fecha' },
      { key: 'tipo', title: 'Tipo' },
      { key: 'detalle', title: 'Detalle' },  // <- ya existe en los datos
      { key: 'cuenta', title: 'Cuenta' },
      { key: 'monto', title: 'Monto', format: 'money' }
    ],
    `movimientos_${formatDateForLabel(from)}_${formatDateForLabel(to)}.pdf`
  );
}

/* ======================
   UTILs
   ====================== */
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"'`=\/]/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'}[c];
  });
}

function normalizeForSearch(str) {
  if (!str) return "";
  return String(str).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/* ======================
   BOOT
   ====================== */
window.addEventListener("DOMContentLoaded", () => {
  try { setupPosHandlers(); } catch(e) {}
  try { setupCajaControls(); } catch(e) {}
});
window._dbg = { db, inventoryCache, salesCache, runTransaction };


/* ======================
   PAGINADOR GENÉRICO
   - Úsalo con cualquier <tbody id="..."> poniendo un <div id="pager..."></div> debajo
   - Llamar: aplicarPaginacion('tbVentas','pagerVentas', 10);
   ====================== */
function aplicarPaginacion(tableId, pagerId, pageSize = 10) {
  const tb = document.getElementById(tableId);
  const pager = document.getElementById(pagerId);
  if (!tb || !pager) return;

  const filas = Array.from(tb.querySelectorAll("tr"));
  const totalPaginas = Math.max(1, Math.ceil(filas.length / pageSize));
  if (filas.length === 0) {
    pager.innerHTML = ""; // nada que paginar
    return;
  }

  // muestra la página p (1..totalPaginas)
  function mostrarPagina(p) {
    p = Math.max(1, Math.min(totalPaginas, p));
    filas.forEach((fila, i) => {
      fila.style.display = (i >= (p-1)*pageSize && i < p*pageSize) ? "" : "none";
    });

    // construir controles (Anterior / página X de Y / Siguiente)
    pager.innerHTML = "";
    const btnPrev = document.createElement("button");
    btnPrev.className = "px-2 py-1 mr-2 border rounded text-sm";
    btnPrev.textContent = "Anterior";
    btnPrev.disabled = (p === 1);
    btnPrev.addEventListener("click", () => mostrarPagina(p-1));
    pager.appendChild(btnPrev);

    const info = document.createElement("span");
    info.className = "text-sm mx-2";
    info.textContent = `Página ${p} de ${totalPaginas} — ${filas.length} filas`;
    pager.appendChild(info);

    const btnNext = document.createElement("button");
    btnNext.className = "px-2 py-1 ml-2 border rounded text-sm";
    btnNext.textContent = "Siguiente";
    btnNext.disabled = (p === totalPaginas);
    btnNext.addEventListener("click", () => mostrarPagina(p+1));
    pager.appendChild(btnNext);

    // opcional: botones rápidos de página (1,2,3...) si hay pocas páginas
    if (totalPaginas > 1 && totalPaginas <= 8) {
      const container = document.createElement("div");
      container.style.display = "inline-block";
      container.style.marginLeft = "12px";
      for (let i=1;i<=totalPaginas;i++) {
        const b = document.createElement("button");
        b.textContent = i;
        b.className = "mx-1 px-2 py-0.5 border rounded text-xs";
        if (i === p) {
          b.style.fontWeight = "700";
          b.disabled = true;
        } else {
          b.addEventListener("click", ((page)=>() => mostrarPagina(page))(i));
        }
        container.appendChild(b);
      }
      pager.appendChild(container);
    }
  }
  // inicial
  mostrarPagina(1);
}
/* FIN app.js */
