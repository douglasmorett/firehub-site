/*
 * Rede de segurança do Modo Contingência (components/contingencia/TrocaDeContingencia.tsx).
 *
 * Só existe nas lojas com a contingência ATIVADA. No painel cobre o site
 * inteiro ("/": o dono que abre a página inicial ou o login sem internet também
 * chega na loja — 14/10/2026); no garçom, o /garcom. Só olha NAVEGAÇÃO (abrir
 * uma página); arquivo, API e imagem passam direto, sem passar por aqui.
 *
 * Se abrir uma página do FireHub falhar (sem internet, ou o nosso servidor
 * fora: 502/503/504), em vez da tela de erro do navegador vem uma página
 * mínima que leva ao computador da loja com o bilhete guardado — assim até a
 * TV ligada já sem internet chega na contingência, se já abriu o FireHub antes.
 *
 * SEM GATILHO NA PRIMEIRA FALHA (14/10/2026, noite, Hakim Centro): um 502 só
 * do Cloudflare no pico, num F5 ou no "ABRIR TELA" do KDS, mandava a TV na
 * hora para o computador da loja — e ela ficava presa lá. Agora:
 *   - a navegação é tentada de novo, com prazo (o primeiro de 4 s, depois
 *     maior, para não matar uma página que só está lenta), até completar
 *     QUEDA_MS de falha — o mesmo QUEDA_ANTES_DE_PULAR_MS de
 *     lib/contingencia/troca.ts (o teste confere);
 *   - aparelho sem rede (navigator.onLine false) não espera nem pula: a
 *     página só avisa e tenta de novo;
 *   - a página mínima também exige a queda sustentada (o sinal da nuvem
 *     falhando), não pula logo depois de uma volta do computador da loja
 *     (espera crescente, "firehub_contingencia_voltou") e, no computador do
 *     caixa, nunca usa o IP da rede ("firehub_contingencia_sou_o_pc").
 * A regra é a mesma de destinoDaTroca (lib/contingencia/troca.ts): mudou lá,
 * muda aqui.
 */
const QUEDA_MS = 45000;

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>FireHub — sem conexão</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;text-align:center;padding:24px">
<div><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg><h1 style="font-size:20px;margin:8px 0">Sem conexão com o FireHub</h1>
<p id="m" style="color:#cbd5e1;margin:0">Tentando de novo…</p></div>
<script>
(function () {
  var QUEDA_MS = __QUEDA_MS__;
  var quedaDesde = __QUEDA_DESDE__;
  var ESPERAS = [60000, 180000, 600000];
  var m = document.getElementById("m");
  function ler(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function gravar(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  var g = null;
  try { g = JSON.parse(ler("firehub_contingencia") || "null"); } catch (e) {}
  var pc = ler("firehub_contingencia_pc");
  // A página inicial e o login não existem para a loja na contingência: o painel sim.
  // Sem regex aqui: este script mora numa string entre crases, que engole as barras invertidas.
  var p = location.pathname;
  var volta = p.indexOf("/store") === 0 || p.indexOf("/garcom") === 0 ? p + location.search : "/store";
  // Sem para onde ir: fica aqui e tenta a nuvem de novo — quando ela voltar,
  // a página de verdade abre sozinha (nunca presa num erro).
  function depois(texto, ms) {
    m.textContent = texto;
    setTimeout(function () { location.reload(); }, ms || 15000);
  }
  function semRede() { return navigator.onLine === false; }
  function voltaGuardada() {
    try {
      var v = JSON.parse(ler("firehub_contingencia_voltou") || "null");
      if (v && Number(v.em) > 0) return { em: Number(v.em), n: Math.max(1, Math.floor(Number(v.n)) || 1) };
    } catch (e) {}
    return null;
  }
  function esperaDaVolta() {
    var v = voltaGuardada();
    if (!v) return 0;
    return Math.max(0, ESPERAS[Math.min(v.n, ESPERAS.length) - 1] - Math.max(0, Date.now() - v.em));
  }
  // O som e a posição do KDS só existem nesta origem: vão junto (app/contingencia/entrar grava lá).
  function preferencias() {
    var o = {}, n = 0;
    try {
      for (var i = 0; i < localStorage.length && n < 30; i++) {
        var k = localStorage.key(i);
        if (k !== "kds-som" && !(k && k.indexOf("kds-rotacao:") === 0)) continue;
        var v = localStorage.getItem(k);
        if (v === "0" || v === "1" || v === "90" || v === "270") { o[k] = v; n++; }
      }
    } catch (e) {}
    return n ? JSON.stringify(o) : "";
  }
  function ir(base) {
    var v = voltaGuardada();
    var f = "bilhete=" + encodeURIComponent(g.bilhete) + "&volta=" + encodeURIComponent(volta) +
      "&n=" + ((v ? v.n : 0) + 1) + "&origem=" + encodeURIComponent(location.origin);
    var pr = preferencias();
    if (pr) f += "&p=" + encodeURIComponent(pr);
    location.replace(base + "/contingencia/entrar#" + f);
  }
  function comPrazo(url, ms, opcoes) {
    var c = typeof AbortController === "function" ? new AbortController() : null;
    var o = opcoes || {};
    o.cache = "no-store";
    if (c) o.signal = c.signal;
    var t = setTimeout(function () { if (c) c.abort(); }, ms);
    return fetch(url, o).then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
  }
  // O Assistente deste computador, com a escada de lib/print.ts (fetchAssistente):
  // o Chrome novo pede o espaço de endereço; o que não conhece o nome, tenta o próximo.
  function aoAssistente(url) {
    var espacos = ["loopback", "local", ""], i = 0;
    function tentar() {
      var e = espacos[i++];
      var o = {};
      if (e) o.targetAddressSpace = e;
      return comPrazo(url, 1500, o).catch(function (err) {
        var msg = String((err && err.message) || "").toLowerCase();
        if (e && err instanceof TypeError && (msg.indexOf("targetaddressspace") >= 0 || msg.indexOf("address space") >= 0 || msg.indexOf("enum") >= 0)) return tentar();
        throw err;
      });
    }
    return tentar();
  }
  if (!g || !g.bilhete || new Date(g.validoAte).getTime() < Date.now()) {
    depois("Este aparelho não tem a contingência guardada. Tentando de novo…");
    return;
  }

  // Outro aparelho (TV, garçom, outro PC): a mesma regra de destinoDaTroca.
  function outroAparelho() {
    if (ler("firehub_contingencia_sou_o_pc")) return depois("O Assistente deste computador não respondeu. Tentando de novo…");
    if (semRede()) return depois("Este aparelho está sem rede. Confira o Wi-Fi: quando voltar, o FireHub abre sozinho.");
    if (esperaDaVolta() > 0) return depois("A conexão voltou há pouco. Tentando o FireHub de novo antes de ir ao computador da loja…");
    if (pc === "0") return depois("O computador da loja também não responde. Tentando de novo…");
    if (g.enderecos && g.enderecos[0]) return ir(g.enderecos[0]);
    depois("Endereço do computador da loja desconhecido. Tentando de novo…");
  }

  // No computador do caixa, o Assistente sabe se o FireHub local está pronto.
  var portas = [7899, 7900, 7901, 7891], i = 0;
  function proximo() {
    if (i >= portas.length) return outroAparelho();
    var porta = portas[i++];
    aoAssistente("http://127.0.0.1:" + porta + "/contingencia/estado")
      .then(function (r) { return r.json(); })
      .then(function (e) {
        if (!e || !e.ativa) {
          if (e && e.ativa === false) gravar("firehub_contingencia_sou_o_pc", null);
          return proximo();
        }
        gravar("firehub_contingencia_sou_o_pc", String(porta));
        if (!(e.pronta && e.porta)) return depois("O computador da loja está preparando a contingência…");
        var declarada = e.testando || e.modo === "contingencia" || e.modo === "voltando";
        if (!declarada && esperaDaVolta() > 0) return depois("A conexão voltou há pouco. Tentando o FireHub de novo…");
        ir("http://127.0.0.1:" + e.porta);
      })
      .catch(proximo);
  }

  // Só decide depois de QUEDA_MS de queda seguida: até lá, confere a nuvem a
  // cada 5 s — respondeu, abre a página de verdade.
  function conferir() {
    comPrazo("/api/contingencia/sinal", 4000)
      .then(function (r) { return r.ok; }, function () { return false; })
      .then(function (ok) {
        if (ok) {
          m.textContent = "A conexão voltou. Abrindo o FireHub…";
          return location.replace(location.href);
        }
        if (Date.now() - quedaDesde < QUEDA_MS) {
          m.textContent = semRede() ? "Este aparelho está sem rede. Confira o Wi-Fi…" : "Tentando de novo…";
          return setTimeout(conferir, 5000);
        }
        m.textContent = "Procurando o computador da loja…";
        proximo();
      });
  }
  conferir();
})();
</script></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const fora = (r) => r.status === 502 || r.status === 503 || r.status === 504;
const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
const semRede = () => !!self.navigator && self.navigator.onLine === false;

function paginaDeTroca(desde) {
  const html = PAGINA.replace("__QUEDA_MS__", String(QUEDA_MS)).replace("__QUEDA_DESDE__", String(desde));
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

/** Uma tentativa com prazo (até a resposta chegar; o corpo segue sem prazo). */
async function tentar(pedido, ms) {
  let req = pedido;
  let c = null;
  try {
    // Navegador antigo que não deixa copiar o pedido de navegação: vai sem prazo.
    c = new AbortController();
    req = new Request(pedido, { signal: c.signal });
  } catch {
    req = pedido;
    c = null;
  }
  const t = c ? setTimeout(() => c.abort(), ms) : null;
  try {
    return await fetch(req);
  } finally {
    if (t) clearTimeout(t);
  }
}

async function navegar(pedido) {
  const inicio = Date.now();
  // Formulário (POST): o corpo só vai uma vez — não dá para repetir. A página
  // de troca exige a queda sustentada sozinha.
  if (pedido.method !== "GET") {
    try {
      const r = await fetch(pedido);
      if (!fora(r)) return r;
    } catch {
      /* cai na página de troca */
    }
    return paginaDeTroca(inicio);
  }
  let prazo = 4000;
  for (;;) {
    try {
      const r = await tentar(pedido, prazo);
      if (!fora(r)) return r;
    } catch {
      /* sem resposta no prazo, ou sem rede: tenta de novo */
    }
    // Sem rede no aparelho, esperar não adianta: a página avisa e não pula.
    if (semRede()) break;
    const passou = Date.now() - inicio;
    if (passou >= QUEDA_MS) break;
    await pausa(Math.min(2000, QUEDA_MS - passou));
    // Prazo crescente (4, 8, 12… s): a página lenta do pico também abre.
    prazo = Math.max(4000, Math.min(prazo + 4000, QUEDA_MS - (Date.now() - inicio)));
  }
  return paginaDeTroca(inicio);
}

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(navegar(event.request));
});
