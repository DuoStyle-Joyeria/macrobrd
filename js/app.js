// ==============================
// app.js - Parte 1 (líneas 1–400)
// ==============================

// Inicialización de base de datos en localStorage
// Multi-tenant: cada empresa tiene sus propios datos aislados
const DB_KEY = "app_registro_db_v1";

// Estructura base de la BD
function getDB() {
  const db = JSON.parse(localStorage.getItem(DB_KEY) || "{}");
  if (!db.users) db.users = [];        // usuarios globales
  if (!db.companies) db.companies = []; // cada empresa con sus datos
  return db;
}

function saveDB(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

// ==============================
// UTILIDADES
// ==============================

function genId(prefix = "id") {
  return prefix + "_" + Math.random().toString(36).substr(2, 9);
}

function todayISO() {
  return new Date().toISOString().split("T")[0];
}

function formatMoney(num) {
  return "$" + (num || 0).toLocaleString("es-CO", { minimumFractionDigits: 0 });
}

function parseMoney(str) {
  return parseFloat(str) || 0;
}

// ==============================
// SESIÓN
// ==============================
let currentUser = null;
let currentCompany = null;

function saveSession(userId) {
  localStorage.setItem("currentUserId", userId);
}

function loadSession() {
  const id = localStorage.getItem("currentUserId");
  if (!id) return null;
  const db = getDB();
  const user = db.users.find(u => u.id === id);
  return user || null;
}

function logout() {
  localStorage.removeItem("currentUserId");
  currentUser = null;
  currentCompany = null;
  document.getElementById("mainView").classList.add("hidden");
  document.getElementById("authView").classList.remove("hidden");
}

// ==============================
// AUTH - REGISTRO & LOGIN
// ==============================
document.getElementById("registerForm").addEventListener("submit", e => {
  e.preventDefault();
  const db = getDB();

  const name = document.getElementById("regName").value.trim();
  const email = document.getElementById("regEmail").value.trim().toLowerCase();
  const pass = document.getElementById("regPass").value.trim();
  const role = document.getElementById("regRole").value;

  if (db.users.find(u => u.email === email)) {
    alert("Este email ya está registrado");
    return;
  }

  let companyId = null;

  if (role === "admin") {
    // Crear empresa
    companyId = genId("comp");
    db.companies.push({
      id: companyId,
      name: name + " — Empresa",
      createdAt: Date.now(),
      products: [],
      sales: [],
      gastos: [],
      movimientos: [],
      empleados: [],
      deudas: []
    });
  } else {
    // empleado
    const code = document.getElementById("regCompanyCode").value.trim();
    const invite = document.getElementById("regInviteCode").value.trim();

    const company = db.companies.find(c => c.id === code);
    if (!company) {
      alert("Código de empresa inválido");
      return;
    }
    // validación de invitación omitida por simplicidad
    companyId = company.id;
  }

  const userId = genId("usr");
  const newUser = { id: userId, name, email, pass, role, companyId };
  db.users.push(newUser);
  saveDB(db);

  alert("Usuario creado con éxito. Ya puedes iniciar sesión.");
  document.getElementById("registerForm").reset();
});

document.getElementById("loginForm").addEventListener("submit", e => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const pass = document.getElementById("loginPass").value.trim();

  const db = getDB();
  const user = db.users.find(u => u.email === email && u.pass === pass);
  if (!user) {
    alert("Credenciales incorrectas");
    return;
  }
  saveSession(user.id);
  currentUser = user;
  currentCompany = db.companies.find(c => c.id === user.companyId);
  showMainApp();
});

// Mostrar campos extras cuando elige "empleado"
document.getElementById("regRole").addEventListener("change", e => {
  document.getElementById("employeeExtra").classList.toggle("hidden", e.target.value !== "empleado");
});

// ==============================
// MAIN APP VIEW
// ==============================
function showMainApp() {
  if (!currentUser) return;
  const db = getDB();
  currentCompany = db.companies.find(c => c.id === currentUser.companyId);

  document.getElementById("authView").classList.add("hidden");
  document.getElementById("mainView").classList.remove("hidden");

  document.getElementById("companyName").textContent = currentCompany.name;
  document.getElementById("userRole").textContent = currentUser.role;

  if (currentUser.role !== "admin") {
    document.querySelector("[data-tab='usuarios']").classList.add("hidden");
  } else {
    document.querySelector("[data-tab='usuarios']").classList.remove("hidden");
    document.getElementById("companyIdLabel").textContent = currentCompany.id;
  }

  refreshKPIs();
  renderInventory();
  renderSales();
  renderGastos();
  renderMovimientos();
  renderEmployees();
}

// Logout
document.getElementById("btnLogout").addEventListener("click", () => {
  logout();
});

// Tabs
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => {
      b.classList.remove("bg-slate-900", "text-white");
      b.classList.add("border");
    });
    btn.classList.add("bg-slate-900", "text-white");
    btn.classList.remove("border");

    document.querySelectorAll(".tab").forEach(tab => tab.classList.add("hidden"));
    document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");
  });
});

// ==============================
// KPIs
// ==============================
function refreshKPIs() {
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);

  // Total caja (ventas - gastos)
  const totalVentas = comp.sales.reduce((acc, s) => acc + s.total, 0);
  const totalGastos = comp.gastos.reduce((acc, g) => acc + g.monto, 0);
  const caja = totalVentas - totalGastos;
  document.getElementById("kpiCajaEmpresa").textContent = formatMoney(caja);

  // Inventario total
  const inventarioTotal = comp.products.reduce((acc, p) => acc + (p.stock || 0), 0);
  document.getElementById("kpiInventarioTotal").textContent = inventarioTotal;

  // Deudas
  const totalDeudas = comp.deudas.reduce((acc, d) => acc + d.monto, 0);
  document.getElementById("kpiDeudas").textContent = formatMoney(totalDeudas);
}

// ==============================
// INVENTARIO - Render
// ==============================
function renderInventory() {
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);
  const tbody = document.getElementById("tbInventory");
  tbody.innerHTML = "";
  comp.products.forEach(prod => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${prod.name}</td>
      <td class="small">${prod.gender || ""} ${prod.size || ""} ${prod.color || ""} ${prod.team || ""}</td>
      <td>${formatMoney(prod.price)}</td>
      <td>${prod.stock || 0}</td>
      <td>
        <button data-id="${prod.id}" class="btnDelProd text-red-600">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btnDelProd").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      comp.products = comp.products.filter(p => p.id !== id);
      saveDB(db);
      renderInventory();
      refreshKPIs();
    });
  });
}

// ==============================
// INVENTARIO - Crear producto
// ==============================
document.getElementById("formProduct").addEventListener("submit", e => {
  e.preventDefault();
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);

  const prod = {
    id: genId("prod"),
    name: document.getElementById("prodName").value,
    sku: document.getElementById("prodSku").value,
    gender: document.getElementById("prodGender").value,
    size: document.getElementById("prodSize").value,
    color: document.getElementById("prodColor").value,
    team: document.getElementById("prodTeam").value,
    cost: parseMoney(document.getElementById("prodCost").value),
    price: parseMoney(document.getElementById("prodPrice").value),
    stock: parseInt(document.getElementById("prodInitialStock").value) || 0,
    notes: document.getElementById("prodNotes").value
  };

  comp.products.push(prod);
  saveDB(db);

  document.getElementById("formProduct").reset();
  renderInventory();
  refreshKPIs();
});

// ==============================
// SIGUE EN PARTE 2…
// ==============================

// ==============================
// app.js - Parte 2 (líneas 401–800)
// ==============================

// ==============================
// VENTAS - Render
// ==============================
function renderSales() {
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);
  const tbody = document.getElementById("tbSales");
  tbody.innerHTML = "";
  comp.sales.forEach(sale => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(sale.date).toLocaleString()}</td>
      <td>${sale.items.map(i => i.name + " x" + i.qty).join(", ")}</td>
      <td>${formatMoney(sale.total)}</td>
      <td>${sale.clientName || ""}</td>
      <td>
        <button data-id="${sale.id}" class="btnDelSale text-red-600">Eliminar</button>
        <button data-id="${sale.id}" class="btnInvoice text-blue-600">Factura PDF</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btnDelSale").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      comp.sales = comp.sales.filter(s => s.id !== id);
      saveDB(db);
      renderSales();
      refreshKPIs();
    });
  });

  tbody.querySelectorAll(".btnInvoice").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      const sale = comp.sales.find(s => s.id === id);
      generateInvoicePDF(sale);
    });
  });
}

// ==============================
// VENTAS - Crear venta
// ==============================
document.getElementById("formSale").addEventListener("submit", e => {
  e.preventDefault();
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);

  const productId = document.getElementById("saleProduct").value;
  const qty = parseInt(document.getElementById("saleQty").value);
  const clientName = document.getElementById("saleClientName").value.trim();
  const clientPhone = document.getElementById("saleClientPhone").value.trim();

  const prod = comp.products.find(p => p.id === productId);
  if (!prod || prod.stock < qty) {
    alert("Stock insuficiente");
    return;
  }

  const total = prod.price * qty;

  const sale = {
    id: genId("sale"),
    date: Date.now(),
    items: [{ id: prod.id, name: prod.name, qty, price: prod.price }],
    total,
    clientName,
    clientPhone
  };

  comp.sales.push(sale);
  prod.stock -= qty;

  // Registrar movimiento
  comp.movimientos.push({
    id: genId("mov"),
    type: "venta",
    date: Date.now(),
    descripcion: `Venta de ${qty}x ${prod.name}`,
    monto: total
  });

  saveDB(db);
  renderSales();
  renderInventory();
  refreshKPIs();
  document.getElementById("formSale").reset();
});

// ==============================
// FACTURA PDF
// ==============================
function generateInvoicePDF(sale) {
  if (!sale) return;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Factura de Venta", 14, 20);

  doc.setFontSize(10);
  doc.text("Fecha: " + new Date(sale.date).toLocaleString(), 14, 30);
  if (sale.clientName) doc.text("Cliente: " + sale.clientName, 14, 36);
  if (sale.clientPhone) doc.text("Tel: " + sale.clientPhone, 14, 42);

  const rows = sale.items.map(i => [i.name, i.qty, formatMoney(i.price), formatMoney(i.price * i.qty)]);
  doc.autoTable({
    head: [["Producto", "Cantidad", "Precio", "Total"]],
    body: rows,
    startY: 50
  });

  doc.text("TOTAL: " + formatMoney(sale.total), 14, doc.lastAutoTable.finalY + 10);

  doc.save("factura_" + sale.id + ".pdf");
}

// ==============================
// GASTOS (EGRESOS)
// ==============================
function renderGastos() {
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);
  const tbody = document.getElementById("tbGastos");
  tbody.innerHTML = "";
  comp.gastos.forEach(g => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(g.date).toLocaleString()}</td>
      <td>${g.descripcion}</td>
      <td>${formatMoney(g.monto)}</td>
      <td><button data-id="${g.id}" class="btnDelGasto text-red-600">Eliminar</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btnDelGasto").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      comp.gastos = comp.gastos.filter(x => x.id !== id);
      saveDB(db);
      renderGastos();
      refreshKPIs();
    });
  });
}

document.getElementById("formGasto").addEventListener("submit", e => {
  e.preventDefault();
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);

  const g = {
    id: genId("gasto"),
    date: Date.now(),
    descripcion: document.getElementById("gastoDesc").value,
    monto: parseMoney(document.getElementById("gastoMonto").value)
  };
  comp.gastos.push(g);

  comp.movimientos.push({
    id: genId("mov"),
    type: "gasto",
    date: Date.now(),
    descripcion: g.descripcion,
    monto: -g.monto
  });

  saveDB(db);
  renderGastos();
  refreshKPIs();
  document.getElementById("formGasto").reset();
});

// ==============================
// INGRESOS
// ==============================
function renderIngresos() {
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);
  const tbody = document.getElementById("tbIngresos");
  if (!tbody) return;
  tbody.innerHTML = "";
  (comp.ingresos || []).forEach(g => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(g.date).toLocaleString()}</td>
      <td>${g.descripcion}</td>
      <td>${formatMoney(g.monto)}</td>
      <td><button data-id="${g.id}" class="btnDelIngreso text-red-600">Eliminar</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btnDelIngreso").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      comp.ingresos = comp.ingresos.filter(x => x.id !== id);
      saveDB(db);
      renderIngresos();
      refreshKPIs();
    });
  });
}

document.getElementById("formIngreso")?.addEventListener("submit", e => {
  e.preventDefault();
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);

  if (!comp.ingresos) comp.ingresos = [];

  const g = {
    id: genId("ing"),
    date: Date.now(),
    descripcion: document.getElementById("ingDesc").value,
    monto: parseMoney(document.getElementById("ingMonto").value)
  };
  comp.ingresos.push(g);

  comp.movimientos.push({
    id: genId("mov"),
    type: "ingreso",
    date: Date.now(),
    descripcion: g.descripcion,
    monto: g.monto
  });

  saveDB(db);
  renderIngresos();
  refreshKPIs();
  document.getElementById("formIngreso").reset();
});

// ==============================
// MOVIMIENTOS
// ==============================
function renderMovimientos() {
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);
  const tbody = document.getElementById("tbMovs");
  tbody.innerHTML = "";
  comp.movimientos.forEach(m => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(m.date).toLocaleString()}</td>
      <td>${m.type}</td>
      <td>${m.descripcion}</td>
      <td>${formatMoney(m.monto)}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Descargar reporte de movimientos en PDF
document.getElementById("btnMovsPDF")?.addEventListener("click", () => {
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Reporte de Movimientos", 14, 20);

  const rows = comp.movimientos.map(m => [
    new Date(m.date).toLocaleString(),
    m.type,
    m.descripcion,
    formatMoney(m.monto)
  ]);

  doc.autoTable({
    head: [["Fecha", "Tipo", "Descripción", "Monto"]],
    body: rows,
    startY: 30
  });

  doc.save("movimientos.pdf");
});

// ==============================
// SIGUE EN PARTE 3…
// ==============================

// ==============================
// app.js - Parte 3 (líneas 801–fin)
// ==============================

// ==============================
// USUARIOS (solo admin)
// ==============================
function renderUsers() {
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);
  const tbody = document.getElementById("tbEmployees");
  tbody.innerHTML = "";
  comp.users.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.name}</td>
      <td>${u.email}</td>
      <td>${u.role}</td>
      <td>${new Date(u.created).toLocaleDateString()}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById("formCreateEmployee")?.addEventListener("submit", e => {
  e.preventDefault();
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);

  const emp = {
    id: genId("user"),
    name: document.getElementById("empName").value,
    email: document.getElementById("empEmail").value,
    role: document.getElementById("empRole").value,
    created: Date.now()
  };

  comp.users.push(emp);
  saveDB(db);
  renderUsers();
  e.target.reset();
});

// ==============================
// ESTADÍSTICAS
// ==============================
function renderEstadisticas() {
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);

  // Ventas por día últimos 30 días
  const ventasPorDia = {};
  comp.sales.forEach(s => {
    const d = new Date(s.date).toISOString().split("T")[0];
    ventasPorDia[d] = (ventasPorDia[d] || 0) + s.total;
  });

  const ctx = document.getElementById("chartVentasPorDia").getContext("2d");
  new Chart(ctx, {
    type: "line",
    data: {
      labels: Object.keys(ventasPorDia),
      datasets: [{
        label: "Ventas",
        data: Object.values(ventasPorDia),
        borderColor: "blue",
        fill: false
      }]
    }
  });

  // Top productos últimos 90 días
  const top = {};
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  comp.sales.filter(s => s.date >= cutoff).forEach(s => {
    s.items.forEach(i => {
      top[i.name] = (top[i.name] || 0) + i.qty;
    });
  });

  const ctx2 = document.getElementById("chartTopProducts").getContext("2d");
  new Chart(ctx2, {
    type: "bar",
    data: {
      labels: Object.keys(top),
      datasets: [{
        label: "Cantidad vendida",
        data: Object.values(top),
        backgroundColor: "orange"
      }]
    }
  });
}

// ==============================
// ESTADÍSTICAS - PDF
// ==============================
document.getElementById("btnStatsPDF")?.addEventListener("click", () => {
  const db = getDB();
  const comp = db.companies.find(c => c.id === currentUser.companyId);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Reporte de Estadísticas", 14, 20);

  const totalVentas = comp.sales.reduce((sum, s) => sum + s.total, 0);
  const totalGastos = comp.gastos.reduce((sum, g) => sum + g.monto, 0);
  const totalIngresos = (comp.ingresos || []).reduce((sum, g) => sum + g.monto, 0);

  doc.setFontSize(12);
  doc.text("Resumen general:", 14, 30);
  doc.text("Ventas totales: " + formatMoney(totalVentas), 14, 38);
  doc.text("Egresos totales: " + formatMoney(totalGastos), 14, 46);
  doc.text("Ingresos totales: " + formatMoney(totalIngresos), 14, 54);

  // Tabla de ventas por día
  const ventasPorDia = {};
  comp.sales.forEach(s => {
    const d = new Date(s.date).toISOString().split("T")[0];
    ventasPorDia[d] = (ventasPorDia[d] || 0) + s.total;
  });
  const rows = Object.entries(ventasPorDia).map(([fecha, monto]) => [fecha, formatMoney(monto)]);

  doc.autoTable({
    head: [["Fecha", "Total ventas"]],
    body: rows,
    startY: 70
  });

  doc.save("estadisticas.pdf");
});

// ==============================
// INICIALIZAR
// ==============================
document.addEventListener("DOMContentLoaded", () => {
  // Tab switching
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(tab => tab.classList.add("hidden"));
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("bg-slate-900", "text-white"));
      document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");
      btn.classList.add("bg-slate-900", "text-white");

      // Render dinámico
      if (btn.dataset.tab === "ventas") renderSales();
      if (btn.dataset.tab === "inventario") renderInventory();
      if (btn.dataset.tab === "gastos") renderGastos();
      if (btn.dataset.tab === "ingresos") renderIngresos();
      if (btn.dataset.tab === "movimientos") renderMovimientos();
      if (btn.dataset.tab === "usuarios") renderUsers();
      if (btn.dataset.tab === "estadisticas") renderEstadisticas();
    });
  });

  // Si ya hay sesión activa
  if (currentUser) {
    document.getElementById("authView").classList.add("hidden");
    document.getElementById("mainView").classList.remove("hidden");
    refreshKPIs();
  }
});
