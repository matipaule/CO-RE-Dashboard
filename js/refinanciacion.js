/**
 * Capa de pantalla de la solapa Refinanciación. Lee los inputs, los pasa a números y le
 * delega todo lo demás a RefinanciacionCore, que no toca el DOM y está testeado en tests.html.
 */
window.Refinanciacion = (function () {
  const C = window.RefinanciacionCore;
  const $ = (id) => document.getElementById(id);

  /** Los montos se cargan como "58.000,00": punto de miles, coma de decimales. */
  function monto(id) {
    const v = ($(id) || {}).value || "";
    if (!String(v).trim()) return NaN;
    return parseFloat(String(v).replace(/\./g, "").replace(",", "."));
  }

  /**
   * Vacío tiene que dar NaN y no 0: el core valida `> 0`, así que un campo sin cargar
   * cae en el error en vez de colarse como un cero válido.
   */
  const entero = (id) => {
    const v = ($(id) || {}).value || "";
    return String(v).trim() ? parseInt(v, 10) : NaN;
  };

  const texto = (id) => (($(id) || {}).value || "").trim();

  /** El mismo input de arriba de todo que usan los demás mensajes del dashboard. */
  const nombreOperador = () => (($("inputOperador") || {}).value || "").trim();

  /**
   * `hoy` va explícito en los dos armados. El core tiene un fallback al reloj real, pero
   * depender de él haría que la fecha mínima se calcule en un momento distinto al de la
   * lectura del formulario.
   */
  function datosPropuesta() {
    return {
      cuotas: entero("refiPropCuotas"),
      valorCuota: monto("refiPropValorCuota"),
      anticipo: monto("refiPropAnticipo"),
      fecha: texto("refiPropFecha"),
      hoy: new Date(),
      operador: nombreOperador(),
    };
  }

  function datosConfirmacion() {
    return {
      nombre: texto("refiConfNombre"),
      prestamos: entero("refiConfPrestamos") || 0,
      cuotificaciones: entero("refiConfCuotificaciones") || 0,
      montoTotal: monto("refiConfMontoTotal"),
      cuotas: entero("refiConfCuotas"),
      valorCuota: monto("refiConfValorCuota"),
      anticipo: monto("refiConfAnticipo"),
      fecha: texto("refiConfFecha"),
      diaVenc: entero("refiConfDiaVenc"),
      hoy: new Date(),
      operador: nombreOperador(),
    };
  }

  /** Los mensajes del core traen la fecha y el nombre del cliente: nada se inyecta como HTML. */
  const escapar = (s) =>
    String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function pintar(idCaja, resultado) {
    const caja = $(idCaja);
    if (!caja) return;
    caja.classList.toggle("solo-avisos", resultado.errores.length === 0 && resultado.avisos.length > 0);
    caja.innerHTML = resultado.errores.map((e) => "<p>⚠ " + escapar(e) + "</p>")
      .concat(resultado.avisos.map((a) => '<p class="aviso">• ' + escapar(a) + "</p>"))
      .join("");
  }

  /**
   * Un mensaje a medio armar no se copia: el operador lo pega en WhatsApp sin releerlo.
   * armarPropuesta y armarConfirmacion no tienen guardas propias —escriben "$NaN" sin
   * quejarse—, así que el `if (!r.ok) return` es el único freno antes del portapapeles.
   * Los avisos sí dejan copiar —son cosas raras pero posibles— y quedan a la vista.
   */
  function copiar(modo, armar, leer, idCaja, etiqueta) {
    const datos = leer();
    const r = C.validar(datos, modo);
    pintar(idCaja, r);
    if (!r.ok) return;

    const mensaje = armar(datos);
    navigator.clipboard.writeText(mensaje).then(function () {
      alert("💬 " + etiqueta + " copiada al portapapeles.");
    }).catch(function () {
      alert("⚠️ No se pudo copiar al portapapeles. Copiá el mensaje a mano:\n\n" + mensaje);
    });
  }

  /**
   * Las dos sub-solapas se muestran y ocultan, no se vuelven a dibujar: entre la propuesta
   * y la confirmación el operador va y viene, y perder lo cargado sería hacerle rehacer
   * la carga desde Emerix.
   */
  function mostrarSub(cual) {
    const esPropuesta = cual === "propuesta";
    $("panelPropuesta").style.display = esPropuesta ? "" : "none";
    $("panelConfirmacion").style.display = esPropuesta ? "none" : "";
    $("subtabPropuesta").classList.toggle("activa", esPropuesta);
    $("subtabConfirmacion").classList.toggle("activa", !esPropuesta);
  }

  /**
   * El calendario deshabilita todo lo anterior al mínimo: el operador no puede prometer una
   * fecha que Ualá no llega a aprobar. El default trae tres hábiles de margen encima.
   */
  function prepararFechas() {
    const hoy = new Date();
    const min = C.aISO(C.fechaMinima(hoy));
    const def = C.aISO(C.fechaDefault(hoy));
    ["refiPropFecha", "refiConfFecha"].forEach(function (id) {
      const el = $(id);
      if (!el) return;
      el.min = min;
      if (!el.value) el.value = def;
    });
  }

  /**
   * La misma trampa que vigila la solapa Cuotas: "58.000" es cincuenta y ocho mil, pero
   * quien escribió "58.00" quiso decir cincuenta y ocho. Se avisa y no se corrige solo:
   * cambiarle a ciegas el monto a un acuerdo es peor que el error que evita.
   */
  const CAMPOS_MONTO = [
    "refiPropValorCuota", "refiPropAnticipo",
    "refiConfMontoTotal", "refiConfValorCuota", "refiConfAnticipo",
  ];

  function vigilarFormato() {
    CAMPOS_MONTO.forEach(function (id) {
      const el = $(id);
      const alerta = $(id + "Alerta");
      if (!el || !alerta) return;
      el.addEventListener("input", function () {
        const v = el.value;
        const sospechoso = v.includes(".") && !v.includes(",") && v.split(".").pop().length <= 2;
        alerta.textContent = sospechoso ? "⚠ ¿Usaste punto para decimales? Recordá usar la coma (,)" : "";
      });
    });
  }

  function init() {
    if (!$("refinanciacion")) return;
    prepararFechas();
    vigilarFormato();

    $("subtabPropuesta").addEventListener("click", () => mostrarSub("propuesta"));
    $("subtabConfirmacion").addEventListener("click", () => mostrarSub("confirmacion"));

    $("btnCopiarPropuestaRefi").addEventListener("click", function () {
      copiar("propuesta", C.armarPropuesta, datosPropuesta, "refiPropErrores", "Propuesta");
    });
    $("btnCopiarConfirmacionRefi").addEventListener("click", function () {
      copiar("confirmacion", C.armarConfirmacion, datosConfirmacion, "refiConfErrores", "Confirmación");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { init };
})();
