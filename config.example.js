// Copiá este archivo como "config.js" y completá los dos valores de tu proyecto Supabase
// (Supabase > Project Settings > API). Ambos son PÚBLICOS por diseño: la seguridad
// la dan las reglas del servidor (RLS y funciones con control de rol).
// NUNCA pongas acá la clave "service_role" / "secret".
window.TP6_CONFIG = {
  supabaseUrl: "https://TU-PROYECTO.supabase.co",
  supabaseKey: "sb_publishable_XXXXXXXXXXXXXXXXXXXX", // o la "anon public key" (empieza con eyJ...)
  // Opcional: enlace de solo lectura a la planilla, visible para supervisores en la pantalla Sincronización
  planillaUrl: "",
  // Opcional: nombre visible de la app (menú, pantalla de ingreso y pestaña del navegador)
  // marca: { nombre: "Inventario", subtitulo: "Gestión de depósito", sigla: "IN" }
};
