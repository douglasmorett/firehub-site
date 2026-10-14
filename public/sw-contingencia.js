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
 */
const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>FireHub — sem conexão</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;text-align:center;padding:24px">
<div><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg><h1 style="font-size:20px;margin:8px 0">Sem conexão com o FireHub</h1>
<p id="m" style="color:#cbd5e1;margin:0">Procurando o computador da loja…</p></div>
<script>
(function () {
  var m = document.getElementById("m");
  var g = null, pc = null;
  try { g = JSON.parse(localStorage.getItem("firehub_contingencia") || "null"); } catch (e) {}
  try { pc = localStorage.getItem("firehub_contingencia_pc"); } catch (e) {}
  // A página inicial e o login não existem para a loja na contingência: o painel sim.
  // Sem regex aqui: este script mora numa string entre crases, que engole as barras invertidas.
  var p = location.pathname;
  var volta = p.indexOf("/store") === 0 || p.indexOf("/garcom") === 0 ? p + location.search : "/store";
  // Sem para onde ir: fica aqui e tenta a nuvem de novo a cada 15 s — quando
  // ela voltar, a página de verdade abre sozinha (nunca presa num erro).
  function depois(texto) {
    m.textContent = texto;
    setTimeout(function () { location.reload(); }, 15000);
  }
  function ir(base) {
    var f = "bilhete=" + encodeURIComponent(g.bilhete) + "&volta=" + encodeURIComponent(volta);
    location.replace(base + "/contingencia/entrar#" + f);
  }
  if (!g || !g.bilhete || new Date(g.validoAte).getTime() < Date.now()) {
    depois("Este aparelho não tem a contingência guardada. Tentando de novo…");
    return;
  }
  // No computador do caixa, o Assistente sabe se o FireHub local está pronto.
  // Nos outros aparelhos, vai só se o computador da loja estava vivo no último
  // sinal da nuvem (TrocaDeContingencia guarda): desligado, a tela cairia num
  // erro do navegador e ficaria lá.
  var portas = [7899, 7900, 7901, 7891], i = 0;
  function proximo() {
    if (i >= portas.length) {
      if (pc === "0") return depois("O computador da loja também não responde. Tentando de novo…");
      if (g.enderecos && g.enderecos[0]) return ir(g.enderecos[0]);
      return depois("Endereço do computador da loja desconhecido. Tentando de novo…");
    }
    var porta = portas[i++];
    fetch("http://127.0.0.1:" + porta + "/contingencia/estado", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (e) {
        if (!e || !e.ativa) return proximo();
        if (e.pronta && e.porta) return ir("http://127.0.0.1:" + e.porta);
        depois("O computador da loja está preparando a contingência…");
      })
      .catch(proximo);
  }
  proximo();
})();
</script></body></html>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    (async () => {
      try {
        const r = await fetch(event.request);
        if (r.status === 502 || r.status === 503 || r.status === 504) throw new Error("servidor fora");
        return r;
      } catch {
        return new Response(PAGINA, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      }
    })(),
  );
});
