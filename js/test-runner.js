/** Arnés mínimo de tests. Sin dependencias: se abre tests.html en el navegador. */
(function () {
  const resultados = [];

  window.test = function (nombre, fn) {
    try {
      fn();
      resultados.push({ nombre, ok: true });
    } catch (e) {
      resultados.push({ nombre, ok: false, error: e.message });
    }
  };

  window.assertEq = function (actual, esperado, msg) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(esperado);
    if (a !== e) {
      throw new Error(`${msg ? msg + ": " : ""}esperaba ${e}, recibió ${a}`);
    }
  };

  window.assertIncluye = function (texto, fragmento, msg) {
    if (typeof texto !== "string" || texto.indexOf(fragmento) === -1) {
      throw new Error(`${msg ? msg + ": " : ""}el texto no contiene "${fragmento}"`);
    }
  };

  window.assertNoIncluye = function (texto, fragmento, msg) {
    if (typeof texto === "string" && texto.indexOf(fragmento) !== -1) {
      throw new Error(`${msg ? msg + ": " : ""}el texto NO debería contener "${fragmento}"`);
    }
  };

  window.mostrarResultados = function () {
    const cont = document.getElementById("resultados");
    const fallados = resultados.filter((r) => !r.ok);
    const resumen = document.getElementById("resumen");

    resumen.textContent = `${resultados.length - fallados.length} / ${resultados.length} pasaron`;
    resumen.className = fallados.length === 0 ? "ok" : "fail";

    cont.innerHTML = resultados
      .map((r) =>
        r.ok
          ? `<div class="t ok">✓ ${r.nombre}</div>`
          : `<div class="t fail">✗ ${r.nombre}<br><small>${r.error}</small></div>`
      )
      .join("");
  };
})();
