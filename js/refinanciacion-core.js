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

    if (modo === "confirmacion") {
      if (!String(datos.nombre || "").trim()) {
        errores.push("Falta el nombre y apellido del cliente.");
      }
      if (!(num(datos.montoTotal) > 0)) errores.push("Falta el monto total a refinanciar.");

      const productos = (Number(datos.prestamos) || 0) + (Number(datos.cuotificaciones) || 0);
      if (productos < 1) {
        errores.push("Cargá al menos un producto: la tarjeta de crédito no se refinancia.");
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

  /** PropuestaCore tiene el mismo formateo pero no lo exporta. Una línea no se comparte a la fuerza. */
  const pesos = (n) => "$" + Number(n).toLocaleString("es-AR");

  /**
   * El nombre del operador es opcional —vive en un input de localStorage que nadie obliga a
   * completar—. Sin nombre cambia la despedida entera en vez de dejar "Saludos," colgado.
   * Mismo criterio que presentacion() en propuesta-core.js.
   */
  function firma(operador) {
    const op = String(operador || "").trim();
    return op ? "Saludos,\n" + op + " — CO-RE" : "Saludos";
  }

  /**
   * Primer mensaje: se manda cuando el deudor contesta y hay interés. Todavía no hay acuerdo,
   * y por eso insiste con que no pague: si paga antes de la aprobación de Ualá, el dinero
   * entra sin plan al que imputarlo.
   */
  function armarPropuesta(datos) {
    return `Hola, ¿cómo estás? ¡Gracias por tu respuesta!

${window.PropuestaCore.PREGUNTA_MOTIVO}

Para ayudarte a regularizar tu crédito, te ofrecemos la siguiente opción de refinanciación:

${datos.cuotas} cuotas de ${pesos(datos.valorCuota)} (IVA incluido).
Anticipo: ${pesos(datos.anticipo)}, para activar la refinanciación.
Tasa anual: ${TASA_ANUAL}%.
Fecha límite de pago: ${formatearFecha(parsearISO(datos.fecha))}.

Si te interesa, confirmame que puedo dejar este mismo número como contacto principal, así te llamo y te explico los próximos pasos.

⚠️ Importante: No debes abonar hasta que confirmemos juntos el acuerdo y realicemos la llamada telefónica de validación. De lo contrario, la refinanciación no podrá aplicarse.

Quedamos atentos a tu confirmación. ¡Muchas gracias!

${window.PropuestaCore.CONSECUENCIAS}

${firma(datos.operador)}`;
  }

  /**
   * Segundo mensaje: los términos que el deudor acepta por escrito. Acá sí dice cuántos
   * productos cubre el acuerdo —la propuesta se mantiene corta a propósito—, porque este es
   * el mensaje al que después se puede volver a mirar.
   *
   * Los bullets son "•" y no "*" porque el asterisco abre negrita en WhatsApp: hoy zafarían
   * por el espacio que llevan detrás, pero alcanza que alguien edite un renglón.
   */
  function armarConfirmacion(datos) {
    const nombre = String(datos.nombre || "").trim();
    const productos = window.PropuestaCore.formatearProductos({
      prestamos: Number(datos.prestamos) || 0,
      cuotificaciones: Number(datos.cuotificaciones) || 0,
    });

    return `${nombre ? "Hola, " + nombre + "." : "Hola."}

${window.PropuestaCore.PREGUNTA_MOTIVO}

Te comparto los términos de la refinanciación:

Monto total a refinanciar: ${pesos(datos.montoTotal)} (corresponde a ${productos}).
• Cantidad de cuotas: ${datos.cuotas} cuotas.
• Valor de cada cuota: ${pesos(datos.valorCuota)}.
• Tasa anual: ${TASA_ANUAL}%.
• Anticipo: ${pesos(datos.anticipo)}.
• Fecha límite para abonar el anticipo: ${formatearFecha(parsearISO(datos.fecha))}.
• Vencimiento de las cuotas: todos los días ${datos.diaVenc} de cada mes.

Para que la refinanciación pueda llevarse a cabo, deberás abonar el anticipo indicado hasta la fecha mencionada.

Importante: antes de realizar el pago del anticipo, deberás esperar nuestra confirmación. Por favor, no realices el pago hasta que te indiquemos que podés hacerlo.

La refinanciación se realizará mediante el sistema de amortización francés y podrá revocarse hasta 10 días hábiles posteriores a la recepción por mail de los términos y condiciones de la contratación.

Para confirmar la refinanciación, es necesario que envíes por escrito la palabra “Acepto”.

${window.PropuestaCore.CONSECUENCIAS}

${firma(datos.operador)}`;
  }

  return {
    TASA_ANUAL, MIN_CUOTAS, HABILES_APROBACION, HABILES_DEFAULT,
    parsearISO, aISO, sumarDiasHabiles, fechaMinima, fechaDefault, formatearFecha,
    validar, firma, armarPropuesta, armarConfirmacion,
  };
})();
