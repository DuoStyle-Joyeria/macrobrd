// app.js (reemplaza todo el archivo js/app.js con esto)

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
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim();
  const pass = $("#loginPass").value.trim();
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    alert("Error login: " + err.message);
  }
});

$("#registerForm").addEventListener("submit", async (e) => {
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
    // No forzamos logout aquí (ya está autenticado)
  } catch (err) {
    console.error("register error:", err);
    alert("Error creating account: " + err.message);
  }
});

$("#btnLogout").addEventListener("click", () => signOut(auth));

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
    setupGastosHandlers();

    subscribeInventory();
    subscribeSales();
    subscribeBalances();
    await loadSalesOnce();
    await loadGastosOnce();
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

/* ======================
   ROLE handling AQUI ELIJO QUE VE CADA EMPLEADO  Y QUE NO
   ====================== */
function applyRoleVisibility() {
  if (userRole === "empleado") {
    // empleado: solo ventas y gastos
    $$(".tab-btn").forEach(btn => {
      const t = btn.dataset.tab;
      btn.style.display = (t === "ventas" || t === "gastos" || t === "inventario" ) ? "" : "none";
    });
    $("[data-tab='ventas']").click();
  } else {
    $$(".tab-btn").forEach(btn => btn.style.display = "");
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
  $("#btnClearCart").onclick = () => { $("#cartBody").innerHTML = ""; updateCartTotal(); };
  $("#btnSubmitSale").onclick = submitSaleHandler;
  createCartLine(); // línea por defecto
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
      tr.querySelector(".lineQty").value = 1;
      updateLineSubtotal(tr);
      return;
    }
    const p = inventoryCache.get(pid);
    tr.dataset.productId = pid;
    tr.querySelector(".linePrice").value = p.price || 0;
    tr.querySelector(".lineQty").value = 1;
    updateLineSubtotal(tr);
  };

  tr.querySelector(".lineQty").oninput = () => updateLineSubtotal(tr);
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
    if (p.attributes?.size) attrs.push(p.attributes.size);
    if (p.attributes?.color) attrs.push(p.attributes.color);
    if (p.attributes?.team) attrs.push(p.attributes.team);
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
      if (p.attributes?.size) attrs.push(p.attributes.size);
      if (p.attributes?.color) attrs.push(p.attributes.color);
      if (p.attributes?.team) attrs.push(p.attributes.team);
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
    const q = query(movCol, where("cuenta","==","cajaEmpresa"), orderBy("createdAt","desc"));
    const snap = await getDocs(q);
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
   GASTOS
   ====================== */
function setupGastosHandlers() {
  $("#btnSaveGasto")?.addEventListener("click", async (e) => {
    e.preventDefault();
    await createGasto();
  });
}

async function createGasto() {
  const fechaStr = $("#gastoFecha").value;
  const cat = $("#gastoCat").value.trim();
  const monto = Number($("#gastoMonto").value || 0);
  const desc = $("#gastoDesc").value.trim() || null;
  const pagadoPor = $("#gastoPagadoPor").value || "empresa";
  if (!fechaStr || !cat || !monto || monto <= 0) return alert("Completa fecha, categoría y monto válidos");

  try {
    await runTransaction(db, async (tx) => {
      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const balancesSnap = await tx.get(balancesRef);
      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;

      const gastoRef = doc(collection(db, "companies", companyId, "gastos"));
      tx.set(gastoRef, { fecha: fechaStr, categoria: cat, monto, descripcion: desc, pagadoPor, createdAt: serverTimestamp(), createdBy: currentUser.uid });

      if (pagadoPor === "empresa") {
        const movRef = doc(collection(db, "companies", companyId, "movements"));
        tx.set(movRef, { tipo: "egreso", cuenta: "cajaEmpresa", fecha: fechaStr, monto, desc: `Gasto: ${cat} ${desc?('- '+desc):''}`, gastoId: gastoRef.id, createdAt: serverTimestamp() });
        const newCaja = oldCaja - monto;
        if (balancesSnap.exists()) tx.update(balancesRef, { cajaEmpresa: newCaja });
        else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });
      }
    });

    alert("Gasto registrado correctamente.");
    ["#gastoFecha","#gastoCat","#gastoMonto","#gastoDesc"].forEach(s => { try { $(s).value=""; } catch(e){} });
    $("#gastoPagadoPor").value = "empresa";
    await loadGastosOnce();
  } catch (err) {
    console.error("createGasto error:", err);
    alert("Error registrando gasto: " + err.message);
  }
}

async function loadGastosOnce() {
  try {
    const q = query(collection(db, "companies", companyId, "gastos"), orderBy("createdAt","desc"));
    const docs = await getDocs(q);
    const arr = docs.docs.map(d => ({ id: d.id, ...d.data() }));
    renderGastosTable(arr);
  } catch (err) { console.error("loadGastosOnce", err); }
}

function renderGastosTable(gastosArray) {
  const tb = $("#tbGastos");
  if (!tb) return;
  tb.innerHTML = "";
  if (!gastosArray.length) {
    tb.innerHTML = `<tr><td colspan="5" class="small text-slate-500">No hay gastos registrados.</td></tr>`;
    return;
  }
  gastosArray.forEach(g => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${g.fecha}</td>
      <td>${escapeHtml(g.categoria)}</td>
      <td>${money(g.monto)}</td>
      <td>${escapeHtml(g.descripcion || '')}</td>
      <td><button class="bg-red-500 text-white px-2 py-1 rounded text-xs delete-gasto" data-id="${g.id}">Eliminar</button></td>
    `;
    tb.appendChild(tr);
  });

  $$(".delete-gasto").forEach(btn => btn.onclick = async () => {
    const id = btn.dataset.id;
    if (confirm("Eliminar gasto? Esto restaurará el dinero en caja si el gasto salió de la empresa.")) {
      await deleteGasto(id);
    }
  })
}

async function deleteGasto(gastoId) {
  try {
    await runTransaction(db, async (tx) => {
      const gastoRef = doc(db, "companies", companyId, "gastos", gastoId);
      const gastoSnap = await tx.get(gastoRef);
      if (!gastoSnap.exists()) throw new Error("Gasto no encontrado");
      const gasto = gastoSnap.data();

      const balancesRef = doc(db, "companies", companyId, "state", "balances");
      const balancesSnap = await tx.get(balancesRef);
      const oldCaja = balancesSnap.exists() ? Number(balancesSnap.data().cajaEmpresa || 0) : 0;

      if (gasto.pagadoPor === "empresa") {
        const newCaja = oldCaja + Number(gasto.monto || 0);
        if (balancesSnap.exists()) tx.update(balancesRef, { cajaEmpresa: newCaja });
        else tx.set(balancesRef, { cajaEmpresa: newCaja, deudasTotales: 0, createdAt: serverTimestamp() });

        const movRef = doc(collection(db, "companies", companyId, "movements"));
        tx.set(movRef, { tipo: "ingreso", cuenta: "cajaEmpresa", fecha: new Date().toISOString().slice(0,10), monto: gasto.monto, desc: `Reversión Gasto ID ${gastoId}`, gastoId, createdAt: serverTimestamp() });
      }

      tx.delete(gastoRef);
    });

    alert("Gasto eliminado y caja ajustada (si aplica).");
    await loadGastosOnce();
  } catch (err) {
    console.error("deleteGasto error:", err);
    alert("Error al eliminar gasto: " + err.message);
  }
}

/* ======================
   MOVIMIENTOS
   ====================== */
async function loadMovimientos(range = "7d") {
  try {
    const movCol = collection(db, "companies", companyId, "movements");
    const q = query(movCol, orderBy("createdAt","desc"));
    const snap = await getDocs(q);
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

function renderMovimientosTable(arr) {
  const tb = $("#tbMovimientos");
  if (!tb) return;
  tb.innerHTML = "";
  if (!arr.length) { tb.innerHTML = `<tr><td colspan="5" class="small text-slate-500">No hay movimientos en este rango.</td></tr>`; return; }
  arr.forEach(m => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${m.fecha || (m.createdAt?.toDate ? m.createdAt.toDate().toLocaleString() : '')}</td>
                    <td>${m.tipo}</td>
                    <td>${m.cuenta}</td>
                    <td>${money(m.monto)}</td>
                    <td>${escapeHtml(m.desc || '')}</td>`;
    tb.appendChild(tr);
  });
}

/* quick mov buttons */
document.addEventListener("click", (ev) => {
  if (ev.target && ev.target.id === "btnMovHoy") loadMovimientos("today");
  if (ev.target && ev.target.id === "btnMov7d") loadMovimientos("7d");
  if (ev.target && ev.target.id === "btnMov30d") loadMovimientos("30d");
});

/* ======================
   USUARIOS (ADMIN) -> crear empleado vía Cloud Function
   ====================== */
function setupUsersHandlers() {
  // si existe el botón de crear empleado, lo dejamos para crear cuenta + contraseña
  const btnCreate = $("#btnCreateEmployee") || $("#btnCreateInvite") || null;

  if (!btnCreate) return;

  // preferimos btnCreateEmployee (nuevo flujo), si no existe intentamos btnCreateInvite (compatibilidad)
  const createBtn = $("#btnCreateEmployee");
  if (createBtn) {
    createBtn.onclick = async () => {
      const name = $("#invName").value.trim() || null;
      const email = $("#invEmail").value.trim() || null;
      const pass = $("#invPass") ? $("#invPass").value : null;
      const role = $("#invRole").value || "empleado";

      if (!email || !pass) return alert("Email y contraseña requeridos para crear empleado.");

     try {
  // 🔗 Llamada a la Cloud Function "createEmployee"
  const createEmployee = httpsCallable(functions, "createEmployee");

  // 📤 Enviar datos al backend con las claves correctas
  const res = await createEmployee({
    email,
    password: pass,  // La contraseña que escribiste en el formulario
    name,            // ✅ ahora coincide con lo que espera el backend
    role,
    companyId
  });

  // 📥 Confirmación
  alert("Empleado creado correctamente (uid: " + res.data.uid + ").");

  // 🧹 Limpiar el formulario
  $("#invName").value = "";
  $("#invEmail").value = "";
  if ($("#invPass")) $("#invPass").value = "";
  $("#invRole").value = "empleado";

} catch (err) {
  // 🚨 Manejo de errores
  console.error("createEmployee error:", err);
  const msg = (err?.message || err?.code || "Error creando empleado");
  alert("Error creando empleado: " + msg);
}

    };
    return;
  }

  // fallback: existing "invite" button (no-op if you removed invites)
  $("#btnCreateInvite")?.addEventListener("click", async () => {
    alert("En esta versión preferimos que el administrador cree empleados (email+password) directamente. Usa la opción para crear empleado con contraseña.");
  });
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
  const tb = $("#tbInvites") || $("#tbUsers"); // reutilizamos un tbody
  if (!tb) return;
  tb.innerHTML = "";
  if (!users.length) {
    tb.innerHTML = `<tr><td colspan="6" class="small text-slate-500">No hay usuarios.</td></tr>`;
    return;
  }
  users.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.createdAt?.toDate ? u.createdAt.toDate().toLocaleString() : "-"}</td>
      <td>${escapeHtml(u.displayName || "")}</td>
      <td>${u.email || "-"}</td>
      <td>${u.role || "empleado"}</td>
      <td>${u.companyId || "-"}</td>
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
      // Only the Cloud Function (or server admin SDK) should change user roles; for now update users/{uid}.role (requires rules)
      await updateDoc(doc(db, "users", uid), { role: "admin" });
      alert("Usuario actualizado a admin (nota: para que los custom claims actualicen, desplegar una función que sincronice claims o pedir al usuario que vuelva a loguear).");
    } catch (err) { console.error(err); alert("Error actualizando rol: "+err.message); }
  });
}

/* ======================
   UTILS
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
   Boot
   ====================== */
window.addEventListener("DOMContentLoaded", () => {
  try { setupPosHandlers(); } catch(e) { /* ignore */ }
});

/* expose debug */
window._dbg = { db, inventoryCache, salesCache, runTransaction };


/* ========================
   PDF & Export helpers
   ======================== */

// format dinero consistente (reusa tu money si prefieres)
function formatMoneyNumber(n) {
  return `$${Number(n||0).toLocaleString('es-CO',{maximumFractionDigits:2})}`;
}
function formatDateTime(dt) {
  // dt: Firestore Timestamp or Date
  if (!dt) return '';
  if (dt?.toDate) dt = dt.toDate();
  if (!(dt instanceof Date)) dt = new Date(dt);
  return dt.toLocaleString();
}

/**
 * generateInvoicePDF(sale)
 * Genera un PDF simple pero profesional (cliente, items, totales).
 * Usa jsPDF + autotable (ya cargados en index.html).
 */
async function generateInvoicePDF(sale) {
  try {
    // import UMD object
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });

    // Encabezado
    const margin = 40;
    doc.setFontSize(16);
    doc.text("FACTURA / COMPROBANTE", margin, 60);
    doc.setFontSize(10);
    doc.text(`ID Venta: ${sale.id || '-'}`, margin, 78);
    const created = sale.createdAt?.toDate ? sale.createdAt.toDate() : (sale.createdAt ? new Date(sale.createdAt) : new Date());
    doc.text(`Fecha: ${created.toLocaleString()}`, margin, 92);
    doc.text(`Vendedor: ${sale.createdBy || '-'}`, margin, 106);
    doc.text(`Cliente: ${sale.client || '-'}`, margin, 120);

    // Empresa (toma del companyName o dejar espacio para editar)
    doc.setFontSize(12);
    doc.text("Empresa: " + (document.getElementById("companyName")?.textContent || "Mi Empresa"), 350, 60);
    doc.setFontSize(10);
    doc.text("Dirección: ----------------", 350, 78);
    doc.text("Tel: ----------------------", 350, 92);
    doc.text("NIT: ----------------------", 350, 106);

    // Items tabla: preparar columnas
    const columns = [
      { header: 'Cant.', dataKey: 'qty' },
      { header: 'Descripción', dataKey: 'name' },
      { header: 'Precio', dataKey: 'price' },
      { header: 'Subtotal', dataKey: 'subtotal' }
    ];

    const rows = (sale.items || []).map(it => ({
      qty: it.qty,
      name: it.name,
      price: formatMoneyNumber(it.price),
      subtotal: formatMoneyNumber((it.qty||0) * (it.price||0))
    }));

    // autotable: top Y
    doc.autoTable({
      startY: 140,
      margin: { left: margin, right: margin },
      head: [columns.map(c => c.header)],
      body: rows.map(r => [r.qty, r.name, r.price, r.subtotal]),
      styles: { fontSize: 10 },
      headStyles: { fillColor: [20, 115, 110] }
    });

    // Totales al final
    const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 10 : 300;
    doc.setFontSize(11);
    doc.text(`Total: ${formatMoneyNumber(sale.total)}`, margin, finalY + 30);
    doc.setFontSize(9);
    doc.text("Gracias por tu compra.", margin, finalY + 50);

    // Firma opcional
    doc.setLineWidth(0.5);
    doc.line(margin, finalY + 90, margin + 200, finalY + 90);
    doc.text("Firma autorizada", margin, finalY + 105);

    // Nombre de archivo
    const clientPart = sale.client ? (sale.client.replace(/\s+/g,'_')) : "cliente";
    const fileName = `factura_${sale.id || Date.now()}_${clientPart}.pdf`;

    // Descargar
    doc.save(fileName);

  } catch (err) {
    console.error("generateInvoicePDF error:", err);
    alert("Error generando PDF: " + (err.message || err));
  }
}

/**
 * exportSalesCSV()
 * Descarga todas las ventas (salesCache) en CSV.
 */
function exportSalesCSV() {
  try {
    if (!Array.isArray(salesCache) || !salesCache.length) {
      return alert("No hay ventas para exportar.");
    }
    const rows = [];
    // encabezado
    rows.push(['ventaId','fecha','cliente','total','items']);
    salesCache.forEach(s => {
      const created = s.createdAt?.toDate ? s.createdAt.toDate().toISOString() : (s.createdAt ? new Date(s.createdAt).toISOString() : '');
      const itemsText = (s.items || []).map(i => `${i.qty}x ${i.name} @${i.price}`).join("; ");
      rows.push([s.id, created, s.client || '', s.total || 0, itemsText]);
    });
    // convertir a CSV
    const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ventas_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("exportSalesCSV error:", err);
    alert("Error exportando CSV: " + err.message);
  }
}

/* ========================
   Modificar renderSalesTable para añadir botón Descargar
   (Reemplaza tu renderSalesTable existente con esta versión)
   ======================== */
function renderSalesTable() {
  const tbody = document.querySelector("#tbVentas");
  if (!tbody) return;
  tbody.innerHTML = "";

  salesCache.forEach(sale => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="border px-2 py-1">${formatDateTime(sale.createdAt)}</td>
      <td class="border px-2 py-1">${escapeHtml(sale.client) || '-'}</td>
      <td class="border px-2 py-1">${formatMoneyNumber(sale.total)}</td>
      <td class="border px-2 py-1">${(sale.items || []).map(i => `${i.qty} x ${escapeHtml(i.name)}`).join("<br>")}</td>
      <td class="border px-2 py-1">
        <button class="bg-emerald-600 text-white px-2 py-1 rounded text-xs download-sale" data-id="${sale.id}">Descargar</button>
        <button class="bg-red-500 text-white px-2 py-1 rounded text-xs delete-sale" data-id="${sale.id}">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // listeners
  $$(".download-sale").forEach(btn => {
    btn.onclick = async () => {
      const saleId = btn.dataset.id;
      const sale = salesCache.find(s => s.id === saleId);
      if (!sale) return alert("Venta no encontrada en cache (recarga).");
      await generateInvoicePDF(sale);
    };
  });

  $$(".delete-sale").forEach(btn => {
    btn.onclick = async () => {
      const saleId = btn.dataset.id;
      if (confirm("¿Seguro que deseas eliminar esta venta?")) await deleteSale(saleId);
    };
  });
}


/* ========================
   Botón exportar ventas CSV al UI
   ======================== */
// Añade este pequeño botón visual en algún lugar visible, p.ej. al lado del título Historial de Ventas.
// Si prefieres que lo inserte dinámicamente, lo agrego al inicio del body de la tabla cuando exista el elemento.
(function attachExportButtonToSalesHeader(){
  // espera DOM
  document.addEventListener("DOMContentLoaded", () => {
    const ventasHeader = document.querySelector("#tbVentas")?.closest("div");
    if (!ventasHeader) {
      // lo intentamos en otro selector (si en tu HTML estructura distinta)
      const tb = document.getElementById("tbVentas");
      if (!tb) return;
    }
    // crear barra simple arriba de la tabla (si no existe)
    const container = document.querySelector("#tbVentas")?.parentElement;
    if (!container) return;
    let bar = container.querySelector(".sales-tools-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "sales-tools-bar flex items-center gap-2 mb-2";
      bar.innerHTML = `<button id="btnExportSalesCSV" class="px-2 py-1 border rounded text-sm">Exportar ventas (CSV)</button>`;
      container.insertBefore(bar, container.firstChild);
      const btn = bar.querySelector("#btnExportSalesCSV");
      btn.onclick = exportSalesCSV;
    }
  }, { once: true });
})();

/* FIN: PDF & Export helpers */



/* FIN app.js */
