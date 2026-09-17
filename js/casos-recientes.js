/**
 * Casos recientes: los datos del cliente que el operador calculó en las últimas 48 h,
 * guardados en su navegador para volver a cargarlos con un clic.
 *
 * `crear` no toca el DOM: recibe el storage y el reloj. En el dashboard son
 * `localStorage` y `Date.now`; en los tests, un storage en memoria y un reloj manual.
 */
window.CasosRecientes = (function () {
  const CLAVE = "co_re_casos_v1";
  const VIGENCIA_MS = 48 * 60 * 60 * 1000;
  const MAX_CASOS = 30;
  const CAMPOS = ["nombre", "capital", "totalConInteres", "diasMora", "fechaInicioMoraISO",
    "fechaVencISO", "tipo", "prestamos", "cuotificaciones"];

  const soloDigitos = (dni) => String(dni || "").replace(/\D/g, "");

  function crear({ storage, ahora }) {
    function leer() {
      try {
        const lista = JSON.parse(storage.getItem(CLAVE) || "[]");
        return Array.isArray(lista) ? lista : [];
      } catch (e) {
        return [];
      }
    }

    function escribir(lista) {
      try {
        storage.setItem(CLAVE, JSON.stringify(lista));
        return true;
      } catch (e) {
        return false;
      }
    }

    /** Vigentes, válidos y del más nuevo al más viejo, con el tope aplicado. */
    function depurar(lista) {
      const limite = ahora() - VIGENCIA_MS;
      return lista
        .filter((c) => c && soloDigitos(c.dni) && typeof c.guardadoEn === "number" && c.guardadoEn > limite)
        .sort((a, b) => b.guardadoEn - a.guardadoEn)
        .slice(0, MAX_CASOS);
    }

    function listar() {
      const original = leer();
      const vigentes = depurar(original);
      if (vigentes.length !== original.length) escribir(vigentes);
      return vigentes;
    }

    function guardar(caso) {
      const dni = soloDigitos(caso && caso.dni);
      if (!dni) return false;
      // `dni` identifica al caso; `dniCargado` es como lo escribió el operador, para rellenar tal cual.
      const nuevo = { dni, dniCargado: String(caso.dni), guardadoEn: ahora() };
      CAMPOS.forEach((campo) => { nuevo[campo] = String(caso[campo] == null ? "" : caso[campo]); });
      const anterior = leer().find((c) => c && soloDigitos(c.dni) === dni);
      // Recalcular o cargar el mismo caso no borra lo último que se le mandó al cliente.
      if (anterior && anterior.ultimoEnvio) nuevo.ultimoEnvio = anterior.ultimoEnvio;
      const resto = leer().filter((c) => !c || soloDigitos(c.dni) !== dni);
      return escribir(depurar([nuevo].concat(resto)));
    }

    function borrar(dni) {
      const objetivo = soloDigitos(dni);
      escribir(leer().filter((c) => !c || soloDigitos(c.dni) !== objetivo));
    }

    /** Anota el resumen de lo último que se copió para ese cliente. Sin caso vigente, no hace nada. */
    function registrarEnvio(dni, texto) {
      const objetivo = soloDigitos(dni);
      const lista = depurar(leer());
      const caso = lista.find((c) => c.dni === objetivo);
      if (!objetivo || !caso) return false;
      caso.ultimoEnvio = { en: ahora(), texto: String(texto) };
      return escribir(lista);
    }

    function borrarTodos() {
      try {
        storage.removeItem(CLAVE);
      } catch (e) {
        escribir([]);
      }
    }

    return { guardar, listar, borrar, borrarTodos, registrarEnvio };
  }

  /**
   * Los 10 datos que Quitas y Cuotas comparten: [campo, id en Quitas, id en Cuotas].
   * Es el mismo orden que ESPEJOS en propuestas.js. Al cargar se escriben los dos ids,
   * porque asignar `value` por código no dispara el espejo.
   */
  const PARES = [
    ["nombre", "nombreInput", "nombreCuotaInput"],
    ["dni", "dniInput", "dniCuotaInput"],
    ["capital", "capitalInput", "capitalCuotaInput"],
    ["totalConInteres", "totalConInteresInput", "saldoInput"],
    ["diasMora", "moraInput", "moraInputCuotas"],
    ["fechaInicioMoraISO", "fechaInicioMoraInput", "fechaInicioMoraInputCuotas"],
    ["fechaVencISO", "fechaVencInputQuita", "fechaVencInput"],
    ["tipo", "tipoProductoQuita", "tipoProductoCuotas"],
    ["prestamos", "cantPrestamos", "cantPrestamosCuotas"],
    ["cuotificaciones", "cantCuotificaciones", "cantCuotificacionesCuotas"],
  ];

  let casos = null;
  let reloj = null;
  let doc = null;

  const escapar = (s) => String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  /** Minúsculas y sin tildes: "Núñez" se encuentra escribiendo "nunez". */
  const normalizar = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  /**
   * Filtra por nombre o DNI. El DNI se compara solo por sus dígitos, así "35.123" y
   * "35123" encuentran lo mismo. Un texto con números busca también en el nombre.
   */
  function filtrar(lista, texto) {
    const consulta = normalizar(texto);
    if (!consulta) return lista;
    const digitos = soloDigitos(consulta);
    return lista.filter((c) =>
      normalizar(c.nombre).includes(consulta) || (digitos && soloDigitos(c.dni).includes(digitos))
    );
  }

  const dosDigitos = (n) => String(n).padStart(2, "0");

  /** Fecha civil local en YYYY-MM-DD, la misma forma que devuelve un `<input type="date">`. */
  function isoLocal(ms) {
    const d = new Date(ms);
    return d.getFullYear() + "-" + dosDigitos(d.getMonth() + 1) + "-" + dosDigitos(d.getDate());
  }

  /** "Hoy", "Ayer" o "15/09": separa lo de cada día aunque la lista guarde 48 h. */
  function etiquetaDia(ms) {
    const dia = isoLocal(ms);
    const hoy = new Date(reloj());
    if (dia === isoLocal(hoy.getTime())) return "Hoy";
    const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
    if (dia === isoLocal(ayer.getTime())) return "Ayer";
    const d = new Date(ms);
    return dosDigitos(d.getDate()) + "/" + dosDigitos(d.getMonth() + 1);
  }

  function hora(ms) {
    const d = new Date(ms);
    return dosDigitos(d.getHours()) + ":" + dosDigitos(d.getMinutes());
  }

  const dniVisible = (c) => c.dniCargado || c.dni;

  const pesosCortos = (n) => "$" + Number(n).toLocaleString("es-AR");

  /** "Un pago $500.000", "3 × $200.000 con quita": corto, para que entre en una línea. */
  function resumenOpcion(o) {
    if (o.modalidad === "pago_unico") return (o.esPagoTotal ? "Pago total " : "Un pago ") + pesosCortos(o.montoTotal);
    const base = `${o.cuotas} × ${pesosCortos(o.valorCuota)}`;
    return o.modalidad === "quita_en_cuotas" ? base + " con quita" : base;
  }

  function lineaEnvio(envio) {
    const dia = etiquetaDia(envio.en);
    const cuando = (dia === "Hoy" ? "" : dia.toLowerCase() + " ") + hora(envio.en);
    return `<small class="caso-envio">Último envío ${cuando}: ${escapar(envio.texto)}</small>`;
  }

  function fila(c) {
    const nombre = c.nombre ? escapar(c.nombre) : "Sin nombre";
    const saldo = c.totalConInteres ? ` · $${escapar(c.totalConInteres)}` : "";
    return `<li class="caso-reciente">` +
      `<span><strong>${nombre}</strong> · DNI ${escapar(dniVisible(c))}${saldo} · <small>${hora(c.guardadoEn)}</small>` +
      `${c.ultimoEnvio ? lineaEnvio(c.ultimoEnvio) : ""}</span>` +
      `<span class="caso-reciente-acciones">` +
      `<button type="button" class="copiar-btn" data-accion="cargar" data-dni="${escapar(c.dni)}">Cargar</button> ` +
      `<button type="button" class="copiar-btn" data-accion="borrar" data-dni="${escapar(c.dni)}">Borrar</button>` +
      `</span></li>`;
  }

  /** La lista llega ordenada del más nuevo al más viejo: alcanza con cortar cuando cambia el día. */
  function htmlLista(todos, visibles) {
    if (!todos.length) return `<p class="nota-campo">Todavía no hay casos. Se guardan solos al calcular.</p>`;
    if (!visibles.length) return `<p class="nota-campo">No hay casos que coincidan con la búsqueda.</p>`;
    let diaActual = null;
    const items = visibles.map((c) => {
      const dia = etiquetaDia(c.guardadoEn);
      const cabecera = dia !== diaActual ? `<li class="casos-dia">${dia}</li>` : "";
      diaActual = dia;
      return cabecera + fila(c);
    });
    return `<ul class="lista-casos">${items.join("")}</ul>`;
  }

  /**
   * La estructura de cada bloque se arma una sola vez: si se volviera a escribir entera
   * en cada tecla, el buscador perdería el foco mientras el operador escribe.
   */
  function estructura() {
    return `<summary>Casos recientes (<span data-cr-total>0</span>)</summary>` +
      `<div class="casos-herramientas">` +
      `<input type="search" data-cr-buscar placeholder="Buscar por nombre o DNI" aria-label="Buscar casos recientes por nombre o DNI" autocomplete="off">` +
      `<button type="button" class="copiar-btn" data-accion="borrar-todos">Borrar todos</button>` +
      `</div>` +
      `<p class="nota-campo" data-cr-estado role="status"></p>` +
      `<div data-cr-lista></div>`;
  }

  function pintarBloque(contenedor, todos) {
    const texto = contenedor.querySelector("[data-cr-buscar]").value;
    contenedor.querySelector("[data-cr-total]").textContent = String(todos.length);
    contenedor.querySelector("[data-cr-lista]").innerHTML = htmlLista(todos, filtrar(todos, texto));
    const borrarTodos = contenedor.querySelector('button[data-accion="borrar-todos"]');
    delete borrarTodos.dataset.confirmar;
    borrarTodos.textContent = "Borrar todos";
  }

  const bloques = () => Array.from(doc.querySelectorAll("[data-casos-recientes]"));

  /** Pinta la misma lista en cada bloque (Quitas y Cuotas), cada uno con su propio filtro. */
  function render() {
    if (!casos || !doc) return;
    const todos = casos.listar();
    bloques().forEach((contenedor) => pintarBloque(contenedor, todos));
  }

  function avisar(texto) {
    bloques().forEach((contenedor) => { contenedor.querySelector("[data-cr-estado]").textContent = texto; });
  }

  /** Lo llama `recalcularNegociacion` con los datos que el operador acaba de calcular. */
  function guardarDesdeFormulario() {
    if (!casos || !doc) return;
    const caso = {};
    PARES.forEach(([campo, idQuitas]) => {
      caso[campo] = (doc.getElementById(idQuitas) || {}).value || "";
    });
    casos.guardar(caso);
    render();
  }

  function cargar(dni) {
    if (!casos || !doc) return;
    const caso = casos.listar().find((c) => c.dni === String(dni));
    if (!caso) {
      avisar("Ese caso ya no está: pasaron más de 48 horas o se borró.");
      render();
      return;
    }
    const hoy = isoLocal(reloj());
    PARES.forEach(([campo, idQuitas, idCuotas]) => {
      let valor = (campo === "dni" ? dniVisible(caso) : caso[campo]) || "";
      // Un vencimiento que ya pasó no se vuelve a ofrecer: vacío, el PDF usa el default de 48 h.
      if (campo === "fechaVencISO" && valor && valor < hoy) valor = "";
      [idQuitas, idCuotas].forEach((id) => {
        const el = doc.getElementById(id);
        if (el) el.value = valor;
      });
    });
    if (typeof window.recalcularNegociacion === "function") window.recalcularNegociacion();
    avisar(`Cargado: ${caso.nombre || "Sin nombre"} (DNI ${dniVisible(caso)})`);
  }

  /**
   * Lo llaman los botones que copian un mensaje (Cuotas, Quitas y el carrito) con las
   * opciones copiadas. El PDF no cuenta: a veces se genera solo para revisarlo.
   */
  function registrarEnvio(opciones) {
    if (!casos || !Array.isArray(opciones) || !opciones.length) return;
    if (casos.registrarEnvio(opciones[0].dni, opciones.map(resumenOpcion).join(" · "))) render();
  }

  function alHacerClic(evento) {
    const boton = evento.target && evento.target.closest ? evento.target.closest("button[data-accion]") : null;
    if (!boton) return;
    const accion = boton.dataset.accion;
    if (accion === "cargar") cargar(boton.dataset.dni);
    if (accion === "borrar") {
      casos.borrar(boton.dataset.dni);
      render();
    }
    if (accion === "borrar-todos") {
      // Sin confirm(): el mismo botón pide un segundo clic.
      if (boton.dataset.confirmar !== "1") {
        boton.dataset.confirmar = "1";
        boton.textContent = "¿Borrar todos? Tocá de nuevo";
        // Si no confirma enseguida, el botón vuelve a su estado: un clic suelto más tarde no borra.
        if (typeof setTimeout === "function") {
          setTimeout(() => {
            delete boton.dataset.confirmar;
            boton.textContent = "Borrar todos";
          }, 5000);
        }
        return;
      }
      casos.borrarTodos();
      avisar("Se borraron todos los casos recientes.");
      render();
    }
  }

  function iniciar(opciones) {
    casos = crear(opciones);
    reloj = opciones.ahora;
    doc = opciones.document;
    bloques().forEach((contenedor) => {
      contenedor.innerHTML = estructura();
      contenedor.addEventListener("click", alHacerClic);
      contenedor.addEventListener("input", (evento) => {
        if (evento.target === contenedor.querySelector("[data-cr-buscar]")) pintarBloque(contenedor, casos.listar());
      });
    });
    render();
  }

  /**
   * En el navegador arranca solo. Si el storage está bloqueado (modo privado estricto),
   * se usa uno en memoria: la lista dura lo que dura la pestaña y nada se rompe.
   */
  function storageDelNavegador() {
    try {
      const s = window.localStorage;
      s.getItem(CLAVE);
      return s;
    } catch (e) {
      const memoria = new Map();
      return {
        getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
        setItem: (k, v) => memoria.set(k, String(v)),
        removeItem: (k) => memoria.delete(k),
      };
    }
  }

  if (typeof window.document !== "undefined" && window.document.querySelectorAll) {
    iniciar({ storage: storageDelNavegador(), ahora: () => Date.now(), document: window.document });
  }

  return { crear, VIGENCIA_MS, MAX_CASOS, CLAVE, PARES, filtrar, iniciar, render, guardarDesdeFormulario, cargar, registrarEnvio };
})();
