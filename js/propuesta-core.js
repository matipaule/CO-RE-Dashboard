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

  /**
   * Única quita en cuotas autorizada (+180 días). La quita se aplica al pagar la última
   * cuota: los mensajes y el PDF tienen que avisarlo.
   */
  const QUITA_EN_CUOTAS = Object.freeze({ quita: 40, cuotas: 3 });
  const PLANES_QUITA_EN_CUOTAS = Object.freeze([QUITA_EN_CUOTAS]);

  /** @returns {number|null} null = ninguna quita autorizada */
  function topeQuitaPorMora(diasMora) {
    for (let i = 0; i < TRAMOS_MORA.length; i++) {
      if (diasMora >= TRAMOS_MORA[i].dias) return TRAMOS_MORA[i].tope;
    }
    return null;
  }

  /** Ningún plan en cuotas baja de este valor por cuota (política de gestión, sin excepción). */
  const CUOTA_MINIMA = 50000;
  const MOTIVO_CUOTA_MINIMA = "Con este saldo la cuota quedaría por debajo del mínimo de $50.000.";

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
    const opciones = Array.from({ length: maximo - 1 }, (_, indice) => indice + 2)
      .map((cuotas) => crearOpcion({ modalidad: "cuotas_sin_quita", quita: 0, cuotas, saldoTotal: datos.saldoTotal, capital: datos.capital }))
      .filter((opcion) => opcion.valorCuota >= CUOTA_MINIMA)
      .sort(ordenarComercial);
    if (!opciones.length) return { disponible: false, motivo: MOTIVO_CUOTA_MINIMA, opciones: [] };
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
    return { pagoUnico, quitaEnCuotas: opcionesQuitaEnCuotas(datos) };
  }

  function opcionesQuitaEnCuotas(datos) {
    if (datos.tipo === "tarjeta") return { disponible: false, motivo: "Tarjeta de crédito no admite quita en cuotas.", opciones: [] };
    if (datos.diasMora < 180) return { disponible: false, motivo: "Quita en cuotas disponible desde 180 días de mora.", opciones: [] };
    const opciones = PLANES_QUITA_EN_CUOTAS
      .map((plan) => crearOpcion({ modalidad: "quita_en_cuotas", quita: plan.quita, cuotas: plan.cuotas, saldoTotal: datos.saldoTotal, capital: datos.capital }))
      .filter((opcion) => opcion.valorCuota >= CUOTA_MINIMA)
      .sort(ordenarComercial);
    if (!opciones.length) return { disponible: false, motivo: MOTIVO_CUOTA_MINIMA, opciones: [] };
    return { disponible: true, motivo: "", opciones };
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

    if (candidata.modalidad === "quita_en_cuotas" && (candidata.quita !== QUITA_EN_CUOTAS.quita || candidata.cuotas !== QUITA_EN_CUOTAS.cuotas)) {
      return { ok: false, motivo: `La única quita en cuotas autorizada es ${QUITA_EN_CUOTAS.quita}% sobre capital en ${QUITA_EN_CUOTAS.cuotas} cuotas.` };
    }

    if (candidata.cuotas > 1 && candidata.valorCuota < CUOTA_MINIMA) {
      return { ok: false, motivo: "La cuota no puede ser menor a $50.000." };
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
  /** Así la escribe la operación en los mensajes; el PDF sigue en mayúsculas. */
  const RAZON_SOCIAL_MENSAJE = "Ualá Bank S.A.U.";

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
  /** Los mensajes escriben los importes como la operación: "$500.000.-". */
  const importe = (n) => pesos(n) + ".-";

  const TITULO_DEUDA = {
    prestamo: "PRÉSTAMOS Y CUOTIFICACIONES",
    tarjeta: "TARJETA DE CRÉDITO MASTERCARD",
  };

  const tieneQuita = (o) => !o.esPagoTotal && (o.modalidad === "pago_unico" || o.modalidad === "quita_en_cuotas");

  /** Nunca "0% del capital": la quita solo de intereses se nombra sola. */
  function textoQuita(o) {
    return `Quita del 100% de intereses${o.quita > 0 ? ` y ${o.quita}% del capital` : ""}`;
  }

  /**
   * Una línea por opción cuando se ofrecen varias. No hay ahorro en pesos: solo el total a
   * pagar y los porcentajes, para que el cliente no se quede con un importe que no se prometió.
   */
  function lineaOpcion(o, numero) {
    if (o.modalidad === "pago_unico") {
      const detalle = o.esPagoTotal ? "Saldo total, sin quita." : textoQuita(o) + ".";
      return `${numero}) Un pago de ${importe(o.montoTotal)} ${detalle}`;
    }
    if (o.modalidad === "quita_en_cuotas") {
      return `${numero}) ${o.cuotas} cuotas de ${importe(o.valorCuota)} ${textoQuita(o)}, al pagar la última.`;
    }
    if (o.modalidad === "cuotas_sin_quita") {
      return `${numero}) ${o.cuotas} cuotas de ${importe(o.valorCuota)} Saldo total sin intereses.`;
    }
    return `${numero}) Opción no disponible.`;
  }

  /** La propuesta única se cuenta en dos renglones: qué paga y con qué beneficio vence. */
  function cuerpoUnico(o, fecha) {
    if (o.modalidad === "pago_unico" && o.esPagoTotal) {
      return `Podés regularizar todo con un único pago de ${importe(o.montoTotal)} y dejar tu cuenta al día. Válido hasta el ${fecha}.`;
    }
    if (o.modalidad === "pago_unico") {
      return `Podés cancelar todo con un único pago de ${importe(o.montoTotal)}\n${textoQuita(o)}, válida hasta el ${fecha}.`;
    }
    if (o.modalidad === "quita_en_cuotas") {
      return `Podés cancelar todo en ${o.cuotas} cuotas de ${importe(o.valorCuota)}\n${textoQuita(o)}, que se aplica al pagar la última cuota. Válida hasta el ${fecha}.`;
    }
    return `Podés regularizar en ${o.cuotas} cuotas fijas de ${importe(o.valorCuota)}, saldo total sin intereses. Válido hasta el ${fecha}.`;
  }

  const ISO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

  /** Formatea un ISO de fecha civil sin pasar por Date ni aplicar zona horaria. */
  function fechaArgentinaDesdeISO(iso) {
    if (typeof iso !== "string" || !ISO_FECHA.test(iso)) return "";
    const partes = iso.split("-");
    return partes[2] + "/" + partes[1] + "/" + partes[0];
  }

  const conFechaISO = (opciones) => opciones.filter(
    (o) => o && typeof o.fechaVencISO === "string" && ISO_FECHA.test(o.fechaVencISO)
  );

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
    const conISO = conFechaISO(opciones);

    if (conISO.length) {
      const ordenadas = conISO.sort((a, b) => (a.fechaVencISO < b.fechaVencISO ? -1 : 1));
      return ordenadas[0].fechaVenc;
    }

    const alguna = opciones.filter((o) => o && o.fechaVenc)[0];
    return alguna ? alguna.fechaVenc : "";
  }

  /** La misma fecha que `fechaVencMasTemprana`, en el formato corto del mensaje. */
  function fechaVencCorta(opciones) {
    const isos = conFechaISO(opciones).map((o) => o.fechaVencISO).sort();
    return isos.length ? fechaArgentinaDesdeISO(isos[0]) : fechaVencMasTemprana(opciones);
  }

  /**
   * La pregunta que va en TODOS los mensajes que le llegan al deudor —quitas, cuotas y
   * refinanciación—. Vive acá y no copiada en cada armador: con varias copias, el día que
   * se cambie una frase van a quedar mensajes diciendo otra cosa, sin ningún test en rojo.
   */
  const PREGUNTA_MOTIVO = "Comentame qué te llevó al atraso y con qué ingresos contás para abonar.";
  const PREGUNTA_SEGUIMIENTO = "Comentame qué te impidió avanzar la vez pasada y con qué ingresos contás para abonar.";

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

  /** " (incluye 2 préstamos y 1 cuotificación)", o nada si no se cargaron productos. */
  function incluye(productos) {
    const txt = formatearProductos(productos);
    return txt ? ` (incluye ${txt})` : "";
  }

  /** CBU y alias en una línea; la cuenta de tarjeta sin quita no tiene alias. */
  function lineaCuenta(deuda, conQuita) {
    const d = datosCuenta(deuda, conQuita);
    return "CBU " + d.cbu + (d.alias ? " · Alias " + d.alias : "");
  }

  /**
   * Un carrito vacío no es un error a gritar: devuelve "" y que decida el llamador.
   * La función es pura y no puede confiar en el guard de quien la llama; un bug de
   * UI o un doble click no pueden tumbar la app sin mensaje legible.
   *
   * Orden fijo que pidió la supervisión: primero la deuda, después las propuestas con su
   * vigencia, las preguntas y al final los datos oficiales de pago. Sin emojis, sin ahorro
   * en pesos y apuntando a no pasar los 1.000 caracteres.
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

    const fecha = fechaVencCorta(opciones);
    const unica = opciones.length === 1 ? opciones[0] : null;
    const hayQuita = opciones.some(tieneQuita);
    // El criterio de la cuenta es `quitaSobreTotal`, NO `quita`: la quita solo de intereses
    // guarda `quita` en 0 y aun así va a la cuenta CON quita, igual que en el PDF.
    const cuentaDe = (b) => lineaCuenta(b.deuda, b.opciones.some((o) => o.quitaSobreTotal > 0));
    const mora = (b) => fechaArgentinaDesdeISO(b.opciones[0].fechaInicioMoraISO);
    const saldo = (b) => importe(b.opciones[0].totalConInteres);

    let detalle;
    let propuestas;
    let datosPago;
    if (deudas.length === 1) {
      const b = deudas[0];
      detalle = b.deuda === "tarjeta"
        ? `Te detallo: Saldo actual de tu tarjeta Mastercard: ${saldo(b)}, con atraso desde el ${mora(b)} e informado en bases crediticias.`
        : `Te detallo: Saldo actual: ${saldo(b)}${incluye(b.opciones[0].productos)}, con atraso desde el ${mora(b)} e informado en bases crediticias.`;
      propuestas = unica
        ? cuerpoUnico(unica, fecha)
        : `Tenés ${opciones.length} formas de regularizar, válidas hasta el ${fecha}:\n` +
          opciones.map((o, i) => lineaOpcion(o, i + 1)).join("\n");
      if (b.deuda === "tarjeta" && hayQuita) propuestas += "\nEste beneficio aplica solo a tu tarjeta.";
      datosPago = `DATOS OFICIALES DE PAGO: Cuenta a nombre de ${RAZON_SOCIAL_MENSAJE} · CUIT ${CUIT} ·\n${cuentaDe(b)}`;
    } else {
      // Con dos deudas cada bloque lleva su saldo, sus opciones y su cuenta. La numeración
      // corre de un bloque al otro para que el cliente pueda decir "quiero la 3".
      let numero = 0;
      detalle = "Te detallo tus deudas, con atraso e informadas en bases crediticias:";
      propuestas = deudas.map(function (b) {
        const productos = b.deuda === "prestamo" ? incluye(b.opciones[0].productos) : "";
        return `${TITULO_DEUDA[b.deuda]}\nSaldo actual: ${saldo(b)}${productos}, con atraso desde el ${mora(b)}.\n` +
          b.opciones.map((o) => lineaOpcion(o, ++numero)).join("\n") +
          `\n${cuentaDe(b)}`;
      }).join("\n\n") +
        `\n\nOpciones válidas hasta el ${fecha}. Son dos deudas separadas: pagá cada una a su cuenta, en transferencias distintas.`;
      datosPago = `DATOS OFICIALES DE PAGO: Cuentas a nombre de ${RAZON_SOCIAL_MENSAJE} · CUIT ${CUIT}, con el CBU indicado en cada deuda.`;
    }

    const vence = unica && !tieneQuita(unica) && unica.modalidad !== "cuotas_sin_quita"
      ? "esta propuesta"
      : "este beneficio";
    const cierre = unica
      ? `¿Te sirve? ¿Necesitás otra opción? Contanos antes de que venza ${vence}.`
      : "¿Cuál te conviene? ¿Necesitás más opciones? Contanos antes de que venzan estos u otros beneficios.";

    return [
      presentacion(titular.nombre, opts.operador),
      detalle,
      "",
      propuestas,
      cierre,
      opts.huboGestionPrevia ? PREGUNTA_SEGUIMIENTO : PREGUNTA_MOTIVO,
      "",
      datosPago,
      "Avisame antes de pagar y mandame el comprobante y el DNI del titular de la cuenta desde la que transferís.",
      `No ingreses dinero a tu cuenta Ualá hasta que se acredite, ya que NO podría aplicarse el ${hayQuita ? "descuento" : "acuerdo"}.`,
    ].join("\n");
  }

  // `presentacion` se exporta porque la usa también la propuesta de refinanciación: el
  // saludo tiene una sola fuente de verdad y el caso del operador vacío se resuelve igual.
  //
  // `fechaVencMasTemprana` se exporta por el mismo motivo: el PDF del carrito la usa para
  // comunicar el MISMO vencimiento que el WhatsApp. Si se saca del export, el acuerdo
  // firmado vuelve a la fecha de su propia foto y las dos piezas se contradicen.
  return { topeQuitaPorMora, maxCuotasPorSaldo, opcionesCuotas, opcionesQuita, ordenarComercial, mejorPorModalidad, prioridadPara, validarAgregado, MAX_POR_DEUDA, QUITA_EN_CUOTAS, CUOTA_MINIMA, formatearProductos, datosCuenta, textoCuenta, presentacion, fechaVencMasTemprana, armarMensaje, importe, PREGUNTA_MOTIVO, PREGUNTA_SEGUIMIENTO };
})();
