// Peças do vídeo de demonstração da Balança (roteiros/balanca-no-salao.mjs).
//
// 1. `balancaToledoDeTeste` — uma Prix 3 Fit de mentira NO NAVEGADOR, atrás da
//    Web Serial (navigator.serial). Diferente do ?simular=1 da tela, ela fala
//    o protocolo em BYTES: recebe o ENQ, responde STX + 5 dígitos + ETX,
//    entrega a resposta picada em dois pedaços (como uma porta serial faz),
//    responde lixo na velocidade errada (a tela tem que descobrir a certa) e
//    passa por "IIIII" e por pesos mexendo antes de firmar. Assim a tela de
//    VERDADE (sem o modo de teste) roda inteira: leitor serial, peso firme,
//    cartão, rota /api/store/balanca/pesar e banco.
//
// 2. `desenharSalao` — o lado esquerdo do vídeo: a balança, o prato, o leitor
//    de mesa e o cartão, desenhados. O visor da balança mostra o mesmo peso que
//    a balança de teste está mandando. A tela do FireHub fica à direita.
//
// Só entra na página /store/balanca/pesar.

export function balancaToledoDeTeste({ velocidade }) {
  if (!location.pathname.startsWith("/store/balanca/pesar")) return;
  const ENQ = 5, STX = 2, ETX = 3;
  const estado = { atual: 0, fila: [], enqs: 0, velocidadesTentadas: [] };
  const quadro = (v) => {
    const t = v === "I" ? "IIIII" : v === "N" ? "NNNNN" : v === "S" ? "SSSSS" : String(Math.round(v * 1000)).padStart(5, "0");
    return [STX, ...Array.from(t, (c) => c.charCodeAt(0)), ETX];
  };
  let timers = [];
  const agendar = (seq) => {
    timers.forEach(clearTimeout);
    timers = [];
    let t = 0;
    for (const [ms, v] of seq) { t += ms; timers.push(setTimeout(() => { estado.atual = v; window.__salao?.visor(v); }, t)); }
  };
  window.__balanca = {
    estado,
    /** Prato na balança: mexe um pouco e firma no peso. */
    pesar(kg) {
      agendar([[0, "I"], [250, Math.round(kg * 0.62 * 1000) / 1000], [300, "I"], [300, Math.round((kg + 0.009) * 1000) / 1000], [300, kg]]);
    },
    tirar() { agendar([[0, "I"], [250, 0]]); },
    /** Valor cru, na hora: número (kg), "I" (mexendo), "N" (negativo), "S" (sobrecarga). */
    bruto(v) { agendar([[0, v]]); },
    /** Cabo puxado: a balança para de responder. */
    mudar(mudo) { estado.mudo = mudo; },
  };
  class Porta {
    async open({ baudRate }) {
      estado.velocidadesTentadas.push(baudRate);
      this.baud = baudRate;
      let ctl;
      this.readable = new ReadableStream({ start: (c) => { ctl = c; } });
      this.ctl = () => ctl;
      this.writable = new WritableStream({
        write: (bytes) => {
          if (!bytes.includes(ENQ) || estado.mudo) return;
          estado.enqs++;
          setTimeout(() => {
            const c = this.ctl?.();
            if (!c) return;
            try {
              if (this.baud !== velocidade) { c.enqueue(new Uint8Array([0xff, 0x7e, 0x13, 0x80, 0xf0, 0x0f])); return; }
              const q = quadro(estado.atual);
              c.enqueue(new Uint8Array(q.slice(0, 3)));
              setTimeout(() => { try { c.enqueue(new Uint8Array(q.slice(3))); } catch {} }, 6);
            } catch {}
          }, 20);
        },
      });
    }
    async close() { try { this.ctl?.()?.close(); } catch {} this.ctl = null; this.readable = null; this.writable = null; }
    getInfo() { return { usbVendorId: 0x0403, usbProductId: 0x6001 }; }
  }
  const porta = new Porta();
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { getPorts: async () => [porta], requestPort: async () => porta, addEventListener() {}, removeEventListener() {} },
  });
}

export function desenharSalao() {
  if (!location.pathname.startsWith("/store/balanca/pesar")) return;
  const LARG = 560;
  const montar = () => {
    if (document.getElementById("salao")) return;
    const estilo = document.createElement("style");
    estilo.textContent = `
      div[style*="2147483000"]{left:${LARG}px !important;border-left:6px solid #0B1220}
      #salao{position:fixed;left:0;top:0;bottom:0;width:${LARG}px;z-index:2147483001;background:linear-gradient(#FBF7F0,#F3EADB);
        font-family:system-ui,'Segoe UI',sans-serif;color:#1F2937;overflow:hidden}
      #salao .topo{position:absolute;left:28px;right:28px;top:22px}
      #salao .rotulo{font-size:13px;font-weight:800;letter-spacing:.12em;color:#B45309;text-transform:uppercase}
      #salao .passo{font-size:27px;font-weight:900;line-height:1.15;margin-top:6px;min-height:64px;transition:opacity .25s}
      #salao svg{position:absolute;left:0;top:130px;width:${LARG}px;height:600px}
      #salao .prato{transition:transform .7s cubic-bezier(.3,1.3,.5,1),opacity .4s}
      #salao .cartao{transition:transform .9s cubic-bezier(.4,.1,.2,1),opacity .4s}
      #salao .luz{transition:fill .15s}
      #salao .bip{transition:opacity .2s}
      #salao .rodape{position:absolute;left:28px;right:28px;bottom:18px;font-size:13px;color:#6B7280}
      #tutorial-cursor{display:none !important}
    `;
    document.head.appendChild(estilo);
    const el = document.createElement("div");
    el.id = "salao";
    el.innerHTML = `
      <div class="topo"><div class="rotulo">No salão</div><div class="passo" id="salao-passo"></div></div>
      <svg viewBox="0 0 560 600">
        <!-- balcão -->
        <rect x="0" y="430" width="560" height="26" fill="#8B5E3C"/>
        <rect x="0" y="456" width="560" height="150" fill="#A47148"/>
        <!-- cabo da balança até a tela (à direita) -->
        <path d="M150 428 C150 500, 420 470, 560 500" fill="none" stroke="#374151" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 0"/>
        <text x="330" y="520" font-size="14" font-weight="700" fill="#FFF7ED">cabo da balança → computador</text>
        <!-- balança -->
        <rect x="40" y="380" width="240" height="50" rx="10" fill="#9CA3AF"/>
        <rect x="30" y="362" width="260" height="22" rx="6" fill="#E5E7EB" stroke="#9CA3AF" stroke-width="2"/>
        <rect x="236" y="250" width="16" height="132" fill="#6B7280"/>
        <rect x="186" y="200" width="116" height="62" rx="10" fill="#374151"/>
        <rect x="196" y="211" width="96" height="34" rx="5" fill="#0B1F0E"/>
        <text id="salao-visor" x="285" y="236" text-anchor="end" font-family="Consolas,monospace" font-size="22" font-weight="700" fill="#4ADE80">0,000</text>
        <text x="244" y="257" text-anchor="middle" font-size="9" fill="#D1D5DB">kg</text>
        <!-- prato -->
        <g class="prato" id="salao-prato" style="transform:translateY(-260px);opacity:0">
          <ellipse cx="160" cy="350" rx="98" ry="22" fill="#F9FAFB" stroke="#D1D5DB" stroke-width="3"/>
          <ellipse cx="160" cy="346" rx="72" ry="14" fill="#FFFFFF"/>
          <ellipse cx="128" cy="340" rx="30" ry="11" fill="#FEF3C7"/>
          <ellipse cx="170" cy="338" rx="26" ry="10" fill="#7C2D12"/>
          <ellipse cx="196" cy="344" rx="18" ry="8" fill="#16A34A"/>
          <ellipse cx="150" cy="333" rx="16" ry="7" fill="#B45309"/>
        </g>
        <!-- leitor de mesa (lê o cartão encostado, sem botão) -->
        <rect x="380" y="400" width="110" height="30" rx="8" fill="#1F2937"/>
        <path d="M398 400 L408 300 L470 300 L478 400 Z" fill="#111827"/>
        <rect class="luz" id="salao-luz" x="414" y="316" width="50" height="40" rx="6" fill="#7F1D1D"/>
        <text x="435" y="392" text-anchor="middle" font-size="11" fill="#9CA3AF">leitor</text>
        <g class="bip" id="salao-bip" style="opacity:0">
          <text x="500" y="300" font-size="22" font-weight="900" fill="#16A34A">bip!</text>
        </g>
        <!-- cartão da comanda -->
        <g class="cartao" id="salao-cartao" style="opacity:0;transform:translate(0px,0px)">
          <rect x="330" y="80" width="150" height="96" rx="10" fill="#FFFFFF" stroke="#0F766E" stroke-width="3"/>
          <text x="345" y="104" font-size="11" font-weight="800" fill="#0F766E">COMANDA</text>
          <text x="345" y="140" font-size="34" font-weight="900" fill="#111827">101</text>
          <g fill="#111827" id="salao-barras"></g>
        </g>
      </svg>
      <div class="rodape">Ilustração do balcão. À direita, a tela do FireHub funcionando de verdade.</div>`;
    document.body.appendChild(el);
    // código de barras do cartão (ilustrativo)
    const g = el.querySelector("#salao-barras");
    let x = 345;
    for (const w of [2,1,1,3,1,2,1,1,3,2,1,1,2,3,1,1,2,1,3,1,1,2,1,1,3,2,1,2]) {
      const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      r.setAttribute("x", x); r.setAttribute("y", 148); r.setAttribute("width", w); r.setAttribute("height", 20);
      if ((x - 345) % 2 === 0 || w > 1) g.appendChild(r);
      x += w + 1.4;
    }
  };
  const $ = (id) => document.getElementById(id);
  window.__salao = {
    passo(texto) { const p = $("salao-passo"); if (p) p.textContent = texto; },
    visor(v) {
      const t = $("salao-visor");
      if (!t) return;
      t.textContent = v === "I" ? "- - -" : Number(v).toFixed(3).replace(".", ",");
    },
    prato(naBalanca) {
      const p = $("salao-prato");
      if (!p) return;
      p.style.opacity = naBalanca ? "1" : "0";
      p.style.transform = naBalanca ? "translateY(0px)" : "translateY(-260px)";
    },
    cartao(onde) {
      const c = $("salao-cartao");
      if (!c) return;
      if (onde === "fora") { c.style.opacity = "0"; c.style.transform = "translate(0px,0px)"; return; }
      c.style.opacity = "1";
      c.style.transform = onde === "leitor" ? "translate(-36px,150px) rotate(-8deg)" : "translate(0px,0px)";
    },
    bip() {
      const l = $("salao-luz"), b = $("salao-bip");
      if (l) l.style.fill = "#22C55E";
      if (b) b.style.opacity = "1";
      setTimeout(() => { if (l) l.style.fill = "#7F1D1D"; if (b) b.style.opacity = "0"; }, 900);
    },
  };
  if (document.body) montar(); else document.addEventListener("DOMContentLoaded", montar);
}
