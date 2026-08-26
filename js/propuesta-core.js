/**
 * Lógica pura de las propuestas: topes, validaciones y armado de texto.
 * Sin DOM y sin efectos: todo entra por parámetro y sale por retorno,
 * para que se pueda probar desde tests.html.
 */
window.PropuestaCore = (function () {

  /** Tope de quita sobre capital según días de mora, según onboarding. */
  const TRAMOS_MORA = [
    { dias: 180, tope: 50 },
    { dias: 150, tope: 40 },
    { dias: 120, tope: 30 },
    { dias: 90, tope: 20 },
    { dias: 30, tope: 0 }
  ];

  const PLANES_QUITA_EN_CUOTAS = Object.freeze([
    Object.freeze({ quita: 50, cuotas: 3 })
  ]);

  /** @returns {number|null} null = ninguna quita autorizada */
  function topeQuitaPorMora(diasMora) {
    for (let i = 0; i < TRAMOS_MORA.length; i++) {
      if (diasMora >= TRAMOS_MORA[i].dias) return TRAMOS_MORA[i].tope;
    }
    return null;
  }

  function maxCuotasPorSaldo(saldoTotal) {
    if (saldoTotal <= 1000000) return 12;
    if (saldoTotal <= 6000000) return 15;
    if (saldoTotal <= 20000000) return 18;
    return 36;
  }

  function prioridadPara(modalidad, quita) {
    if (modalidad === "quita_en_cuotas") return { prioridad: "rojo", motivoPrioridad: "Último recurso: combina quita de capital y financiación." };
    if (modalidad === "cuotas_sin_quita") return { prioridad: "amarillo", motivoPrioridad: "Recupera el saldo total, pero difiere el cobro." };
    if (quita <= 10) return { prioridad: "verde", motivoPrioridad: "Prioriza una cancelación inmediata con baja concesión." };
    if (quita <= 40) return { prioridad: "amarillo", motivoPrioridad: "Cancelación inmediata con una concesión intermedia." };
    return { prioridad: "rojo", motivoPrioridad: "Último recurso: aplica la quita máxima autorizada." };
  }

  function crearOpcion({ modalidad, quita, cuotas, saldoTotal, capital, esPagoTotal = false }) {
    const totalObjetivo = esPagoTotal || modalidad === "cuotas_sin_quita"
      ? Math.round(saldoTotal)
      : Math.round(capital * (1 - quita / 100));
    const valorCuota = Math.ceil(totalObjetivo / cuotas);
    const montoTotal = valorCuota * cuotas;
    const prioridad = esPagoTotal
      ? { prioridad: "verde", motivoPrioridad: "Prioriza la cancelación total inmediata, sin quita." }
      : prioridadPara(modalidad, quita);
    return Object.freeze({
      id: `${modalidad}-${esPagoTotal ? "total" : quita}-${cuotas}`, modalidad, quita,
      esPagoTotal,
      quitaSobreTotal: Math.round((1 - montoTotal / saldoTotal) * 100), cuotas,
      saldoTotal, capital,
      interesesCondonados: esPagoTotal || modalidad === "cuotas_sin_quita" ? 0 : Math.max(0, saldoTotal - capital),
      descuentoCapital: esPagoTotal || modalidad === "cuotas_sin_quita" ? 0 : capital - totalObjetivo,
      totalObjetivo, valorCuota, montoTotal, cobroInicial: valorCuota,
      recuperacionSobreTotal: montoTotal / saldoTotal * 100,
      prioridad: prioridad.prioridad, motivoPrioridad: prioridad.motivoPrioridad
    });
  }

  function ordenarComercial(a, b) {
    return b.cobroInicial - a.cobroInicial || a.cuotas - b.cuotas || b.montoTotal - a.montoTotal;
  }

  /** Devuelve la mejor oferta de una modalidad sin reordenar la colección de origen. */
  function mejorPorModalidad(opciones, modalidad) {
    const candidatas = (Array.isArray(opciones) ? opciones : [])
      .filter((opcion) => opcion.modalidad === modalidad)
      .slice()
      .sort(ordenarComercial);
    return candidatas[0] || null;
  }

  function datosEconomicosValidos(datos) {
    return Number.isFinite(datos.saldoTotal) && datos.saldoTotal > 0 && Number.isFinite(datos.capital) && datos.capital > 0 && datos.capital <= datos.saldoTotal && Number.isFinite(datos.diasMora) && datos.diasMora >= 0;
  }

  function opcionesCuotas(datos) {
    if (!datosEconomicosValidos(datos)) return { disponible: false, motivo: "Revisá saldo total, capital y días de mora.", opciones: [] };
    if (datos.tipo === "tarjeta") return { disponible: false, motivo: "Tarjeta de crédito no admite Acuerdos de Pago.", opciones: [] };
    if (datos.diasMora < 90) return { disponible: false, motivo: "Acuerdo de Pago disponible desde 90 días de mora.", opciones: [] };
    const maximo = maxCuotasPorSaldo(datos.saldoTotal);
    const opciones = Array.from({ length: maximo - 1 }, (_, indice) => indice + 2).map((cuotas) => crearOpcion({ modalidad: "cuotas_sin_quita", quita: 0, cuotas, saldoTotal: datos.saldoTotal, capital: datos.capital })).sort(ordenarComercial);
    return { disponible: true, motivo: "", opciones };
  }

  function opcionesQuita(datos) {
    const vacio = (motivo) => ({ pagoUnico: { disponible: false, motivo, opciones: [] }, quitaEnCuotas: { disponible: false, motivo, opciones: [] } });
    if (!datosEconomicosValidos(datos)) return vacio("Revisá saldo total, capital y días de mora.");
    const tope = topeQuitaPorMora(datos.diasMora);
    const pagoTotal = crearOpcion({ modalidad: "pago_unico", quita: 0, cuotas: 1, saldoTotal: datos.saldoTotal, capital: datos.capital, esPagoTotal: true });
    const cancelacionesConQuita = tope === null
      ? []
      : Array.from({ length: tope / 10 + 1 }, (_, indice) => indice * 10)
        .map((quita) => crearOpcion({ modalidad: "pago_unico", quita, cuotas: 1, saldoTotal: datos.saldoTotal, capital: datos.capital }));
    const pagoUnico = { disponible: true, motivo: "", opciones: [pagoTotal, ...cancelacionesConQuita].sort(ordenarComercial) };
    const quitaEnCuotas = datos.tipo === "tarjeta"
      ? { disponible: false, motivo: "Tarjeta de crédito no admite quita en cuotas.", opciones: [] }
      : datos.diasMora >= 180
        ? { disponible: true, motivo: "", opciones: PLANES_QUITA_EN_CUOTAS.map((plan) => crearOpcion({ modalidad: "quita_en_cuotas", quita: plan.quita, cuotas: plan.cuotas, saldoTotal: datos.saldoTotal, capital: datos.capital })).sort(ordenarComercial) }
        : { disponible: false, motivo: "Quita en cuotas disponible desde 180 días de mora.", opciones: [] };
    return { pagoUnico, quitaEnCuotas };
  }

  const MAX_POR_DEUDA = 3;

  const etiquetaPlan = (c) => (c === 1 ? "pago único" : c + " cuotas");

  /**
   * Decide si una opción se puede sumar al carrito.
   * La invariante del menú es: más cuotas ⇒ paga más total.
   * Se evalúa solo contra las opciones de la MISMA deuda: comparar un
   * préstamo contra una tarjeta no significa nada, son plata distinta.
   */
  function validarAgregado(opciones, candidata) {
    const mismaDeuda = opciones.filter((o) => o.deuda === candidata.deuda);

    if (candidata.deuda === "tarjeta" && (candidata.modalidad !== "pago_unico" || candidata.cuotas !== 1)) {
      return { ok: false, motivo: "Tarjeta de crédito no admite cuotas; solo cancelaciones en un pago." };
    }

    if (candidata.modalidad === "quita_en_cuotas" && (candidata.quita !== 50 || candidata.cuotas !== 3)) {
      return { ok: false, motivo: "La única quita en cuotas autorizada es 50% sobre capital en 3 cuotas." };
    }

    if (mismaDeuda.length >= MAX_POR_DEUDA) {
      return { ok: false, motivo: `Ya hay ${MAX_POR_DEUDA} opciones para esta deuda. Quitá una antes de agregar otra.` };
    }

    /*
     * Una financiación nunca puede ser económicamente mejor que la cancelación con
     * quita ofrecida en el mismo menú: si paga igual o menos y además obtiene plazo,
     * la cancelación inmediata queda indefendible. Se valida sobre el conjunto final
     * para que el resultado no dependa del orden en que el cobrador apriete ➕.
     * El pago del saldo completo queda afuera: no es una cancelación con beneficio.
     */
    const menuResultante = mismaDeuda.concat([candidata]);
    const cancelacionesConQuita = menuResultante.filter(
      (o) => o.modalidad === "pago_unico" && !o.esPagoTotal
    );
    const planesEnCuotas = menuResultante.filter((o) => o.cuotas > 1);
    if (cancelacionesConQuita.length && planesEnCuotas.length) {
      const cancelacionMayor = Math.max(...cancelacionesConQuita.map((o) => o.montoTotal));
      const planIncoherente = planesEnCuotas.find((o) => o.montoTotal <= cancelacionMayor);
      if (planIncoherente) {
        return {
          ok: false,
          motivo: `El plan de ${etiquetaPlan(planIncoherente.cuotas)} totaliza $${planIncoherente.montoTotal.toLocaleString("es-AR")} y debe superar la cancelación con quita de $${cancelacionMayor.toLocaleString("es-AR")}.`,
        };
      }
    }

    const mismaModalidad = mismaDeuda.filter((o) => o.modalidad === candidata.modalidad);

    for (let i = 0; i < mismaModalidad.length; i++) {
      if (mismaModalidad[i].cuotas === candidata.cuotas) {
        return { ok: false, motivo: `Ya hay una opción de ${etiquetaPlan(candidata.cuotas)} para esta modalidad (${mismaModalidad[i].quita}% de quita).` };
      }
    }

    // Un rechazo es definitivo, un empate es solo un aviso: hay que recorrer TODAS
    // las opciones antes de devolver el empate, o el orden en que se cargó el
    // carrito decidiría si una violación se detecta o queda tapada.
    let empate = null;

    for (let i = 0; i < mismaModalidad.length; i++) {
      const o = mismaModalidad[i];

      if (candidata.cuotas > o.cuotas && candidata.montoTotal < o.montoTotal) {
        return { ok: false, motivo: `Con ${etiquetaPlan(candidata.cuotas)} pagaría menos que con ${etiquetaPlan(o.cuotas)}. El deudor elegiría siempre esta y la otra opción sobra.` };
      }

      if (candidata.cuotas < o.cuotas && candidata.montoTotal > o.montoTotal) {
        return { ok: false, motivo: `Con ${etiquetaPlan(candidata.cuotas)} pagaría más que con ${etiquetaPlan(o.cuotas)}. El deudor elegiría siempre la otra.` };
      }

      if (empate === null && candidata.montoTotal === o.montoTotal) {
        empate = o;
      }
    }

    if (empate !== null) {
      return {
        ok: true,
        confirmar: `Con ${etiquetaPlan(candidata.cuotas)} paga lo mismo que con ${etiquetaPlan(empate.cuotas)}. Va a elegir el plan más largo y el otro no suma. ¿Lo agregás igual?`,
      };
    }

    return { ok: true };
  }

  function formatearProductos(p) {
    const prestamos = (p && p.prestamos) || 0;
    const cuotificaciones = (p && p.cuotificaciones) || 0;
    const partes = [];
    if (prestamos > 0) {
      partes.push(prestamos + (prestamos === 1 ? " préstamo" : " préstamos"));
    }
    if (cuotificaciones > 0) {
      partes.push(cuotificaciones + (cuotificaciones === 1 ? " cuotificación" : " cuotificaciones"));
    }
    return partes.join(" y ");
  }

  const RAZON_SOCIAL = "UALÁ BANK S.A.U.";
  const CUIT = "30-71565463-2";

  /** Espejo de obtenerDatosCuenta en script.js:232. Tres cuentas distintas. */
  function datosCuenta(deuda, conQuita) {
    if (deuda === "tarjeta" && !conQuita) {
      return { cbu: "3840100200000000619567", alias: null, razonSocial: RAZON_SOCIAL, cuit: CUIT, banco: "UALÁ BANK S.A.U." };
    }
    if (deuda === "tarjeta") {
      return { cbu: "3840200500000049624900", alias: "ACUERDO.UALABANK.TDC", razonSocial: RAZON_SOCIAL, cuit: CUIT, banco: "UALÁ BANK S.A.U." };
    }
    return { cbu: "3840200500000045539941", alias: "UALABANK.PMO", razonSocial: RAZON_SOCIAL, cuit: CUIT, banco: "WILOBANK SAU" };
  }

  function textoCuenta(deuda, conQuita) {
    const d = datosCuenta(deuda, conQuita);
    let txt = "CBU: " + d.cbu;
    if (d.alias) txt += "\nAlias: " + d.alias;
    txt += "\nRazón Social: " + d.razonSocial + "\nCUIT: " + d.cuit;
    if (!d.alias) txt += "\nBanco: " + d.banco;
    return txt;
  }

  const pesos = (n) => "$" + Number(n).toLocaleString("es-AR");

  const TITULO_DEUDA = {
    prestamo: "🏦 PRÉSTAMOS Y CUOTIFICACIONES",
    tarjeta: "💳 TARJETA DE CRÉDITO MASTERCARD",
  };

  /** Cada propuesta separa modalidad, total, forma de pago y beneficio para lectura rápida. */
  function lineaOpcion(o, numero) {
    const tieneQuita = !o.esPagoTotal && (o.modalidad === "pago_unico" || o.modalidad === "quita_en_cuotas");
    const beneficio = tieneQuita
      ? `\n   Beneficio aplicado: quita del 100% de los intereses${o.quita > 0 ? ` y del ${o.quita}% sobre el capital` : ""}.`
      : "";
    const sinInteresAdicional = "\n   Sin interés adicional: las cuotas no aumentan el monto total informado.";

    if (o.modalidad === "pago_unico") {
      const titulo = o.esPagoTotal ? "Cancelación total sin quita" : "Cancelación con quita";
      return `${numero}. *${titulo}*\n   *Total a pagar: ${pesos(o.montoTotal)}*${beneficio}`;
    }

    if (o.modalidad === "cuotas_sin_quita") {
      return `${numero}. *Acuerdo de Pago sin quita*\n   *Total del acuerdo: ${pesos(o.montoTotal)}*\n   Forma de pago: *${o.cuotas} cuotas de ${pesos(o.valorCuota)}*${sinInteresAdicional}`;
    }

    if (o.modalidad === "quita_en_cuotas") {
      return `${numero}. *Quita en ${o.cuotas} cuotas*\n   *Total del acuerdo: ${pesos(o.montoTotal)}*\n   Forma de pago: *${o.cuotas} cuotas de ${pesos(o.valorCuota)}*${sinInteresAdicional}${beneficio}`;
    }

    return `${numero}. Opción no disponible`;
  }

  const ISO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

  /** Formatea un ISO de fecha civil sin pasar por Date ni aplicar zona horaria. */
  function fechaArgentinaDesdeISO(iso) {
    if (typeof iso !== "string" || !ISO_FECHA.test(iso)) return "";
    const partes = iso.split("-");
    return partes[2] + "/" + partes[1] + "/" + partes[0];
  }

  /**
   * La fecha que se comunica es la más temprana de todo el carrito.
   *
   * El filtro por `fechaVencISO` válido NO es defensa de más y no hay que sacarlo:
   * comparar strings sirve para YYYY-MM-DD, pero contra `undefined` toda comparación
   * da `false`. Una opción sin fecha se iría siempre al final del orden y, si era la
   * más temprana, el mensaje le comunicaría al deudor un vencimiento que no es —sin
   * error, sin aviso y sin ningún test en rojo—. El deudor después actúa sobre esa
   * fecha, así que el fallo silencioso es peor que un crash.
   *
   * Si ninguna opción trae ISO válido se cae a la primera `fechaVenc` disponible:
   * con los datos rotos igual conviene emitir el mensaje a romper el armado entero.
   */
  function fechaVencMasTemprana(opciones) {
    const conISO = opciones.filter(
      (o) => o && typeof o.fechaVencISO === "string" && ISO_FECHA.test(o.fechaVencISO)
    );

    if (conISO.length) {
      const ordenadas = conISO.sort((a, b) => (a.fechaVencISO < b.fechaVencISO ? -1 : 1));
      return ordenadas[0].fechaVenc;
    }

    const alguna = opciones.filter((o) => o && o.fechaVenc)[0];
    return alguna ? alguna.fechaVenc : "";
  }

  /**
   * Las dos piezas que van en TODOS los mensajes que le llegan al deudor —quitas, cuotas,
   * refinanciación, primer contacto o seguimiento—: la pregunta por el motivo del atraso
   * y el bloque de consecuencias.
   *
   * Viven acá y no copiadas en cada armador porque son texto que redactó la operación y
   * que se lee palabra por palabra: con seis copias, el día que se cambie una frase van a
   * quedar cinco mensajes diciendo otra cosa, sin error y sin test en rojo.
   *
   * `armarMensaje` hace la pregunta dentro de su apertura —con la redacción propia de cada
   * plantilla—, así que usa `CONSECUENCIAS` pero no `PREGUNTA_MOTIVO`.
   */
  const PREGUNTA_MOTIVO =
    "Antes de avanzar, ¿podés contarme brevemente cuál fue el motivo del atraso y cuál es tu situación actual?";

  const CONSECUENCIAS =
    "⚠️ Mientras la deuda continúe en mora, *puede afectar tu historial crediticio y continuar informándose en BCRA*.\n\n" +
    "✅ Al regularizarla, *podrás avanzar en la actualización de tu situación crediticia y normalizar tu cuenta*.";

  /**
   * Primera línea del mensaje.
   *
   * El nombre del operador puede estar vacío —es un campo que cada uno completa una vez
   * en su navegador y nada obliga a hacerlo—. Ahí no se tapa el hueco con un espacio de
   * más ni con un "undefined": cambia la redacción entera, así la frase cierra igual.
   */
  function presentacion(nombre, operador) {
    const op = String(operador || "").trim();
    const saludo = nombre ? "Hola, " + nombre + "." : "Hola.";
    return op
      ? `${saludo} Soy ${op} de CO-RE, por tu cuenta Ualá.`
      : `${saludo} Te escribo de CO-RE, por tu cuenta Ualá.`;
  }

  /**
   * Un carrito vacío no es un error a gritar: devuelve "" y que decida el llamador.
   * La función es pura y no puede confiar en el guard de quien la llama; un bug de
   * UI o un doble click no pueden tumbar la app sin mensaje legible.
   *
   * El texto es el que redactó la operación y se copia tal cual, incluidas las negritas
   * de WhatsApp (`*`) y los emojis. Las dos plantillas —primer contacto y gestión previa—
   * comparten el saludo, los bloques y el aviso de vencimiento, y se separan en la frase
   * de apertura, en el bloque de consecuencias y en la pregunta del final.
   */
  function armarMensaje(opciones, titular, opts) {
    if (!Array.isArray(opciones) || opciones.length === 0) return "";
    if (opciones.some((o) => o && o.deuda === "tarjeta" && (o.modalidad !== "pago_unico" || o.cuotas !== 1))) return "";
    if (opciones.some((o) => !fechaArgentinaDesdeISO(o && o.fechaInicioMoraISO))) return "";
    opts = opts || {};
    titular = titular || {};
    const deudas = [];
    ["prestamo", "tarjeta"].forEach(function (d) {
      const propias = opciones.filter((o) => o.deuda === d);
      if (propias.length) deudas.push({ deuda: d, opciones: propias });
    });

    const soloTarjeta = deudas.length === 1 && deudas[0].deuda === "tarjeta";
    const fecha = fechaVencMasTemprana(opciones);
    let numero = 0;

    const bloques = deudas.map(function (b) {
      const ref = b.opciones[0];
      // El criterio es `quitaSobreTotal`, NO `quita`. `quita` es el % sobre capital y la
      // fila "Quita de Intereses" de la solapa Quitas la guarda en 0 aunque condone todos
      // los intereses: para esa opción autorizada debe usarse la cuenta CON quita tanto en
      // el mensaje como en el PDF.
      // Es el mismo criterio que ya usan `copiarPlan` y `generarPDFCuotas` en script.js.
      const conQuita = b.opciones.some((o) => o.quitaSobreTotal > 0);
      const cuenta = textoCuenta(b.deuda, conQuita);
      const productos = formatearProductos(ref.productos);

      const encabezado = deudas.length > 1
        ? `━━━ ${TITULO_DEUDA[b.deuda]} ━━━\n\n`
        : "";

      const detalle = [
        productos ? "📋 Productos en gestión: " + productos : null,
        "• Saldo total adeudado (con intereses): " + pesos(ref.totalConInteres),
        "• Saldo capital: " + pesos(ref.capital),
        "• Fecha de inicio de mora: " + fechaArgentinaDesdeISO(ref.fechaInicioMoraISO),
      ].filter(Boolean).join("\n");

      const lineas = b.opciones.map((o) => lineaOpcion(o, ++numero)).join("\n");
      const tituloPropuestas = b.opciones.length === 1
        ? "💰 *Propuesta disponible*"
        : "💰 *Propuestas disponibles*";

      return `${encabezado}📌 *Detalle de la deuda*\n${detalle}\n\n${tituloPropuestas}\n${lineas}\n\n🏦 *Datos para realizar el pago*\n${cuenta}`;
    }).join("\n\n");

    const avisoDosDeudas = deudas.length > 1
      ? "\n\n⚠️ Son dos deudas separadas y se pagan a cuentas distintas. No las juntes en una sola transferencia."
      : "";

    // Con una sola deuda no hay encabezado de bloque —lo pone `deudas.length > 1`— y los
    // `productos` de la tarjeta se guardan vacíos a propósito, así que el mensaje de una
    // tarjeta sola daba saldo, mora, opción y CBU sin UNA palabra sobre qué deuda es. El
    // botón Copiar de la misma fila sí lo dice (copiarChatQuita), con esta misma frase.
    const exclusion = soloTarjeta
      ? "\n\n⚠️ Este beneficio aplica a tu deuda de TARJETA DE CRÉDITO."
      : "";

    // Va con los datos de pago y no al final: el mensaje cierra con una pregunta a propósito.
    // Que el CBU esté en el mensaje es justamente lo que hace falta este pedido — sin él, el
    // deudor puede pagar sin avisar y el operador se entera cuando ya no puede acreditarlo.
    const comprobante = "\n\n⚠️ *Importante:* avisame antes de pagar y mandame el comprobante por esta vía.";

    const unica = opciones.length === 1 ? opciones[0] : null;
    const preguntaSituacion = opts.huboGestionPrevia
      ? "¿Podés contarme qué te impidió avanzar con las propuestas anteriores y cuál es tu situación actual?"
      : "¿Podés contarme brevemente cuál fue el motivo del atraso y cuál es tu situación actual?";
    let gancho = "*Hoy podés regularizar tu deuda con una propuesta de pago.*";
    if (opciones.length > 1) {
      gancho = "*Preparé alternativas para que puedas regularizar tu deuda pagando menos o en cuotas sin interés adicional.*";
    } else if (unica.modalidad === "pago_unico" && unica.esPagoTotal) {
      gancho = "*Hoy podés regularizar tu cuenta cancelando el saldo pendiente.*";
    } else if (unica.modalidad === "pago_unico") {
      gancho = `*Hoy podés cancelar tu deuda con quita del 100% de los intereses${unica.quita > 0 ? ` y del ${unica.quita}% sobre el capital` : ""}.*`;
    } else if (unica.modalidad === "cuotas_sin_quita") {
      gancho = `*Hoy podés regularizar tu deuda en ${unica.cuotas} cuotas sin interés adicional.*`;
    } else if (unica.modalidad === "quita_en_cuotas") {
      gancho = `*Hoy podés regularizar tu deuda en ${unica.cuotas} cuotas sin interés adicional y con quita del 100% de los intereses${unica.quita > 0 ? ` y del ${unica.quita}% sobre el capital` : ""}.*`;
    }
    const apertura = `${gancho}\n\n${preguntaSituacion}`;

    // El aviso de caducidad va en las DOS plantillas. En el borrador de la operación aparecía
    // solo en la de primer contacto; dejarlo afuera del seguimiento sería mandar una oferta
    // con beneficios y sin fecha de corte. Queda anotado como supuesto a confirmar.
    const vencimiento = opciones.length === 1
      ? `⏳ Esta opción vence el *${fecha}*. Si no regularizás dentro de ese plazo, *podés perder el beneficio ofrecido*.`
      : `⏳ Estas opciones vencen el *${fecha}*. Si no regularizás dentro de ese plazo, *podés perder los beneficios ofrecidos*.`;

    // El bloque es el mismo en las dos plantillas. Antes el de primer contacto tenía solo
    // la consecuencia positiva: el deudor que recién entra en gestión es justamente el que
    // todavía no sabe lo que se le viene si no paga.
    const consecuencias = CONSECUENCIAS;

    const pregunta = opciones.length === 1
      ? "¿Qué te parece esta propuesta? ¿Podrías avanzar con ella?"
      : opts.huboGestionPrevia
        ? "¿Cuál de estas opciones podrías abonar?"
        : "¿Con cuál opción podrías avanzar?";

    return `${presentacion(titular.nombre, opts.operador)}

${apertura}

${bloques}${avisoDosDeudas}${exclusion}${comprobante}

${vencimiento}

${consecuencias}

${pregunta}`;
  }

  // `presentacion` se exporta porque la usan también los dos mensajes de script.js
  // (solapas Quitas y Cuotas): el saludo tiene una sola fuente de verdad y el caso
  // del operador vacío se resuelve igual en los tres mensajes.
  //
  // `fechaVencMasTemprana` se exporta por el mismo motivo: el PDF del carrito la usa para
  // comunicar el MISMO vencimiento que el WhatsApp. Si se saca del export, el acuerdo
  // firmado vuelve a la fecha de su propia foto y las dos piezas se contradicen.
  return { topeQuitaPorMora, maxCuotasPorSaldo, opcionesCuotas, opcionesQuita, ordenarComercial, mejorPorModalidad, prioridadPara, validarAgregado, MAX_POR_DEUDA, formatearProductos, datosCuenta, textoCuenta, presentacion, fechaVencMasTemprana, armarMensaje, PREGUNTA_MOTIVO, CONSECUENCIAS };
})();
