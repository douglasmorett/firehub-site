/**
 * PORTA DA LOJA — o endereço que a TV, o celular do garçom e o navegador do
 * computador abrem durante a contingência (http://<ip-do-computador>:7890).
 *
 * Quem decide o que fazer com cada pedido é o supervisor (index.ts), pelo
 * modo em que está:
 *   - em contingência: repassa ao FireHub local (127.0.0.1:7895);
 *   - com a nuvem de pé: manda a tela de volta para a nuvem — o computador da
 *     loja só atende quando a nuvem não atende, nunca ao mesmo tempo (assim a
 *     loja não grava em dois lugares).
 *
 * No repasse, conserta o que só faz sentido na nuvem:
 *   - o `Content-Security-Policy` do next.config tem `upgrade-insecure-requests`.
 *     Na rede da loja não existe https, e o navegador trocava cada arquivo da
 *     página por https://<ip>:7890 — tela em branco, com 18 erros de SSL
 *     (medido na prova de 12/10/2026). O cabeçalho é gravado no build, não
 *     muda em tempo de execução; por isso o conserto mora aqui;
 *   - `Strict-Transport-Security`: sem sentido em http.
 */
import http from "node:http";
import { enderecoDeVolta, esperaDoAparelho, linhaDoPedido, origemDaVolta, proximaContagem, voltaSegura } from "./regras";

export type DecisaoDaPorta =
  | { tipo: "repassar" }
  | { tipo: "redirecionar"; para: string }
  | { tipo: "esperar" }
  | { tipo: "pagina"; status: number; html: string }
  | { tipo: "responder"; status: number; corpo: unknown; cabecalhos?: Record<string, string> };

export type OpcoesDaPorta = {
  /** Onde a porta escuta. 0.0.0.0 = a rede da loja inteira. */
  host: string;
  porta: number;
  /** O FireHub local. */
  destino: { host: string; porta: number };
  decidir: (req: http.IncomingMessage) => DecisaoDaPorta;
  /** Uma linha por pedido de página (sem o fragmento nem a consulta): sem isso, o próximo incidente não se prova. */
  registro?: (linha: string) => void;
};

/** Tira `upgrade-insecure-requests` de uma política de segurança. */
export function semUpgradeParaHttps(politica: string): string {
  return politica
    .split(";")
    .map((p) => p.trim())
    .filter((p) => p && p.toLowerCase() !== "upgrade-insecure-requests")
    .join("; ");
}

/** Os cabeçalhos da resposta, consertados para a rede da loja. */
export function cabecalhosParaALoja(cabecalhos: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const saida: http.OutgoingHttpHeaders = {};
  for (const [nome, valor] of Object.entries(cabecalhos)) {
    if (valor === undefined) continue;
    const n = nome.toLowerCase();
    if (n === "strict-transport-security") continue;
    if (n === "content-security-policy") {
      saida[nome] = Array.isArray(valor) ? valor.map(semUpgradeParaHttps) : semUpgradeParaHttps(String(valor));
      continue;
    }
    saida[nome] = valor;
  }
  return saida;
}

const ICONE = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg>`;

/**
 * Esperando o FireHub local ficar pronto (em contingência, ou o supervisor
 * ligando). Recarrega por JavaScript, não por `<meta refresh>`: o endereço
 * leva o bilhete no fragmento (#bilhete=...), e o `location.reload()` o
 * mantém — o meta refresh numa URL com # podia virar só um pulo de âncora.
 */
export const PAGINA_DE_ESPERA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FireHub da loja</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;text-align:center;padding:24px">
<div>${ICONE}<h1 style="font-size:20px;margin:8px 0">Modo Contingência</h1>
<p style="color:#cbd5e1;margin:0">Ligando o FireHub no computador da loja… esta tela atualiza sozinha.</p></div>
<script>setTimeout(function () { location.reload(); }, 3000);</script></body></html>`;

/**
 * A página de entrada do supervisor — o que um aparelho recebe ao chegar em
 * /contingencia/entrar com a nuvem de pé (14/10/2026: a TV pulava num soluço
 * da nuvem e ficava presa em "Ligando o FireHub…"). Não é do Next (não
 * precisa do FireHub local nem de /_next) e não apaga o #bilhete.
 *
 * A cada 3 s pergunta à porta da loja em que pé está o supervisor:
 *   - contingência/voltando: recarrega — agora a entrada é a do FireHub local,
 *     e o bilhete segue no fragmento;
 *   - normal, mas o supervisor também vendo falhas: espera (o aparelho
 *     percebeu a queda primeiro; o FireHub local já está subindo);
 *   - normal e em paz: confere a nuvem A PARTIR DO APARELHO. Com 2 respostas,
 *     volta para ela com a marca de volta (a tela da nuvem espera antes de
 *     pular de novo). Sem resposta, o problema é a rede DESTE aparelho: diz
 *     isso e tenta de novo, cada vez mais espaçado.
 * Nunca abre a cópia com a nuvem de pé: a loja não pode gravar em dois lugares.
 */
export function paginaDaEntrada(): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FireHub da loja</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;text-align:center;padding:24px">
<div style="max-width:440px">${ICONE}<h1 style="font-size:20px;margin:8px 0">FireHub</h1>
<p id="m" style="color:#cbd5e1;margin:0;line-height:1.5">Conferindo a conexão com o FireHub…</p>
<p id="d" style="color:#94a3b8;font-size:13px;margin:12px 0 0"></p></div>
<script>
(function () {
  var voltaSegura = ${voltaSegura.toString()};
  var origemDaVolta = ${origemDaVolta.toString()};
  var enderecoDeVolta = ${enderecoDeVolta.toString()};
  var esperaDoAparelho = ${esperaDoAparelho.toString()};
  var proximaContagem = ${proximaContagem.toString()};
  var CHAVE = "firehub_loja_voltas";
  var m = document.getElementById("m"), d = document.getElementById("d");
  function texto(a, b) { m.textContent = a; d.textContent = b || ""; }
  var f = new URLSearchParams(location.hash.substring(1));
  var volta = voltaSegura(f.get("volta") || new URLSearchParams(location.search).get("volta"), f.get("tipo"));
  var okSeguidos = 0, tentativa = 0, proximoTesteEm = 0, indo = false;
  function comPrazo(url, ms) {
    return new Promise(function (ok, falha) {
      var t = setTimeout(function () { falha(new Error("prazo")); }, ms);
      fetch(url, { cache: "no-store" }).then(function (r) { clearTimeout(t); ok(r); }, function (e) { clearTimeout(t); falha(e); });
    });
  }
  function voltar(origem) {
    var anterior = null;
    try { anterior = JSON.parse(localStorage.getItem(CHAVE) || "null"); } catch (x) {}
    var agora = Date.now();
    var n = proximaContagem(anterior, agora);
    try { localStorage.setItem(CHAVE, JSON.stringify({ n: n, em: agora })); } catch (x) {}
    texto("A conexão está de pé. Voltando ao FireHub…");
    location.replace(enderecoDeVolta(origem, volta, agora, n));
  }
  function tique() {
    comPrazo("/__contingencia/estado", 4000)
      .then(function (r) { return r.json(); })
      .then(function (e) {
        if (!e || !e.modo) throw new Error("sem estado");
        if (e.modo === "contingencia" || e.modo === "voltando") {
          indo = true;
          texto("Sem conexão com o FireHub. Entrando no computador da loja…");
          location.reload();
          return;
        }
        if (e.modo === "iniciando") { okSeguidos = 0; texto("O computador da loja está ligando…"); return; }
        if (e.modo === "normal" && e.falhas > 0) { okSeguidos = 0; texto("Conferindo a conexão com o FireHub…"); return; }
        if (Date.now() < proximoTesteEm) return;
        var origem = origemDaVolta({ origemPedida: f.get("origem"), origens: e.origensDaNuvem || [], origemDoPainel: e.origemDoPainel || null, nuvem: e.nuvem });
        return comPrazo(origem + "/api/contingencia/sinal", 4000)
          .then(function (r) { return r.ok; }, function () { return false; })
          .then(function (ok) {
            if (ok) {
              tentativa = 0;
              okSeguidos++;
              if (okSeguidos >= 2) { indo = true; voltar(origem); }
              return;
            }
            okSeguidos = 0;
            tentativa++;
            var espera = esperaDoAparelho(tentativa);
            proximoTesteEm = Date.now() + espera;
            texto("A loja está funcionando; este aparelho está sem conexão com o FireHub — confira o Wi-Fi dele.", "Tentando de novo em " + Math.round(espera / 1000) + " s.");
          });
      })
      .catch(function () { texto("Conectando ao computador da loja…"); })
      .then(function () { if (!indo) setTimeout(tique, 3000); });
  }
  tique();
})();
</script></body></html>`;
}

/** Pedido de página (o navegador abrindo um endereço), e não arquivo, API ou pedido do Next. */
export function pedeHtml(metodo: string | undefined, accept: string | undefined): boolean {
  return metodo === "GET" && String(accept || "").includes("text/html");
}

export function abrirPortaDaLoja(o: OpcoesDaPorta): http.Server {
  // A mesma linha (aparelho, caminho, decisão) no máximo uma vez por minuto:
  // a página de espera recarrega a cada 3 s.
  const vistos = new Map<string, number>();
  const anotar = (req: http.IncomingMessage, decisao: DecisaoDaPorta) => {
    if (!o.registro) return;
    const linha = linhaDoPedido(req.socket.remoteAddress || "", req.url || "/", decisao.tipo === "responder" ? `responder ${decisao.status}` : decisao.tipo);
    const agora = Date.now();
    if (agora - (vistos.get(linha) || 0) < 60_000) return;
    if (vistos.size > 500) vistos.clear();
    vistos.set(linha, agora);
    o.registro(linha);
  };
  /** Esperando o FireHub local: página só para quem abre página; arquivo, API e Next recebem JSON. */
  const esperar = (req: http.IncomingMessage, res: http.ServerResponse) => {
    if (pedeHtml(req.method, req.headers.accept)) {
      res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "3" });
      res.end(PAGINA_DE_ESPERA);
      return;
    }
    res.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": "3", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ aguarde: true, error: "O FireHub do computador da loja está ligando." }));
  };

  const servidor = http.createServer((req, res) => {
    let decisao: DecisaoDaPorta;
    try {
      decisao = o.decidir(req);
    } catch {
      decisao = { tipo: "esperar" };
    }
    if (pedeHtml(req.method, req.headers.accept)) anotar(req, decisao);
    if (decisao.tipo === "pagina") {
      res.writeHead(decisao.status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(decisao.html);
      return;
    }
    if (decisao.tipo === "responder") {
      res.writeHead(decisao.status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        ...decisao.cabecalhos,
      });
      res.end(decisao.corpo === undefined ? undefined : JSON.stringify(decisao.corpo));
      return;
    }
    if (decisao.tipo === "redirecionar") {
      res.writeHead(302, { location: decisao.para, "cache-control": "no-store" });
      res.end();
      return;
    }
    if (decisao.tipo === "esperar") return esperar(req, res);

    const ida = http.request(
      {
        host: o.destino.host,
        port: o.destino.porta,
        method: req.method,
        path: req.url,
        headers: {
          ...req.headers,
          "x-forwarded-for": req.socket.remoteAddress || "",
          "x-forwarded-host": req.headers.host || "",
          "x-forwarded-proto": "http",
        },
      },
      (volta) => {
        res.writeHead(volta.statusCode || 502, cabecalhosParaALoja(volta.headers));
        volta.pipe(res);
      },
    );
    ida.on("error", () => {
      if (res.headersSent) return res.destroy();
      esperar(req, res);
    });
    req.pipe(ida);
  });
  servidor.listen(o.porta, o.host);
  return servidor;
}
