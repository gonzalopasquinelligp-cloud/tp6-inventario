// Acceso a Supabase. Toda escritura va por funciones RPC del servidor,
// que validan usuario, rol y datos antes de guardar.
const cfg = window.TP6_CONFIG || {};
export const configurado = Boolean(cfg.supabaseUrl && cfg.supabaseKey && !cfg.supabaseUrl.includes("TU-PROYECTO"));

export const sb = configurado
  ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "tp6-sesion" },
    })
  : null;

export const estado = { perfil: null, productos: [], posiciones: [], relojOffsetMs: 0 };

export class ErrorApp extends Error {
  constructor(msg, { red = false } = {}) { super(msg); this.red = red; }
}

function traducir(error) {
  const m = error?.message || String(error);
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) {
    return new ErrorApp("Sin conexión con el servidor. Los datos del formulario se conservan: tocá «Reintentar».", { red: true });
  }
  if (/JWT expired|invalid JWT|not authenticated/i.test(m)) return new ErrorApp("La sesión venció. Volvé a iniciar sesión.");
  if (/permission denied/i.test(m)) return new ErrorApp("Permiso denegado por el servidor.");
  return new ErrorApp(m);
}

export async function rpc(nombre, params = {}) {
  let res;
  try { res = await sb.rpc(nombre, params); } catch (e) { throw traducir(e); }
  if (res.error) throw traducir(res.error);
  return res.data;
}

// Consulta de lectura sobre una vista o tabla. arma = (query) => query.filtros...
export async function leer(tabla, arma = (q) => q, columnas = "*") {
  let res;
  try { res = await arma(sb.from(tabla).select(columnas)); } catch (e) { throw traducir(e); }
  if (res.error) throw traducir(res.error);
  return res.data || [];
}

export async function cargarPerfil() {
  const p = await rpc("mi_perfil");
  estado.perfil = p;
  if (p?.ahora_contable && p?.ahora_real) {
    estado.relojOffsetMs = new Date(p.ahora_contable) - new Date(p.ahora_real);
  }
  return p;
}

export async function cargarMaestros() {
  const [productos, posiciones] = await Promise.all([
    leer("productos", (q) => q.order("codigo")),
    leer("posiciones", (q) => q.order("codigo")),
  ]);
  estado.productos = productos; estado.posiciones = posiciones;
}

export const ahoraContable = () => new Date(Date.now() + estado.relojOffsetMs);
export const nivel = (rol) => ({ operario: 1, supervisor: 2, administrador: 3 }[rol] || 0);
export const puede = (minimo) => estado.perfil?.activo && nivel(estado.perfil.rol) >= nivel(minimo);
export const producto = (cod) => estado.productos.find((p) => p.codigo === cod);

// Estado de sincronización de un registro (Google Sheets)
export async function estadoSync(registroId) {
  const r = await leer("v_sync_registros", (q) => q.eq("registro_id", registroId).limit(1));
  return r[0] || null;
}
