// Arranque, sesión, navegación y diseño general.
import { sb, configurado, estado, cargarPerfil, cargarMaestros, puede, ahoraContable } from "./api.js?v=202610272312";
import { esc, aviso, ICON, fechaHora, modal } from "./ui.js?v=202610272312";

// Nombre visible de la app. Se puede cambiar en config.js con: marca: { nombre: "…", subtitulo: "…", sigla: "…" }
const MARCA = { nombre: "Inventario", subtitulo: "Gestión de depósito", sigla: "IN", ...(window.TP6_CONFIG?.marca || {}) };

const RUTAS = [
  { id: "inicio", t: "Inicio", icon: "inicio", rol: "operario", mod: () => import("./inicio.js?v=202610272312") },
  { id: "consulta", t: "Consultar stock", icon: "buscar", rol: "operario", mod: () => import("./consulta.js?v=202610272312") },
  { id: "ingreso", t: "Ingreso de mercadería", icon: "ingreso", rol: "operario", mod: () => import("./movimiento.js?v=202610272312"), grupo: "Operación" },
  { id: "egreso", t: "Egreso por venta", icon: "egreso", rol: "operario", mod: () => import("./movimiento.js?v=202610272312") },
  { id: "retorno", t: "Retorno de venta", icon: "ingreso", rol: "operario", mod: () => import("./movimiento.js?v=202610272312") },
  { id: "conteo", t: "Conteo cíclico", icon: "conteo", rol: "operario", mod: () => import("./conteo.js?v=202610272312") },
  { id: "conciliacion", t: "Conciliación", icon: "conciliar", rol: "operario", mod: () => import("./conciliacion.js?v=202610272312"), grupo: "Control" },
  { id: "informes", t: "Informes", icon: "informe", rol: "operario", mod: () => import("./informes.js?v=202610272312") },
  { id: "gestion", t: "Tablero de gestión", icon: "tablero", rol: "supervisor", mod: () => import("./gestion.js?v=202610272312") },
  { id: "costos", t: "Costo y servicio", icon: "costo", rol: "supervisor", mod: () => import("./costos.js?v=202610272312") },
  { id: "sync", t: "Google Sheets", icon: "sync", rol: "operario", mod: () => import("./sync.js?v=202610272312") },
  { id: "admin", t: "Administración", icon: "admin", rol: "administrador", mod: () => import("./admin.js?v=202610272312"), grupo: "Sistema" },
];
const MOVIL = ["inicio", "consulta", "conteo", "conciliacion"];

const raiz = document.getElementById("raiz");
let vistaActual = null;

function rutaActual() {
  const partes = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { id: partes[0] || "inicio", params: partes.slice(1).map(decodeURIComponent) };
}

function marco() {
  const p = estado.perfil;
  const visibles = RUTAS.filter((r) => puede(r.rol));
  raiz.innerHTML = `
    <div class="app">
      <aside class="lateral">
        <div class="marca"><div class="marca-icono">${esc(MARCA.sigla)}</div><div><b>${esc(MARCA.nombre)}</b><span>${esc(MARCA.subtitulo)}</span></div></div>
        <nav class="nav">${visibles.map((r) => `${r.grupo ? `<div class="grupo">${r.grupo}</div>` : ""}
          <a href="#/${r.id}" data-ruta="${r.id}">${ICON[r.icon]}<span>${r.t}</span></a>`).join("")}
          <div class="grupo">Sesión</div>
          <a href="#" id="salir">${ICON.salir}<span>Cerrar sesión</span></a>
        </nav>
      </aside>
      <div class="principal">
        <header class="barra">
          <div><div class="titulo" id="titulo">—</div><div class="reloj" id="reloj"></div></div>
          <div class="usuario"><span class="nombre">${esc(p.nombre)}</span><span class="rol">${esc(p.rol)}</span></div>
        </header>
        <main class="contenido" id="vista"></main>
      </div>
      <nav class="nav-movil">${MOVIL.map((id) => RUTAS.find((r) => r.id === id)).map((r) =>
        `<a href="#/${r.id}" data-ruta="${r.id}">${ICON[r.icon]}<span>${r.t.split(" ")[0]}</span></a>`).join("")}
        <a href="#" id="menu-movil">${ICON.mas}<span>Más</span></a></nav>
    </div>`;
  raiz.querySelector("#salir").addEventListener("click", salir);
  raiz.querySelector("#menu-movil").addEventListener("click", (e) => {
    e.preventDefault();
    const m = modal(`<div class="flex entre"><h2>Menú</h2><button class="btn chico" data-cerrar>Cerrar</button></div>
      <nav class="nav">${visibles.map((r) => `<a href="#/${r.id}">${ICON[r.icon]}<span>${r.t}</span></a>`).join("")}
      <a href="#" id="salir2">${ICON.salir}<span>Cerrar sesión</span></a></nav>`);
    m.el.querySelectorAll("a[href^='#/']").forEach((a) => a.addEventListener("click", () => m.cerrar()));
    m.el.querySelector("#salir2").addEventListener("click", salir);
  });
  const reloj = () => {
    const el = document.getElementById("reloj");
    if (el) el.innerHTML = `Fecha operativa: ${fechaHora(ahoraContable())}${Math.abs(estado.relojOffsetMs) > 60000 ? " (con desfase)" : ""}<span class="tz"> · hora Argentina</span>`;
  };
  reloj(); setInterval(reloj, 30000);
}

async function navegar() {
  const { id, params } = rutaActual();
  let ruta = RUTAS.find((r) => r.id === id) || RUTAS[0];
  if (!puede(ruta.rol)) ruta = RUTAS[0];
  document.querySelectorAll("[data-ruta]").forEach((a) => a.classList.toggle("activo", a.dataset.ruta === ruta.id));
  document.getElementById("titulo").textContent = ruta.t;
  document.title = `${ruta.t} · ${MARCA.nombre}`;
  // Contenedor nuevo en cada navegación: si una pantalla anterior termina de cargar tarde, no pisa a la actual.
  const vista = document.getElementById("vista");
  try { vistaActual?.destruir?.(); } catch { /* sin acción */ }
  const el = document.createElement("div");
  el.innerHTML = `<div class="cargando">Cargando…</div>`;
  vista.replaceChildren(el);
  try {
    vistaActual = await ruta.mod();
    await vistaActual.render(el, { ruta: ruta.id, params });
  } catch (e) {
    el.innerHTML = aviso("error", `No se pudo cargar la pantalla: ${esc(e.message)}`);
  }
  window.scrollTo(0, 0);
}

async function salir(e) {
  e?.preventDefault();
  await sb.auth.signOut();
  location.hash = "";
  location.reload();
}

function pantallaLogin(msg = "") {
  raiz.innerHTML = `
    <div class="login"><div class="panel">
      <div class="marca" style="padding-left:0"><div class="marca-icono">${esc(MARCA.sigla)}</div><div><b>${esc(MARCA.nombre)}</b><span>${esc(MARCA.subtitulo)}</span></div></div>
      <div id="msg">${msg}</div>
      <form id="f-login">
        <div class="campo"><label for="email">Correo electrónico</label><input id="email" type="email" autocomplete="username" required></div>
        <div class="campo"><label for="clave">Contraseña</label><input id="clave" type="password" autocomplete="current-password" required minlength="6"></div>
        <button class="btn prim grande" type="submit">Ingresar</button>
      </form>
      <div class="sep"></div>
      <details><summary class="small">¿No tenés usuario? Solicitar una cuenta</summary>
        <form id="f-alta" style="margin-top:12px">
          <div class="campo"><label for="a-nombre">Nombre y apellido</label><input id="a-nombre" type="text" required></div>
          <div class="campo"><label for="a-email">Correo electrónico</label><input id="a-email" type="email" required></div>
          <div class="campo"><label for="a-clave">Contraseña (mínimo 8 caracteres)</label><input id="a-clave" type="password" required minlength="8" autocomplete="new-password"></div>
          <button class="btn" type="submit">Crear cuenta</button>
          <div class="ayuda">La cuenta queda inactiva hasta que un administrador le asigne un rol.</div>
        </form></details>
    </div></div>`;
  const msgEl = raiz.querySelector("#msg");
  raiz.querySelector("#f-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const b = e.submitter; b.disabled = true; b.textContent = "Ingresando…";
    const { error } = await sb.auth.signInWithPassword({ email: raiz.querySelector("#email").value.trim(), password: raiz.querySelector("#clave").value });
    if (error) {
      msgEl.innerHTML = aviso("error", /Invalid login/i.test(error.message) ? "Correo o contraseña incorrectos." : esc(error.message));
      b.disabled = false; b.textContent = "Ingresar";
      return;
    }
    iniciar();
  });
  raiz.querySelector("#f-alta").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { data, error } = await sb.auth.signUp({
      email: raiz.querySelector("#a-email").value.trim(),
      password: raiz.querySelector("#a-clave").value,
      options: { data: { nombre: raiz.querySelector("#a-nombre").value.trim() } },
    });
    msgEl.innerHTML = error ? aviso("error", esc(error.message))
      : aviso("ok", data.session ? "Cuenta creada. Un administrador debe activarla antes de operar."
        : "Cuenta creada. Revisá tu correo para confirmarla; luego un administrador debe activarla.");
    if (data?.session) iniciar();
  });
}

function pantallaInactivo(p) {
  raiz.innerHTML = `<div class="login"><div class="panel">
    <h1>Cuenta pendiente de activación</h1>
    <p>Hola, <b>${esc(p.nombre)}</b>. Tu usuario <span class="mono">${esc(p.email)}</span> ya existe, pero un administrador todavía no lo activó ni le asignó un rol.</p>
    <p class="muted small">Pedile al administrador que entre a <b>Administración › Usuarios</b> y active tu cuenta.</p>
    <div class="btns"><button class="btn prim" id="reintentar">Ya me activaron</button><button class="btn" id="salir">Cerrar sesión</button></div>
  </div></div>`;
  raiz.querySelector("#reintentar").addEventListener("click", iniciar);
  raiz.querySelector("#salir").addEventListener("click", salir);
}

async function iniciar() {
  if (!configurado) {
    raiz.innerHTML = `<div class="login"><div class="panel"><h1>Falta configurar la conexión</h1>
      <p>Creá el archivo <span class="mono">config.js</span> a partir de <span class="mono">config.example.js</span> con la URL y la clave pública de tu proyecto Supabase.</p></div></div>`;
    return;
  }
  const { data } = await sb.auth.getSession();
  if (!data.session) return pantallaLogin();
  let p;
  try { p = await cargarPerfil(); } catch (e) { return pantallaLogin(aviso("error", esc(e.message))); }
  if (!p) return pantallaLogin(aviso("error", "No se encontró el perfil del usuario."));
  if (!p.activo) return pantallaInactivo(p);
  await cargarMaestros();
  marco();
  if (!window.__tp6Nav) { window.addEventListener("hashchange", navegar); window.__tp6Nav = true; }
  navegar();
}

sb?.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") location.reload(); });
iniciar();
