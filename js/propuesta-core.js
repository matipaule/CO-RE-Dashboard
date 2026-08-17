/**
 * Lógica pura de las propuestas: topes, validaciones y armado de texto.
 * Sin DOM y sin efectos: todo entra por parámetro y sale por retorno,
 * para que se pueda probar desde tests.html.
 */
window.PropuestaCore = (function () {

  /** Tope de quita sobre capital según días de mora. Ya vigente en script.js:500. */
  const TRAMOS_MORA = [
    { dias: 180, tope: 50 },
    { dias: 150, tope: 40 },
    { dias: 120, tope: 30 },
    { dias: 90,  tope: 20 },
    { dias: 60,  tope: 0  },  // solo quita de intereses
  ];

  /** @returns {number|null} null = ninguna quita autorizada */
  function topeQuitaPorMora(diasMora) {
    for (let i = 0; i < TRAMOS_MORA.length; i++) {
      if (diasMora >= TRAMOS_MORA[i].dias) return TRAMOS_MORA[i].tope;
    }
    return null;
  }

  /**
   * Tope de quita según la cantidad de cuotas: a más cuotas, menos quita.
   * Es lo que sostiene la invariante del menú (más cuotas ⇒ paga más total).
   * El máximo de cuotas ofrecido alguna vez fueron 18, con permiso del banco.
   */
  function topeQuitaPorCuotas(cuotas) {
    if (cuotas <= 1) return 50;
    if (cuotas <= 3) return 30;
    if (cuotas <= 6) return 20;
    return 10;
  }

  /** Los dos topes se cruzan: vale el menor. @returns {number|null} */
  function quitaMaxima(diasMora, cuotas) {
    const porMora = topeQuitaPorMora(diasMora);
    if (porMora === null) return null;
    return Math.min(porMora, topeQuitaPorCuotas(cuotas));
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

    if (mismaDeuda.length >= MAX_POR_DEUDA) {
      return { ok: false, motivo: `Ya hay ${MAX_POR_DEUDA} opciones para esta deuda. Quitá una antes de agregar otra.` };
    }

    for (let i = 0; i < mismaDeuda.length; i++) {
      if (mismaDeuda[i].cuotas === candidata.cuotas) {
        return { ok: false, motivo: `Ya hay una opción de ${etiquetaPlan(candidata.cuotas)} para esta deuda (${mismaDeuda[i].quita}% de quita).` };
      }
    }

    // Un rechazo es definitivo, un empate es solo un aviso: hay que recorrer TODAS
    // las opciones antes de devolver el empate, o el orden en que se cargó el
    // carrito decidiría si una violación se detecta o queda tapada.
    let empate = null;

    for (let i = 0; i < mismaDeuda.length; i++) {
      const o = mismaDeuda[i];

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

  /**
   * Al deudor se le comunica SIEMPRE el % sobre el saldo total (quitaSobreTotal),
   * que es como se le viene hablando. El campo `quita` es el % sobre capital y es
   * de uso interno: manda en los topes y en las reglas de dominancia, nunca se muestra.
   */
  function lineaOpcion(o, numero) {
    const cuerpo = o.cuotas === 1
      ? `Pago único con ${o.quitaSobreTotal}% de quita → *${pesos(o.montoTotal)}*`
      : `${o.cuotas} cuotas con ${o.quitaSobreTotal}% de quita → *${o.cuotas} × ${pesos(o.valorCuota)}* (total ${pesos(o.montoTotal)})`;
    return `${numero}. ${cuerpo}`;
  }

  const ISO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

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

  /** "1 opción de pago con beneficios" / "2 opciones de pago con beneficios". */
  const etiquetaOpciones = (n) =>
    n === 1 ? "1 opción de pago con beneficios" : n + " opciones de pago con beneficios";

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
    opts = opts || {};
    titular = titular || {};
    const deudas = [];
    ["prestamo", "tarjeta"].forEach(function (d) {
      const propias = opciones.filter((o) => o.deuda === d);
      if (propias.length) deudas.push({ deuda: d, opciones: propias });
    });

    const soloPrestamos = deudas.length === 1 && deudas[0].deuda === "prestamo";
    const soloTarjeta = deudas.length === 1 && deudas[0].deuda === "tarjeta";
    const fecha = fechaVencMasTemprana(opciones);
    let numero = 0;

    const bloques = deudas.map(function (b) {
      const ref = b.opciones[0];
      // El criterio es `quitaSobreTotal`, NO `quita`. `quita` es el % sobre capital y la
      // fila "Quita de Intereses" de la solapa Quitas la guarda en 0 aunque condone todos
      // los intereses: mirándola, una tarjeta de 60 a 89 días —donde esa fila es la única
      // que existe— saldría con el CBU SIN quita mientras el PDF firmado lleva el CON quita.
      // Es el mismo criterio que ya usan `copiarPlan` y `generarPDFCuotas` en script.js.
      const conQuita = b.opciones.some((o) => o.quitaSobreTotal > 0);
      const cuenta = textoCuenta(b.deuda, conQuita);
      const productos = formatearProductos(ref.productos);

      const encabezado = deudas.length > 1
        ? `━━━ ${TITULO_DEUDA[b.deuda]} ━━━\n`
        : "";

      const detalle = [
        productos ? "📋 Productos en gestión: " + productos : null,
        "• Saldo total adeudado (con intereses): " + pesos(ref.totalConInteres),
        "• Saldo capital: " + pesos(ref.capital),
        "• Días de mora: " + ref.diasMora,
      ].filter(Boolean).join("\n");

      const lineas = b.opciones.map((o) => lineaOpcion(o, ++numero)).join("\n");

      return `${encabezado}${detalle}\n\nOpciones disponibles:\n${lineas}\n\n💳 ${cuenta}`;
    }).join("\n\n");

    // Los dos avisos no pueden convivir: uno pide dos deudas y el otro una sola
    // que además sea de préstamos. Por eso comparten lugar, pegados a los bloques.
    const avisoDosDeudas = deudas.length > 1
      ? "\n\n⚠️ Son dos deudas separadas y se pagan a cuentas distintas. No las juntes en una sola transferencia."
      : "";

    // Con una sola deuda no hay encabezado de bloque —lo pone `deudas.length > 1`— y los
    // `productos` de la tarjeta se guardan vacíos a propósito, así que el mensaje de una
    // tarjeta sola daba saldo, mora, opción y CBU sin UNA palabra sobre qué deuda es. El
    // botón Copiar de la misma fila sí lo dice (copiarChatQuita), con esta misma frase.
    // Los dos avisos comparten lugar: uno pide préstamos solos y el otro tarjeta sola.
    const exclusion = soloPrestamos
      ? "\n\n⚠️ Este beneficio aplica exclusivamente a préstamos y cuotificaciones; la tarjeta de crédito, en caso de poseerla, queda excluida."
      : soloTarjeta
        ? "\n\n⚠️ Este beneficio aplica a tu deuda de TARJETA DE CRÉDITO."
        : "";

    // Va con los datos de pago y no al final: el mensaje cierra con una pregunta a propósito.
    // Que el CBU esté en el mensaje es justamente lo que hace falta este pedido — sin él, el
    // deudor puede pagar sin avisar y el operador se entera cuando ya no puede acreditarlo.
    const comprobante = "\n\nImportante: avisame antes de pagar y mandame el comprobante por esta vía.";

    const apertura = opts.huboGestionPrevia
      ? "Te acerco *nuevas opciones de pago*. ¿Podés contarme qué te impidió avanzar con las propuestas anteriores?"
      : `Tengo *${etiquetaOpciones(opciones.length)}* para ofrecerte. Antes, ¿podés contarme brevemente cuál fue el motivo de tu atraso?`;

    // El aviso de caducidad va en las DOS plantillas. En el borrador de la operación aparecía
    // solo en la de primer contacto; dejarlo afuera del seguimiento sería mandar una oferta
    // con beneficios y sin fecha de corte. Queda anotado como supuesto a confirmar.
    const vencimiento = `⏳ Estas opciones vencen el *${fecha}*. Si no regularizás dentro de ese plazo, *podés perder los beneficios ofrecidos*.`;

    const consecuencias = opts.huboGestionPrevia
      ? "⚠️ Mientras la deuda continúe en mora, *puede afectar tu historial crediticio y continuar informándose en BCRA*.\n\n✅ Al regularizarla, *podrás avanzar en la actualización de tu situación crediticia y normalizar tu cuenta*."
      : "✅ Si regularizás tu deuda, *podrás normalizar tu situación con Ualá y recuperar el uso de tu cuenta, según corresponda*.";

    const pregunta = opts.huboGestionPrevia
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
  return { topeQuitaPorMora, topeQuitaPorCuotas, quitaMaxima, validarAgregado, MAX_POR_DEUDA, formatearProductos, datosCuenta, textoCuenta, presentacion, fechaVencMasTemprana, armarMensaje };
})();
