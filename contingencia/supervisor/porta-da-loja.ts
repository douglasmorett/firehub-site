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

export type DecisaoDaPorta =
  | { tipo: "repassar" }
  | { tipo: "redirecionar"; para: string }
  | { tipo: "esperar" }
  | { tipo: "responder"; status: number; corpo: unknown };

export type OpcoesDaPorta = {
  /** Onde a porta escuta. 0.0.0.0 = a rede da loja inteira. */
  host: string;
  porta: number;
  /** O FireHub local. */
  destino: { host: string; porta: number };
  decidir: (req: http.IncomingMessage) => DecisaoDaPorta;
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

export const PAGINA_DE_ESPERA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="3">
<title>FireHub da loja</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0f172a;color:#f8fafc;font-family:system-ui,sans-serif;text-align:center;padding:24px">
<div><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/><circle cx="12" cy="12" r="4"/></svg><h1 style="font-size:20px;margin:8px 0">Modo Contingência</h1>
<p style="color:#cbd5e1;margin:0">Ligando o FireHub no computador da loja… esta tela atualiza sozinha.</p></div></body></html>`;

export function abrirPortaDaLoja(o: OpcoesDaPorta): http.Server {
  const servidor = http.createServer((req, res) => {
    let decisao: DecisaoDaPorta;
    try {
      decisao = o.decidir(req);
    } catch {
      decisao = { tipo: "esperar" };
    }
    if (decisao.tipo === "responder") {
      res.writeHead(decisao.status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      });
      res.end(JSON.stringify(decisao.corpo));
      return;
    }
    if (decisao.tipo === "redirecionar") {
      res.writeHead(302, { location: decisao.para, "cache-control": "no-store" });
      res.end();
      return;
    }
    if (decisao.tipo === "esperar") {
      res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "3" });
      res.end(PAGINA_DE_ESPERA);
      return;
    }

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
      res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "retry-after": "3" });
      res.end(PAGINA_DE_ESPERA);
    });
    req.pipe(ida);
  });
  servidor.listen(o.porta, o.host);
  return servidor;
}
