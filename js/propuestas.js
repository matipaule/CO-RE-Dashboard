/**
 * Carrito de propuestas y sincronización entre solapas.
 * La lógica pura vive en propuesta-core.js; acá solo hay estado y DOM.
 */
window.Propuestas = (function () {

  /**
   * Pares de campos que representan el mismo dato en las dos solapas.
   *
   * El `<select>` de tipo entra igual que los `<input>`: al cambiarlo dispara `input` antes
   * que `change`, así que el espejo copia el valor y recién después corre el `onchange` del
   * HTML. El espejo NO dispara eventos al escribir el otro lado —por eso los dos selectores
   * llevan su propio `onchange="cambiarTipoProducto()"` en el HTML—.
   */
  const ESPEJOS = [
    ["nombreInput", "nombreCuotaInput"],
    ["dniInput", "dniCuotaInput"],
    ["capitalInput", "capitalCuotaInput"],
    ["totalConInteresInput", "saldoInput"],
    ["moraInput", "moraInputCuotas"],
    ["fechaVencInputQuita", "fechaVencInput"],
    ["tipoProductoQuita", "tipoProductoCuotas"],
    ["cantPrestamos", "cantPrestamosCuotas"],
    ["cantCuotificaciones", "cantCuotificacionesCuotas"],
  ];

  function sincronizarCampos() {
    ESPEJOS.forEach(function (par) {
      const a = document.getElementById(par[0]);
      const b = document.getElementById(par[1]);
      if (!a || !b) return;
      a.addEventListener("input", function () { b.value = a.value; });
      b.addEventListener("input", function () { a.value = b.value; });
    });
  }

  const num = (id) => {
    const v = (document.getElementById(id) || {}).value || "0";
    return parseFloat(String(v).replace(/\./g, "").replace(",", ".")) || 0;
  };

  const entero = (id) => parseInt((document.getElementById(id) || {}).value, 10) || 0;

  function leerDeuda() {
    return {
      nombre: ((document.getElementById("nombreInput") || {}).value || "").trim(),
      dni: ((document.getElementById("dniInput") || {}).value || "").trim(),
      capital: num("capitalInput"),
      totalConInteres: num("totalConInteresInput"),
      diasMora: entero("moraInput"),
      tipo: (document.getElementById("tipoProductoQuita") || {}).value || "prestamo",
      productos: {
        prestamos: entero("cantPrestamos"),
        cuotificaciones: entero("cantCuotificaciones"),
      },
    };
  }

  const _propuesta = new Map();   // clave: "deuda_quita_cuotas" → foto

  const claveDe = (deuda, quita, cuotas) => deuda + "_" + quita + "_" + cuotas;

  /**
   * Mismo formato que `obtenerFechaVenc` en script.js:160 — "16 de agosto de 2026".
   * El PDF y los botones Copiar de las solapas comunican el vencimiento así; el mensaje del
   * carrito lo daba como "16/8/2026", sin cero adelante. Es el mismo vencimiento dicho de dos
   * formas según por dónde salga, y en un acuerdo formal eso se nota.
   */
  const FORMATO_FECHA = { day: "2-digit", month: "long", year: "numeric" };

  /**
   * YYYY-MM-DD en hora LOCAL. `toISOString()` pasa a UTC y de tarde en Argentina (UTC-3)
   * adelanta un día: la fecha que se muestra y la que ordena quedarían en días distintos.
   */
  function isoLocal(d) {
    const mes = String(d.getMonth() + 1).padStart(2, "0");
    const dia = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mes + "-" + dia;
  }

  /** `fechaVenc` es lo que ve el deudor; `fechaVencISO` es interno y ordena (propuesta-core). */
  function fechaVencDe() {
    const input = document.getElementById("fechaVencInputQuita");
    const iso = input && input.value;
    if (iso) {
      const d = new Date(iso + "T12:00:00");
      return { fechaVenc: d.toLocaleDateString("es-AR", FORMATO_FECHA), fechaVencISO: iso };
    }
    const d = new Date();
    d.setDate(d.getDate() + 2);                          // default 48 hs, igual que script.js:169
    return { fechaVenc: d.toLocaleDateString("es-AR", FORMATO_FECHA), fechaVencISO: isoLocal(d) };
  }

  /**
   * Guarda la invariante de la deuda: todas las opciones de una MISMA deuda
   * comparten capital, totalConInteres y diasMora.
   *
   * No es cosmético y no se puede sacar: armarMensaje arma el encabezado del bloque
   * con los datos de la PRIMERA opción de cada deuda (`b.opciones[0]`). Si el operador
   * corrige el capital o la mora entre dos altas del mismo producto, las opciones del
   * bloque quedan con datos distintos y al deudor se le comunica el saldo y la mora de
   * la primera —sin error, sin aviso y sin ningún test en rojo—, mientras los montos
   * ofrecidos salieron de otra base. Un fallo silencioso sobre plata que el deudor va
   * a pagar es peor que un rechazo molesto.
   *
   * Hoy la tabla de quitas manda siempre cuotas: 1 y validarAgregado rechaza cuotas
   * repetidas, así que nunca hay dos opciones de la misma deuda y el guard no llega a
   * dispararse. Con la grilla de cuotas de la Task 8 sí se apilan varias por deuda:
   * ahí es donde esto empieza a hacer falta de verdad.
   *
   * Se compara contra la primera opción de la deuda —la que manda en el mensaje—
   * y se rechaza; no se pisa la foto vieja ni se actualizan las otras opciones solas.
   *
   * @returns {string|null} qué dato cambió, listo para el mensaje, o null si está todo bien.
   */
  function datosQueCambiaron(d) {
    const ref = listar().filter((o) => o.deuda === d.tipo)[0];
    if (!ref) return null;
    if (ref.totalConInteres !== d.totalConInteres) return "otro saldo total";
    if (ref.capital !== d.capital) return "otro saldo capital";
    if (ref.diasMora !== d.diasMora) return "otra cantidad de días de mora";
    return null;
  }

  /**
   * ¿La opción que se está agregando se calculó contra OTRA pantalla?
   *
   * `agregar` toma el monto del closure del botón —congelado cuando se apretó CALCULAR— pero
   * el capital, el saldo, la mora y el tipo del DOM en vivo. Entre las dos cosas puede haber
   * pasado que el operador edite un campo y NO recalcule: ahí la tabla dibujada sigue siendo
   * clickeable con los montos y los topes viejos. El caso peor es la mora: con 200 días
   * aparece la fila del 50%, el operador corrige la mora a 50, aprieta ➕ sin recalcular y el
   * mensaje sale diciendo "Días de mora: 50" y abajo "66% de quita" — cuando abajo de 60 días
   * no hay ninguna quita autorizada. `datosQueCambiaron` no lo tapa: compara contra el carrito,
   * y con el carrito vacío no hay contra qué comparar.
   *
   * Mismo patrón que `datosQueCambiaron`, pero contra la base del cálculo en vez del carrito.
   * Sin `base` no se corta nada: es un llamado que no la pasa y ahí no hay nada que comparar.
   *
   * @returns {string|null} qué dato cambió, listo para el mensaje, o null si está todo bien.
   */
  function baseQueCambio(base, d) {
    if (!base) return null;
    if (base.tipo !== d.tipo) return "otro tipo de producto";
    if (base.totalConInteres !== d.totalConInteres) return "otro saldo total";
    if (base.capital !== d.capital) return "otro saldo capital";
    if (base.diasMora !== d.diasMora) return "otra cantidad de días de mora";
    return null;
  }

  /**
   * ¿Esta foto es de otra persona? Un campo vacío en la foto NO es un titular distinto:
   * es un dato que todavía no se cargó. Solo choca lo que está cargado en los dos lados.
   */
  function chocaTitular(o, d) {
    return (!!o.nombre && o.nombre !== d.nombre) || (!!o.dni && o.dni !== d.dni);
  }

  /** Foto sin NINGÚN dato del titular: no se puede saber de quién es. Con uno solo alcanza. */
  const sinTitular = (o) => !o.nombre && !o.dni;

  function avisarOtroTitular(otro, d) {
    alert(
      "⚠️ El carrito tiene opciones cargadas para otro titular: " +
      (otro.nombre || "(sin nombre)") + ", DNI " + (otro.dni || "(sin DNI)") + ".\n\n" +
      "En pantalla figura " + (d.nombre || "(sin nombre)") + ", DNI " + (d.dni || "(sin DNI)") +
      ". Los montos del carrito son los del titular anterior. Si vas a atender a otro deudor, " +
      "limpiá el carrito y volvé a cargar las opciones."
    );
  }

  /**
   * Guarda una FOTO del estado actual. No se relee el DOM después:
   * la segunda pasada (tarjeta) sobreescribe estos mismos inputs.
   *
   * `base` es la foto de los datos con los que se calculó la tabla de donde salió `montoTotal`
   * (ver `baseDelCalculo` en script.js). Es opcional: sin ella el alta pasa como siempre.
   */
  function agregar(quita, cuotas, montoTotal, base) {
    const d = leerDeuda();
    const clave = claveDe(d.tipo, quita, cuotas);

    if (_propuesta.has(clave)) { quitar(clave); return; }

    // Los dos guards de estado viejo van primero: si la opción se calculó contra otra pantalla,
    // no tiene sentido avisar por titular ni por dominancia. Van DESPUÉS del toggle de arriba
    // porque sacar una opción del carrito siempre está permitido.
    const desactualizado = baseQueCambio(base, d);
    if (desactualizado) {
      alert(
        "⚠️ Los datos en pantalla cambiaron después de calcular: ahora figura " + desactualizado + ".\n\n" +
        "Esta opción se calculó con los datos anteriores, así que el monto no corresponde a lo " +
        "que hay cargado. Volvé a calcular y sumá la opción de la tabla nueva."
      );
      return;
    }

    // Red de seguridad final: la tarjeta de crédito no admite plan de cuotas. Si una grilla de
    // préstamo quedó dibujada y el tipo pasó a tarjeta, el ➕ armaría una tarjeta en cuotas —y
    // su PDF sale por `generarPDFCuotas`, que hornea el CBU de préstamos.
    if (d.tipo === "tarjeta" && cuotas > 1) {
      alert(
        "⚠️ La tarjeta de crédito no admite plan de cuotas. Solo pago único con quita.\n\n" +
        "Si la grilla de cuotas quedó de un cálculo anterior, volvé a calcular."
      );
      return;
    }

    // El titular se valida ANTES que los montos: si cambió el deudor, avisar por "otro saldo
    // total" manda al operador a mirar los números cuando el problema es de quién son.
    const enCarrito = listar();
    const otro = enCarrito.filter((o) => chocaTitular(o, d))[0];
    if (otro) { avisarOtroTitular(otro, d); return; }

    const choque = datosQueCambiaron(d);
    if (choque) {
      alert(
        "⚠️ Ya hay opciones cargadas para esta deuda con " + choque + ".\n\n" +
        "Todas las opciones de una misma deuda tienen que compartir el mismo saldo, " +
        "capital y días de mora. Si los datos nuevos son los correctos, limpiá el " +
        "carrito y volvé a cargar las opciones."
      );
      return;
    }

    const candidata = { deuda: d.tipo, quita: quita, cuotas: cuotas, montoTotal: montoTotal };
    const v = window.PropuestaCore.validarAgregado(listar(), candidata);

    if (!v.ok) { alert("⚠️ " + v.motivo); return; }
    if (v.confirmar && !confirm("⚠️ " + v.confirmar)) return;

    /*
     * Fotos sin ningún dato del titular + un titular en pantalla: se pregunta, no se rechaza.
     *
     * Por acá entraba el mensaje mezclado del round 2 —préstamo agregado SIN nombre, después una
     * tarjeta de otra persona con el nombre puesto: `datosQueCambiaron` no cruza deudas distintas
     * y `chocaTitular` no ve nada porque la foto vieja está vacía—, pero el mismo estado lo deja
     * un uso perfectamente normal: ➕, cargar la ficha, ➕ de nuevo. Las dos historias son
     * idénticas por dato, así que no hay guard que las separe: decide el operador, que es el
     * único que sabe a quién está atendiendo.
     *
     * El round 2 rechazaba acá y trababa ese flujo de tres pasos, obligando a limpiar el carrito
     * sin que hubiera pasado nada malo. Es el mismo criterio que `copiarMensaje`: preguntar.
     *
     * Va al final a propósito: cuando se llega hasta acá el alta ya está aprobada, así que la
     * pregunta no aparece para terminar rechazando por saldo o mora, y —más importante— no se
     * completa ninguna foto vieja para un alta que después se cae.
     */
    const sinAtar = enCarrito.filter(sinTitular);
    if (sinAtar.length && (d.nombre || d.dni)) {
      const ok = confirm(
        "⚠️ " + (sinAtar.length === 1
          ? "Hay una opción en el carrito que se cargó"
          : "Hay " + sinAtar.length + " opciones en el carrito que se cargaron") +
        " antes de completar el titular.\n\n" +
        "¿Son de " + (d.nombre || "(sin nombre)") + ", DNI " + (d.dni || "(sin DNI)") + "?\n\n" +
        "Si son de otro deudor, cancelá y limpiá el carrito antes de seguir."
      );
      if (!ok) return;
    }

    // Recién acá se toca lo que ya estaba: el alta está aprobada. A las fotos a las que les
    // falta un campo suelto se les completa igual —el que tienen ya coincidió en `chocaTitular`—.
    completarTitularVacio(enCarrito, d);

    const f = fechaVencDe();
    _propuesta.set(clave, {
      deuda: d.tipo,
      nombre: d.nombre,                   // el titular también va en la foto: ver titularQueCambio
      dni: d.dni,
      capital: d.capital,
      totalConInteres: d.totalConInteres,
      diasMora: d.diasMora,
      productos: d.tipo === "tarjeta" ? {} : d.productos,
      quita: quita,                       // % sobre capital — interno
      quitaSobreTotal: d.totalConInteres > 0
        ? Math.floor(((d.totalConInteres - montoTotal) / d.totalConInteres) * 100)
        : 0,                              // % sobre el total — lo que ve el deudor
      cuotas: cuotas,
      montoTotal: montoTotal,
      valorCuota: Math.ceil(montoTotal / cuotas),
      fechaVenc: f.fechaVenc,
      fechaVencISO: f.fechaVencISO,
    });
    render();
  }

  /**
   * Día del mes de un "YYYY-MM-DD", sin pasar por `Date`: no hay zona horaria que corra el día.
   * Devuelve null si el ISO no está: quien lo consume decide qué mostrar.
   */
  function diaDelISO(iso) {
    return parseInt(String(iso || "").slice(8, 10), 10) || null;
  }

  /**
   * Emite el PDF del acuerdo con los datos CONGELADOS en la foto, no con lo que haya
   * en pantalla: para la segunda deuda el operador recarga esos mismos inputs, así que
   * leer el DOM acá saldría con los montos del otro producto.
   *
   * El titular también sale de la foto, por el mismo motivo y con el mismo criterio que
   * `copiarMensaje`. Se sigue exigiendo que esté: un acuerdo sin nombre ni DNI no
   * identifica a nadie. Si falta es porque la opción se cargó antes de completar la ficha
   * —el ➕ y ARMAR PROPUESTA completan las fotos vacías, ver `completarTitularVacio`—.
   *
   * Y se chequea contra la ficha en pantalla, igual que `copiarMensaje`. No es por la
   * consistencia del documento —ese sale bien armado, con los montos y el titular de la
   * misma persona—: es por el descuido de emitirlo mirando a otro deudor, con el carrito
   * del anterior sin limpiar. Acá pesa más que en el mensaje: un PDF se descarga, se
   * guarda y se reenvía sin que nadie lo vuelva a mirar.
   */
  function generarPDF(clave) {
    const o = _propuesta.get(clave);
    if (!o) return;

    const d = leerDeuda();
    if (chocaTitular(o, d)) { avisarOtroTitular(o, d); return; }

    if (!o.nombre || !o.dni) {
      alert(
        "⚠️ Esta opción se cargó antes de completar el titular.\n\n" +
        "Completá el nombre y el DNI en la ficha y volvé a armar la propuesta " +
        "(💬 ARMAR PROPUESTA) para que queden en el acuerdo."
      );
      return;
    }

    /*
     * El vencimiento que se comunica es el MÁS TEMPRANO del carrito —el mismo que sale en el
     * WhatsApp—, no el de la foto de esta opción. Con dos pasadas cargadas con fechas distintas
     * (25/08 y 18/08), el mensaje decía 18 y el acuerdo firmado de préstamo decía 25: el deudor
     * actúa sobre dos plazos y el que vale legalmente es el papel.
     */
    const items = listar();
    const fechaVenc = window.PropuestaCore.fechaVencMasTemprana(items);
    // El día suelto que necesita "Cuotas siguientes" sale del ISO de ESA MISMA opción —la que
    // aporta la fecha—, no del de esta foto: si no, la fecha y el día del mes del documento
    // saldrían de vencimientos distintos. Si no se encuentra se cae a esta foto.
    const laDeLaFecha = items.filter((x) => x.fechaVenc === fechaVenc)[0] || o;

    const datos = {
      nombre: o.nombre,
      dni: o.dni,
      totalConInteres: o.totalConInteres,   // lo lee el PDF de quita
      saldoTotal: o.totalConInteres,        // lo lee el PDF de cuotas
      diasMora: o.diasMora,
      fechaVenc: fechaVenc,
      // `fechaVenc` ya viene formateado ("20 de agosto de 2026") y de ahí no se saca el día
      // de forma confiable; el PDF de cuotas lo necesita suelto para "Cuotas siguientes".
      diaVenc: diaDelISO(laDeLaFecha.fechaVencISO),
      productos: o.productos,
    };

    if (o.cuotas === 1) {
      // generarPDFQuita espera el % sobre el saldo TOTAL, que es el que ya viene en la foto.
      // `o.quita` es sobre el capital y es de uso interno: no va al PDF.
      generarPDFQuita(o.montoTotal, o.quitaSobreTotal, o.deuda, datos);
    } else {
      generarPDFCuotas(o.cuotas, o.valorCuota, datos);
    }
  }

  function quitar(clave) { _propuesta.delete(clave); render(); }
  function limpiar() { _propuesta.clear(); render(); }

  /** Ordenadas: primero préstamos, después tarjeta; dentro, por cuotas. */
  function listar() {
    return Array.from(_propuesta.values()).sort(function (a, b) {
      if (a.deuda !== b.deuda) return a.deuda === "prestamo" ? -1 : 1;
      return a.cuotas - b.cuotas;
    });
  }

  const NOMBRE_DEUDA = { prestamo: "Préstamos y cuotificaciones", tarjeta: "Tarjeta de crédito" };

  /** Dibuja el panel del carrito. Con el carrito vacío el panel se esconde entero. */
  function render() {
    const panel = document.getElementById("panelPropuesta");
    const badge = document.getElementById("propuestaBadge");
    const lista = document.getElementById("propuestaLista");
    if (!panel) return;

    const items = listar();
    if (items.length === 0) { panel.style.display = "none"; return; }

    const deudas = new Set(items.map((o) => o.deuda));
    badge.textContent = items.length + (items.length === 1 ? " opción" : " opciones") +
      " · " + deudas.size + (deudas.size === 1 ? " deuda" : " deudas");

    lista.innerHTML = items.map(function (o) {
      const plan = o.cuotas === 1
        ? "Pago único → $" + o.montoTotal.toLocaleString("es-AR")
        : o.cuotas + " cuotas de $" + o.valorCuota.toLocaleString("es-AR");
      const clave = claveDe(o.deuda, o.quita, o.cuotas);
      // Los dos botones van juntos en un contenedor: el `space-between` del ítem separa a
      // sus hijos por igual, y con tres el 📄 quedaría flotando en el medio de la fila.
      return `<div class="propuesta-item">
          <span>
            <strong>${plan}</strong> · ${o.quita}% quita
            <div class="item-deuda">${NOMBRE_DEUDA[o.deuda] || o.deuda}</div>
          </span>
          <span style="display:flex; gap:8px; align-items:center;">
            <button class="copiar-btn" title="Generar el PDF del acuerdo" onclick="Propuestas.generarPDF('${clave}')">📄</button>
            <button class="btn-limpiar" onclick="Propuestas.quitar('${clave}')">✕</button>
          </span>
        </div>`;
    }).join("");

    panel.style.display = "block";
  }

  /**
   * Arranca en "Primer contacto" a propósito: si el operador no toca nada sale la
   * plantilla que no da por hecho que ya hubo propuestas antes. Mandarle a un deudor
   * recién asignado "¿qué te impidió avanzar con las propuestas anteriores?" cuando
   * nunca recibió ninguna deja al operador desmentido en el primer renglón.
   */
  function huboGestionPrevia() {
    const el = document.querySelector('input[name="instanciaGestion"]:checked');
    return !!el && el.value === "previa";
  }

  /**
   * El nombre con el que se presenta el operador. Vive en el input de arriba de todo,
   * que se persiste en localStorage: se escribe una vez por navegador.
   *
   * No es un dato de la propuesta y por eso no va en la foto del carrito: quien manda el
   * mensaje es quien lo está mandando ahora, no quien cargó las opciones.
   */
  function nombreOperador() {
    return ((document.getElementById("inputOperador") || {}).value || "").trim();
  }

  /**
   * Completa las fotos a las que les falta el titular.
   *
   * Se llama desde `agregar` —cuando aparece un titular y el carrito tiene fotos sin atar, con
   * la confirmación del operador— y desde `copiarMensaje`, para el carrito que se cargó entero
   * antes de completar la ficha. Un campo ya cargado nunca se pisa: eso sería cambiar de deudor.
   */
  function completarTitularVacio(items, d) {
    items.forEach(function (o) {
      if (!o.nombre) o.nombre = d.nombre;
      if (!o.dni) o.dni = d.dni;
    });
  }

  /**
   * Nombre y DNI se validan ANTES de copiar: son los datos con los que el deudor se
   * identifica en el mensaje, y sin ellos el WhatsApp sale roto.
   *
   * El mensaje se arma con el titular de la FOTO, no con el del DOM: la foto es la fuente de
   * verdad, igual que con los montos.
   *
   * El choque de titular se corta en el ➕ (ver `agregar`), pero se vuelve a chequear acá: este
   * es el único punto por el que el mensaje sale a la calle, y entre el último ➕ y el botón el
   * operador puede haber cambiado los campos de la ficha.
   */
  function copiarMensaje() {
    const items = listar();
    if (items.length === 0) return;
    const d = leerDeuda();
    if (!d.nombre || !d.dni) { alert("⚠️ Completá el nombre y el DNI del titular."); return; }

    const otro = items.filter((o) => chocaTitular(o, d))[0];
    if (otro) { avisarOtroTitular(otro, d); return; }

    /*
     * Fotos sin ningún dato del titular. Misma pregunta que en `agregar` y por el mismo motivo,
     * pero el guard de allá no la hace redundante: si el operador cargó todo el carrito antes de
     * completar la ficha y aprieta ARMAR PROPUESTA sin volver a usar el ➕, nunca pasó por aquel
     * camino y las fotos siguen sin atar. Este es el último punto antes de que el mensaje salga.
     *
     * Solo aparece si se usó el ➕ antes de completar la ficha; no es un confirm de rutina que se
     * termine apretando de memoria.
     */
    const sinAtar = items.filter(sinTitular);
    if (sinAtar.length) {
      const ok = confirm(
        "⚠️ " + (sinAtar.length === 1
          ? "Hay una opción que se cargó"
          : "Hay " + sinAtar.length + " opciones que se cargaron") +
        " antes de completar el titular.\n\n" +
        "¿Son de " + d.nombre + ", DNI " + d.dni + "?\n\n" +
        "Si son de otro deudor, cancelá y limpiá el carrito antes de armar la propuesta."
      );
      if (!ok) return;
    }

    completarTitularVacio(items, d);

    const texto = window.PropuestaCore.armarMensaje(
      items,
      { nombre: items[0].nombre, dni: items[0].dni },
      { huboGestionPrevia: huboGestionPrevia(), operador: nombreOperador() }
    );
    navigator.clipboard.writeText(texto).then(function () {
      alert("💬 Propuesta copiada (" + items.length +
        (items.length === 1 ? " opción)" : " opciones)"));
    }).catch(function () {
      alert("⚠️ No se pudo copiar al portapapeles. Copiá el mensaje a mano:\n\n" + texto);
    });
  }

  /** Misma clave que el módulo Galicia de core_workflow: un operador, un nombre. */
  const CLAVE_OPERADOR = "co_re_operador";

  /**
   * Devuelve el nombre guardado al input. El `oninput` que lo persiste está en el HTML.
   * Si el navegador tiene el storage bloqueado no se rompe nada: el campo arranca vacío
   * y el mensaje sale con la redacción sin nombre.
   */
  function restaurarOperador() {
    const el = document.getElementById("inputOperador");
    if (!el) return;
    try {
      const guardado = localStorage.getItem(CLAVE_OPERADOR);
      if (guardado) el.value = guardado;
    } catch (e) { /* storage no disponible */ }
  }

  function iniciar() {
    sincronizarCampos();
    restaurarOperador();
  }

  // Si el DOM ya está listo (por ejemplo si el script se carga con defer), enganchamos al toque.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }

  return { leerDeuda, agregar, quitar, limpiar, listar, copiarMensaje, generarPDF };
})();
