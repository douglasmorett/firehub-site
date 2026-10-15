/**
 * Trava as regras da porta da loja e do FireHub local do supervisor do Modo
 * Contingência (contingencia/supervisor/regras.ts e porta-da-loja.ts) — sem
 * banco, sem processo, sem rede. Origem: a noite de 14/10/2026 na Hakim
 * Centro (a TV do KDS pulava para a porta da loja num soluço da nuvem e
 * ficava presa em "Ligando o FireHub…").
 *
 *   npx tsx scripts/teste-supervisor-porta.ts
 */
import vm from "node:vm";
import {
  chaveRecusada,
  decidirRota,
  deveDesligarLocal,
  enderecoDeVolta,
  esperaDoAparelho,
  LIMIAR_DA_QUEDA_MS,
  linhaDoPedido,
  nuvemCaiu,
  origemDaVolta,
  PAZ_PARA_DESLIGAR_MS,
  proximaContagem,
  voltaSegura,
  type ModoDoSupervisor,
} from "../contingencia/supervisor/regras";
import { PAGINA_DE_ESPERA, paginaDaEntrada, pedeHtml } from "../contingencia/supervisor/porta-da-loja";

let falhas = 0;
const confere = (oQue: string, ok: boolean, obtido?: unknown) => {
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}`}`);
};

const NUVEM = "https://firehubfood.com.br";
const rota = (o: Partial<Parameters<typeof decidirRota>[0]> & { url: string }) =>
  decidirRota({ metodo: "GET", html: true, modo: "normal", localPronto: false, falhas: 0, nuvem: NUVEM, ...o });
const ENTRAR = "/contingencia/entrar";

console.log("— A porta da loja: /contingencia/entrar —");
{
  const d = rota({ url: ENTRAR });
  confere("modo normal, supervisor em paz: a página de entrada do supervisor (não a espera)", d.tipo === "entrada" && !(d as any).acordarLocal, d);
}
{
  const d = rota({ url: ENTRAR, falhas: 2 });
  confere("modo normal, supervisor também vendo falhas: entrada que acorda o FireHub local", d.tipo === "entrada" && (d as any).acordarLocal === true, d);
}
{
  const d = rota({ url: ENTRAR, localPronto: true });
  confere("modo normal com o local pronto: NUNCA a cópia (entrada)", d.tipo === "entrada", d);
}
confere("contingência com o local pronto: repassa ao FireHub local", rota({ url: ENTRAR, modo: "contingencia", localPronto: true }).tipo === "repassar");
confere("contingência sem o local: espera", rota({ url: ENTRAR, modo: "contingencia" }).tipo === "esperar");
confere("voltando com o local pronto: repassa", rota({ url: ENTRAR, modo: "voltando", localPronto: true }).tipo === "repassar");
confere("ligando (antes do banco): espera", rota({ url: ENTRAR, modo: "iniciando" }).tipo === "esperar");
{
  const d = rota({ url: ENTRAR, modo: "sem-copia", falhas: 3 });
  confere("sem cópia: entrada, sem acordar o local (não há o que servir)", d.tipo === "entrada" && !(d as any).acordarLocal, d);
}
{
  const d = rota({ url: ENTRAR, modo: "revogada", falhas: 3 });
  confere("chave revogada: entrada (devolve à nuvem), sem acordar o local", d.tipo === "entrada" && !(d as any).acordarLocal, d);
}
confere("pedido do Next (não é página) para a entrada em modo normal: JSON da nuvem", rota({ url: ENTRAR, html: false }).tipo === "na-nuvem");

console.log("— A porta da loja: o resto —");
confere("/_next sem o local, em modo normal: espera (JSON, não a página)", rota({ url: "/_next/static/chunks/a.js", html: false }).tipo === "esperar");
confere("/_next com o local pronto: repassa (só arquivo do build)", rota({ url: "/_next/static/chunks/a.js", html: false, localPronto: true }).tipo === "repassar");
confere("/_next em contingência sem o local: espera", rota({ url: "/_next/static/chunks/a.js", html: false, modo: "contingencia" }).tipo === "esperar");
confere("/_next com a chave revogada: na nuvem", rota({ url: "/_next/static/chunks/a.js", html: false, modo: "revogada", localPronto: true }).tipo === "na-nuvem");
confere(
  "/api/contingencia/entrar em modo normal: nunca entra na cópia",
  rota({ url: "/api/contingencia/entrar", metodo: "POST", html: false, localPronto: true }).tipo === "na-nuvem",
);
{
  const d = rota({ url: "/store/kds/tela?stage=finishing" });
  confere("página da loja em modo normal: volta para a nuvem no mesmo endereço", d.tipo === "redirecionar" && (d as any).para === `${NUVEM}/store/kds/tela?stage=finishing`, d);
}
{
  const d = rota({ url: "/store/pedidos-clientes", modo: "iniciando" });
  confere("página da loja com o supervisor ligando: volta para a nuvem", d.tipo === "redirecionar" && (d as any).para === `${NUVEM}/store/pedidos-clientes`, d);
}
confere("página da loja em contingência sem o local: espera", rota({ url: "/store/pedidos-clientes", modo: "contingencia" }).tipo === "esperar");
{
  const d = rota({ url: "/tv" });
  confere("/tv com a nuvem de pé: a lista de telas do KDS na nuvem", d.tipo === "redirecionar" && (d as any).para === `${NUVEM}/store/kds`, d);
}
{
  const d = rota({ url: "/tv/", modo: "contingencia" });
  confere("/tv em contingência: a lista de telas do KDS aqui", d.tipo === "redirecionar" && (d as any).para === "/store/kds", d);
}
confere("pedeHtml: GET com text/html", pedeHtml("GET", "text/html,application/xhtml+xml") && !pedeHtml("POST", "text/html") && !pedeHtml("GET", "*/*"));

console.log("— A queda e o FireHub local —");
{
  const t0 = 1_000_000;
  confere("4 falhas em 12 s: ainda não é queda", !nuvemCaiu({ falhas: 4, primeiraFalhaEm: t0, agora: t0 + 12_000 }));
  confere(`falhas por ${LIMIAR_DA_QUEDA_MS / 1000} s: queda`, nuvemCaiu({ falhas: 8, primeiraFalhaEm: t0, agora: t0 + LIMIAR_DA_QUEDA_MS }));
  confere("uma falha só (ciclo demorado), mesmo depois de 40 s: ainda não", !nuvemCaiu({ falhas: 1, primeiraFalhaEm: t0, agora: t0 + 40_000 }));
  confere("sem série de falhas: não", !nuvemCaiu({ falhas: 0, primeiraFalhaEm: 0, agora: t0 }));
}
{
  const agora = 100 * 60_000;
  const base = { ligado: true, subindo: false, agora, normalDesde: agora - 30 * 60_000, ultimaFalhaEm: 0, manterLigadoAte: 0 };
  confere("10 min em paz desde a entrada no normal, sem falhas: desliga", deveDesligarLocal(base));
  confere("o soluço de 14/10: normal há 30 min, falha há 3 s → NÃO desliga", !deveDesligarLocal({ ...base, ultimaFalhaEm: agora - 3_000 }));
  confere("última falha há 9 min: não desliga", !deveDesligarLocal({ ...base, ultimaFalhaEm: agora - 9 * 60_000 }));
  confere("última falha há 11 min: desliga", deveDesligarLocal({ ...base, ultimaFalhaEm: agora - PAZ_PARA_DESLIGAR_MS - 60_000 }));
  confere("subindo: não desliga", !deveDesligarLocal({ ...base, subindo: true }));
  confere("um aparelho pediu para segurar (manterLigadoAte): não desliga", !deveDesligarLocal({ ...base, manterLigadoAte: agora + 60_000 }));
  confere("desligado: nada a fazer", !deveDesligarLocal({ ...base, ligado: false }));
  confere("acabou de entrar no normal: não desliga", !deveDesligarLocal({ ...base, normalDesde: agora - 60_000 }));
}
{
  const t0 = 5_000_000;
  confere("chave recusada 5 vezes em 30 s: ainda não revoga (pode ser soluço)", !chaveRecusada({ recusas: 5, primeiraRecusaEm: t0, agora: t0 + 30_000 }));
  confere("chave recusada 5 vezes por mais de 1 min: revoga", chaveRecusada({ recusas: 5, primeiraRecusaEm: t0, agora: t0 + 61_000 }));
  confere("2 recusas em 5 min: não revoga", !chaveRecusada({ recusas: 2, primeiraRecusaEm: t0, agora: t0 + 5 * 60_000 }));
}

console.log("— A volta para a nuvem (contrato com as telas) —");
confere("volta da tela do KDS preserva a consulta", voltaSegura("/store/kds/tela?stage=finishing&par=1", null) === "/store/kds/tela?stage=finishing&par=1");
confere("volta //outro-site é recusada", voltaSegura("//evil.com/x", null) === "/store/pedidos-clientes");
confere("volta /\\outro-site é recusada", voltaSegura("/\\evil.com", null) === "/store/pedidos-clientes");
confere("volta com endereço inteiro é recusada", voltaSegura("https://evil.com", null) === "/store/pedidos-clientes");
confere("volta sem nada, garçom: /garcom", voltaSegura(null, "garcom") === "/garcom");
confere("volta leva fragmento: ele sai (a marca é que vai no fragmento)", voltaSegura("/store/kds#x=1", null) === "/store/kds");
{
  const origens = [NUVEM, "https://www.firehubfood.com.br"];
  confere("origem pedida pela tela (www), válida: www", origemDaVolta({ origemPedida: "https://www.firehubfood.com.br", origens, origemDoPainel: null, nuvem: NUVEM }) === "https://www.firehubfood.com.br");
  confere("origem pedida de fora: a do painel", origemDaVolta({ origemPedida: "https://evil.com", origens, origemDoPainel: "https://www.firehubfood.com.br", nuvem: NUVEM }) === "https://www.firehubfood.com.br");
  confere("sem pedido nem painel: a de sempre", origemDaVolta({ origemPedida: null, origens, origemDoPainel: "https://evil.com", nuvem: NUVEM }) === NUVEM);
}
{
  const e = enderecoDeVolta(NUVEM, "/store/kds/tela?stage=finishing", 1760000000000, 2);
  confere("marca de volta: #fh-voltou=<ms>&n=<pulos>", e === `${NUVEM}/store/kds/tela?stage=finishing#fh-voltou=1760000000000&n=2`, e);
}
confere("espera do aparelho sem nuvem: 15, 30, 60, 60 s", [1, 2, 3, 9].map(esperaDoAparelho).join() === "15000,30000,60000,60000");
confere("primeira volta: n=1", proximaContagem(null, 1000) === 1);
confere("voltou de novo 5 min depois: n=2", proximaContagem({ n: 1, em: 0 }, 5 * 60_000) === 2);
confere("voltou de novo 1 h depois: a série recomeça", proximaContagem({ n: 3, em: 0 }, 60 * 60_000) === 1);

console.log("— O registro da porta —");
{
  const l = linhaDoPedido("192.168.15.20", "/store/kds/tela?stage=finishing&token=abc#bilhete=SEGREDO", "entrada");
  confere("linha do pedido sem consulta nem fragmento", l === "Porta da loja: 192.168.15.20 /store/kds/tela?… → entrada" && !l.includes("SEGREDO") && !l.includes("abc"), l);
}

console.log("— As páginas do supervisor —");
confere("página de espera sem meta refresh, recarrega por JS", !/http-equiv="refresh"/.test(PAGINA_DE_ESPERA) && PAGINA_DE_ESPERA.includes("location.reload()"));

/**
 * Roda o JavaScript da página de entrada num navegador de mentira: a porta da
 * loja responde `estado`, a nuvem responde `nuvemOk`; os relógios andam na mão.
 */
async function simular(o: { hash: string; estado: Record<string, unknown>; nuvemOk: boolean; voltas?: number; guardado?: string | null }) {
  const html = paginaDaEntrada();
  const script = html.split("<script>")[1].split("</script>")[0];
  const fila: { fn: () => void; ms: number }[] = [];
  const pedidos: string[] = [];
  const res: { replace: string | null; reload: number; m: string; d: string; guardado: string | null } = { replace: null, reload: 0, m: "", d: "", guardado: o.guardado ?? null };
  let agora = 1_760_000_000_000;
  const elementos: Record<string, { textContent: string }> = { m: { textContent: "" }, d: { textContent: "" } };
  const contexto = {
    URLSearchParams,
    JSON,
    Math,
    Promise,
    Error,
    Date: { now: () => agora },
    document: { getElementById: (id: string) => elementos[id] },
    location: {
      hash: o.hash,
      search: "",
      replace: (u: string) => { res.replace = u; },
      reload: () => { res.reload++; },
    },
    localStorage: {
      getItem: () => res.guardado,
      setItem: (_k: string, v: string) => { res.guardado = v; },
    },
    setTimeout: (fn: () => void, ms: number) => { fila.push({ fn, ms }); return fila.length; },
    clearTimeout: () => {},
    fetch: async (url: string) => {
      pedidos.push(url);
      if (url === "/__contingencia/estado") return { ok: true, json: async () => o.estado };
      if (o.nuvemOk) return { ok: true, json: async () => ({ ok: true }) };
      throw new Error("sem rede");
    },
  };
  vm.runInNewContext(script, contexto);
  const assentar = () => new Promise((r) => setImmediate(r));
  for (let volta = 0; volta < (o.voltas ?? 4); volta++) {
    await assentar();
    await assentar();
    // Roda o próximo "tique" (o de 3 s; os prazos de 4 s ficam para trás).
    const i = fila.findIndex((t) => t.ms === 3000);
    if (i < 0) break;
    const [t] = fila.splice(i, 1);
    agora += t.ms;
    fila.length = 0;
    t.fn();
  }
  await assentar();
  await assentar();
  res.m = elementos.m.textContent;
  res.d = elementos.d.textContent;
  return { ...res, pedidos };
}

const estadoNormal = {
  modo: "normal",
  falhas: 0,
  nuvem: NUVEM,
  origensDaNuvem: [NUVEM, "https://www.firehubfood.com.br"],
  origemDoPainel: null,
};
const hashDaTv = `#bilhete=XYZ&volta=${encodeURIComponent("/store/kds/tela?stage=finishing")}&tipo=painel&origem=${encodeURIComponent("https://www.firehubfood.com.br")}`;

(async () => {
  {
    const r = await simular({ hash: hashDaTv, estado: estadoNormal, nuvemOk: true });
    confere(
      "página de entrada, nuvem de pé e alcançável: volta à tela de antes, com a marca, depois de 2 respostas",
      !!r.replace && r.replace.startsWith("https://www.firehubfood.com.br/store/kds/tela?stage=finishing#fh-voltou=") && r.replace.endsWith("&n=1"),
      r,
    );
    confere("…e conferiu a nuvem 2 vezes a partir do aparelho", r.pedidos.filter((u) => u.endsWith("/api/contingencia/sinal")).length === 2, r.pedidos);
    confere("…e anotou a volta (para a próxima contar n=2)", JSON.parse(r.guardado || "{}").n === 1, r.guardado);
  }
  {
    const r = await simular({ hash: hashDaTv, estado: estadoNormal, nuvemOk: true, guardado: JSON.stringify({ n: 1, em: 1_760_000_000_000 - 60_000 }) });
    confere("segunda volta em poucos minutos: n=2", !!r.replace && r.replace.endsWith("&n=2"), r.replace);
  }
  {
    const r = await simular({ hash: hashDaTv, estado: estadoNormal, nuvemOk: false });
    confere("aparelho sem nuvem: não volta, diz para conferir o Wi-Fi", !r.replace && r.m.includes("confira o Wi-Fi") && r.d.includes("15 s"), r);
    confere("…e não fica perguntando à nuvem a cada 3 s", r.pedidos.filter((u) => u.endsWith("/api/contingencia/sinal")).length === 1, r.pedidos);
  }
  {
    const r = await simular({ hash: hashDaTv, estado: { ...estadoNormal, falhas: 2 }, nuvemOk: true });
    confere("supervisor também vendo falhas: espera, sem voltar", !r.replace && !r.reload && !r.pedidos.some((u) => u.endsWith("/api/contingencia/sinal")), r);
  }
  {
    // "Testar agora": o caixa chega antes do primeiro ciclo contar a falha de mentira.
    const r = await simular({ hash: hashDaTv, estado: { ...estadoNormal, testando: true }, nuvemOk: true });
    confere("\"Testar agora\" com falhas=0: espera a contingência, não volta para a nuvem", !r.replace && !r.pedidos.some((u) => u.endsWith("/api/contingencia/sinal")), r);
  }
  {
    const r = await simular({ hash: hashDaTv, estado: { ...estadoNormal, modo: "contingencia" }, nuvemOk: false, voltas: 1 });
    confere("supervisor em contingência: recarrega (o bilhete segue no fragmento)", r.reload === 1 && !r.replace, r);
  }
  {
    const r = await simular({ hash: "#bilhete=XYZ&volta=%2F%2Fevil.com", estado: estadoNormal, nuvemOk: true });
    confere("volta //evil: vai para o painel na nuvem", r.replace?.startsWith(`${NUVEM}/store/pedidos-clientes#fh-voltou=`) === true, r.replace);
  }

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  if (falhas) process.exit(1);
})();

// Para o TypeScript conferir que todo modo tem decisão.
const _todos: ModoDoSupervisor[] = ["iniciando", "sem-copia", "normal", "contingencia", "voltando", "revogada"];
void _todos;
