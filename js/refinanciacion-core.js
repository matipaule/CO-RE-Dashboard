/**
 * Refinanciación: el producto nuevo de Ualá. Lógica pura, sin DOM, para que los dos
 * mensajes se puedan testear sin navegador. La capa de pantalla vive en refinanciacion.js.
 */
window.RefinanciacionCore = (function () {
  const TASA_ANUAL = 50;
  const MIN_CUOTAS = 12;

  /**
   * Ualá tarda 7 días hábiles como mínimo en aprobar un plan, y el deudor no puede pagar
   * el anticipo antes de esa aprobación. Por eso la fecha límite nunca puede caer antes.
   * El default suma 10 en vez de 7 para que el operador arranque con margen.
   *
   * "Hábiles" acá es solo sin sábados ni domingos: una tabla de feriados argentinos habría
   * que mantenerla año a año y no la tenemos. El cartel de la pantalla lo aclara.
   */
  const HABILES_APROBACION = 7;
  const HABILES_DEFAULT = 10;

  /**
   * El <input type="date"> devuelve "2026-09-02", y `new Date` de ese string lo lee como
   * UTC: en Argentina (UTC-3) eso da el 1 de septiembre. Un día menos en la fecha límite
   * de un acuerdo no es un detalle, así que se parsea a mano.
   */
  function parsearISO(iso) {
    const p = String(iso).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  const dosDigitos = (n) => String(n).padStart(2, "0");

  /** El formato que el input date entiende para su atributo `min`. */
  function aISO(fecha) {
    return fecha.getFullYear() + "-" + dosDigitos(fecha.getMonth() + 1) + "-" + dosDigitos(fecha.getDate());
  }

  /** Devuelve una fecha nueva: quien la llama suele reusar la que pasó. */
  function sumarDiasHabiles(fecha, n) {
    const d = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    let restantes = n;
    while (restantes > 0) {
      d.setDate(d.getDate() + 1);
      const dia = d.getDay();
      if (dia !== 0 && dia !== 6) restantes--;
    }
    return d;
  }

  const fechaMinima = (hoy) => sumarDiasHabiles(hoy, HABILES_APROBACION);
  const fechaDefault = (hoy) => sumarDiasHabiles(hoy, HABILES_DEFAULT);

  /** El template aprobado usa dd/mm/aaaa. Los PDF del dashboard usan otro formato: es a propósito. */
  function formatearFecha(fecha) {
    return dosDigitos(fecha.getDate()) + "/" + dosDigitos(fecha.getMonth() + 1) + "/" + fecha.getFullYear();
  }

  /**
   * Un número que el operador no cargó tiene que fallar la validación, no colarse como 0:
   * `Number("")` es 0 y un anticipo de cero pesos pasaría derecho al mensaje.
   */
  const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

  /**
   * `modo` parte la validación en dos porque los formularios son independientes: la
   * propuesta se manda hoy y la confirmación una semana larga después, en otra sesión.
   *
   * Los errores bloquean el botón de copiar. Los avisos no: son cosas raras pero posibles,
   * y decidir por el operador algo que Ualá no confirmó sería inventar una regla.
   */
  function validar(datos, modo) {
    const errores = [];
    const avisos = [];

    if (!(num(datos.cuotas) >= MIN_CUOTAS)) {
      errores.push("La cantidad de cuotas no puede ser menor a " + MIN_CUOTAS + ".");
    }
    if (!(num(datos.valorCuota) > 0)) errores.push("Falta el valor de cada cuota.");
    if (!(num(datos.anticipo) > 0)) errores.push("Falta el monto del anticipo.");

    if (!datos.fecha) {
      errores.push("Falta la fecha límite de pago del anticipo.");
    } else {
      const minima = fechaMinima(datos.hoy || new Date());
      if (parsearISO(datos.fecha) < minima) {
        errores.push(
          "La fecha no puede ser anterior al " + formatearFecha(minima) + ": Ualá tarda " +
          HABILES_APROBACION + " días hábiles como mínimo en aprobar el plan."
        );
      }
    }

    // Los dos mensajes arrancan con el saldo y los productos, así que los dos los exigen.
    // El nombre solo es obligatorio en la confirmación: la propuesta saluda igual sin él.
    if (!(num(datos.montoTotal) > 0)) errores.push("Falta el saldo total a refinanciar.");
    const productos = (Number(datos.prestamos) || 0) + (Number(datos.cuotificaciones) || 0);
    if (productos < 1) {
      errores.push("Cargá al menos un producto: la tarjeta de crédito no se refinancia.");
    }

    if (modo === "confirmacion") {
      if (!String(datos.nombre || "").trim()) {
        errores.push("Falta el nombre y apellido del cliente.");
      }

      const dia = num(datos.diaVenc);
      if (!(dia >= 1 && dia <= 31)) {
        errores.push("El día de vencimiento tiene que estar entre 1 y 31.");
      } else if (dia > 28) {
        avisos.push("Ojo: los meses de 30 días o menos no tienen el día " + dia + ".");
      }
    }

    return { ok: errores.length === 0, errores, avisos };
  }

  const importe = (n) => window.PropuestaCore.importe(n);

  function incluye(datos) {
    const txt = window.PropuestaCore.formatearProductos({
      prestamos: Number(datos.prestamos) || 0,
      cuotificaciones: Number(datos.cuotificaciones) || 0,
    });
    return txt ? ` (incluye ${txt})` : "";
  }

  /**
   * Primer mensaje: se manda cuando el deudor contesta y hay interés. Todavía no hay acuerdo,
   * y por eso insiste con que no pague: si paga antes de la aprobación de Ualá, el dinero
   * entra sin plan al que imputarlo.
   */
  function armarPropuesta(datos) {
    const saludo = window.PropuestaCore.presentacion(String(datos.nombre || "").trim(), datos.operador);
    return [
      `${saludo} ¡Gracias por responder!`,
      `Te detallo: Saldo actual: ${importe(datos.montoTotal)}${incluye(datos)}, informado en bases crediticias.`,
      "",
      `Podés refinanciarlo en ${datos.cuotas} cuotas de ${importe(datos.valorCuota)} (IVA incluido), con tasa anual del ${TASA_ANUAL}%.`,
      `Anticipo para activarla: ${importe(datos.anticipo)} · Fecha límite: ${formatearFecha(parsearISO(datos.fecha))}.`,
      "Si te interesa, confirmame que este número sigue siendo tu contacto y te llamo para explicarte los pasos.",
      window.PropuestaCore.PREGUNTA_MOTIVO,
      "",
      "IMPORTANTE: No pagues nada todavía. Primero validamos el acuerdo por teléfono. Si pagás antes, NO podría aplicarse la refinanciación.",
    ].join("\n");
  }

  /**
   * Segundo mensaje: los términos que el deudor acepta por escrito. Conserva las condiciones
   * legales (sistema francés, revocación en 10 días hábiles y el "Acepto").
   */
  function armarConfirmacion(datos) {
    const nombre = String(datos.nombre || "").trim();
    return [
      `${nombre ? "Hola, " + nombre + "." : "Hola."} Estos son los términos de tu refinanciación:`,
      `Monto total: ${importe(datos.montoTotal)}${incluye(datos)}.`,
      `${datos.cuotas} cuotas de ${importe(datos.valorCuota)} · Tasa anual del ${TASA_ANUAL}% · Vencen el día ${datos.diaVenc} de cada mes.`,
      `Anticipo: ${importe(datos.anticipo)}, a pagar hasta el ${formatearFecha(parsearISO(datos.fecha))}.`,
      "",
      "IMPORTANTE: No pagues el anticipo hasta que te confirmemos. Sin ese pago en fecha, NO se activa la refinanciación.",
      "Se calcula con sistema de amortización francés y podés revocarla hasta 10 días hábiles después de recibir por mail los términos y condiciones.",
      "",
      "Para confirmarla, respondé \"Acepto\" por este chat.",
    ].join("\n");
  }

  return {
    TASA_ANUAL, MIN_CUOTAS, HABILES_APROBACION, HABILES_DEFAULT,
    parsearISO, aISO, sumarDiasHabiles, fechaMinima, fechaDefault, formatearFecha,
    validar, armarPropuesta, armarConfirmacion,
  };
})();
