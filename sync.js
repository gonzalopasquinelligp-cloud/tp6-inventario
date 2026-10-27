// Estado de la transferencia automática a Google Sheets.
import { rpc, leer, puede } from "./api.js?v=202610272358";
import { esc, aviso, ICON, fechaHora, tabla, toast } from "./ui.js?v=202610272358";

let t = null;
export function destruir() { clearInterval(t); }

export async function render(el) {
  const pintar = async () => {
    const [[r], regs] = await Promise.all([
      leer("v_sync_resumen"),
      leer("v_sync_registros", (q) => q.order("creado_en", { ascending: false }).limit(60)),
    ]);
    const planilla = window.TP6_CONFIG?.planillaUrl;
    el.innerHTML = `
      <div class="panel"><div class="panel-cab"><h2>Transferencia a Google Sheets</h2>
        <div class="btns">${planilla && puede("supervisor") ? `<a class="btn chico" target="_blank" rel="noopener" href="${esc(planilla)}">Abrir planilla</a>` : ""}
        <button class="btn prim chico" id="ahora">${ICON.sync} Sincronizar ahora</button></div></div>
        <p class="small muted">Cada operación pasa a la planilla al instante y, como respaldo, cada 5 minutos. Si falla, se reintenta sin duplicar filas.</p>
        <div class="grilla g3">
          <div class="kpi ${r.pendientes ? "" : "pos"}"><div class="etq">Pendientes</div><div class="val">${r.pendientes}</div><div class="sub">${r.pendiente_desde ? "desde " + fechaHora(r.pendiente_desde) : "cola vacía"}</div></div>
          <div class="kpi"><div class="etq">Sincronizados</div><div class="val">${r.sincronizados}</div></div>
          <div class="kpi"><div class="etq">Última transferencia</div><div class="val" style="font-size:1.1rem">${fechaHora(r.ultima_sincronizacion)}</div></div>
        </div>
        ${r.ultimo_error ? aviso("alerta", `Último error informado por Apps Script: ${esc(r.ultimo_error)} (se reintentará).`) : ""}
        <div id="msg"></div></div>
      <div class="panel"><h2>Registros recientes</h2>
        ${tabla([{ t: "Hoja", k: "hoja" }, { t: "ID del registro", html: (x) => `<span class="mono">${esc(x.registro_id)}</span>` },
          { t: "Estado", html: (x) => x.pendiente ? `<span class="chip alerta">Pendiente</span>` : `<span class="chip ok">Sincronizado</span>` },
          { t: "Sincronizado", html: (x) => fechaHora(x.sincronizado_en) }, { t: "Intentos", num: true, html: (x) => x.intentos },
          { t: "Encolado", html: (x) => fechaHora(x.creado_en) }], regs, { vacio: "Todavía no hay registros para transferir." })}</div>`;
    el.querySelector("#ahora").addEventListener("click", async () => {
      try {
        const r2 = await rpc("solicitar_sincronizacion");
        if (!r2.configurado) el.querySelector("#msg").innerHTML = aviso("alerta", "La integración todavía no está configurada (ver guía, paso «Conectar Google Sheets»).");
        else { toast(`Aviso enviado. ${r2.pendientes} pendiente(s).`); setTimeout(pintar, 5000); }
      } catch (e) { el.querySelector("#msg").innerHTML = aviso("error", esc(e.message)); }
    });
  };
  await pintar();
  clearInterval(t); t = setInterval(() => pintar().catch(() => {}), 15000);
}
