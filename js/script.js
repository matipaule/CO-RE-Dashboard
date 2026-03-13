/** 1. NAVEGACIÓN Y MENÚ **/
document.getElementById("menuToggle").addEventListener("click", () => {
    document.getElementById("menuNav").classList.toggle("active");
});

const enlacesMenu = document.querySelectorAll('nav ul li a');
enlacesMenu.forEach(enlace => {
    enlace.addEventListener('click', (e) => {
        e.preventDefault();
        const target = enlace.dataset.seccion;
        activarSeccion(target);
        document.getElementById("menuNav").classList.remove("active");
    });
});

function activarSeccion(id) {
    enlacesMenu.forEach(a => {
        a.classList.remove('active');
        if(a.dataset.seccion === id) a.classList.add('active');
    });
    
    document.querySelectorAll('main section').forEach(sec => {
        sec.className = sec.id === id ? 'pagina-activa card' : 'pagina-oculta card';
    });
}

function navegarA(seccionId) {
    activarSeccion(seccionId);
}

window.onload = () => {
    activarSeccion('inicio');
};

/** 2. FORMATEO Y ALERTAS DE INPUT **/
document.getElementById("saldoInput").addEventListener("input", function(e) {
    const v = e.target.value;
    const alerta = document.getElementById("alertaFormato");
    if (v.includes('.') && !v.includes(',') && v.split('.').pop().length <= 2) {
        alerta.innerText = "⚠ ¿Usaste punto para decimales? Recordá usar la coma (,)";
    } else {
        alerta.innerText = "";
    }
});

document.querySelectorAll('input').forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const section = input.closest('section').id;
            if (section === 'cuotas') calcularCuotas();
            if (section === 'quitas') generarEscalaQuitas();
        }
    });
});

/** 3. CALCULADORA DE CUOTAS (VERSIÓN ULTRA-LIMPIA) **/
function obtenerMaxCuotas(saldo) {
    if (saldo <= 1000000) return 12;
    if (saldo <= 6000000) return 15;
    if (saldo <= 20000000) return 18;
    return 36;
}

function calcularCuotas() {
    const inputVal = document.getElementById("saldoInput").value;
    if (!inputVal) return;

    let corregido = inputVal;
    if(inputVal.includes('.') && !inputVal.includes(',')) {
        if(inputVal.split('.').pop().length <= 2) corregido = inputVal.replace('.', ',');
    }

    const limpio = corregido.replace(/\./g, "").replace(",", ".");
    const saldo = parseFloat(limpio);

    if (isNaN(saldo) || saldo <= 0) {
        alert("Ingrese un monto válido.");
        return;
    }

    const redondeado = Math.ceil(saldo);
    document.getElementById("saldoRedondeado").innerHTML = `Base: <strong>$${redondeado.toLocaleString("es-AR")}</strong>`;

    const tablaBody = document.querySelector("#tablaCuotas tbody");
    tablaBody.innerHTML = "";

    const max = obtenerMaxCuotas(redondeado);
    let hayPlanes = false;

    for (let i = 2; i <= max; i++) {
        const valor = Math.ceil(redondeado / i);
        
        // REGLA: No mostrar cuotas menores a $50.000
        if (valor < 50000) continue; 

        hayPlanes = true;
        const fila = document.createElement("tr");

        // Eliminamos la columna de "Estado" / "Disponible"
        fila.innerHTML = `
            <td>Plan ${i} cuotas</td>
            <td class="monto-cuota"><strong>$${valor.toLocaleString("es-AR")}</strong></td>
            <td><button class="copiar-btn" onclick="copiarPlan(${i}, ${valor}, this)">Copiar</button></td>
        `;
        tablaBody.appendChild(fila);
    }

    if (!hayPlanes) {
        tablaBody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:20px;">Saldo insuficiente para financiar (Cuotas < $50.000). Se sugiere Pago Único.</td></tr>`;
    }
}

function copiarPlan(c, v, btn) {
    const txt = `Propuesta de pago: saldo en ${c} cuotas fijas de $${v.toLocaleString("es-AR")}.`;
    navigator.clipboard.writeText(txt).then(() => {
        const original = btn.innerText;
        btn.innerText = "¡Copiado!";
        setTimeout(() => btn.innerText = original, 1200);
    });
}

/** 4. CAMPAÑA DE QUITAS **/
function generarEscalaQuitas() {
    const capInput = document.getElementById("capitalInput").value;
    const totalInput = document.getElementById("totalConInteresInput").value;
    const moraInput = document.getElementById("moraInput").value;
    
    if (!capInput || !totalInput || !moraInput) return alert("Faltan datos (Capital, Total o Mora)");

    const capital = parseFloat(capInput.replace(/\./g, "").replace(",", "."));
    const diasMora = parseInt(moraInput);

    let limiteUala = 0;
    if (diasMora >= 180) limiteUala = 50;
    else if (diasMora >= 150) limiteUala = 40;
    else if (diasMora >= 120) limiteUala = 30;
    else if (diasMora >= 90) limiteUala = 20;

    const tablaBody = document.querySelector("#tablaQuitas tbody");
    tablaBody.innerHTML = "";
    
    const escalones = [10, 20, 30, 40, 50];
    let opcionesMostradas = 0;

    escalones.forEach(porc => {
        if (porc <= limiteUala || (porc === 10 && limiteUala === 0)) {
            opcionesMostradas++;
            const montoFinal = Math.ceil(capital * (1 - porc/100));
            const fila = document.createElement("tr");
            
            fila.innerHTML = `
                <td>Política de Quita</td>
                <td>${porc}%</td>
                <td><strong>$${montoFinal.toLocaleString("es-AR")}</strong></td>
                <td><button class="copiar-btn" onclick="copiarChatQuita(${montoFinal}, ${porc}, this)">Copiar</button></td>
            `;
            tablaBody.appendChild(fila);
        }
    });

    if (opcionesMostradas === 0) {
        tablaBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:20px;">Solo quita de intereses. Pago único sugerido: $${capital.toLocaleString("es-AR")}</td></tr>`;
    }

    document.getElementById("infoEscala").innerHTML = `<p>Escala autorizada para ${diasMora} días de mora.</p>`;
    document.getElementById("contenedorSalto").style.display = "block";
}

function copiarChatQuita(monto, porc, btn) {
    const datosPago = "\n\nCBU: 3840100200000004686158\nALIAS: UALEOMICUOTA\nRAZÓN SOCIAL: ALAU TECNOLOGÍA S.A.U";
    const mensaje = `Hola, logré gestionarle un beneficio del ${porc}% de quita sobre el capital. El monto final para cancelar hoy es de $${monto.toLocaleString("es-AR")}. ¿Le interesa aprovecharlo? ${datosPago}`;
    
    navigator.clipboard.writeText(mensaje).then(() => {
        const original = btn.innerText;
        btn.innerText = "¡Copiado!";
        setTimeout(() => btn.innerText = original, 1000);
    });
}

function saltarACuotas() {
    const totalCargado = document.getElementById("totalConInteresInput").value;
    if (!totalCargado) {
        alert("Por favor, cargue el Saldo Total antes de refinanciar.");
        return;
    }
    document.getElementById("saldoInput").value = totalCargado;
    activarSeccion('cuotas');
    calcularCuotas();
}

/** 5. DATOS DE PAGO **/
function copiarTodoPago() {
    const info = `RAZÓN SOCIAL: ALAU TECNOLOGIA S.A.U.\nCUIT: 30-71542170-0\nCBU: 3840100200000004686158\nALIAS: UALEOMICUOTA`;
    navigator.clipboard.writeText(info).then(() => {
        alert("¡Todos los datos de pago copiados!");
    });
}