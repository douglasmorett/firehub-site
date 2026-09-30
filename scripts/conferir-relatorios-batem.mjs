/**
 * Confere se os relatórios BATEM ENTRE SI: valor vendido, número de vendas,
 * lançamentos, total dos itens e descontos, no mesmo filtro, em seis
 * relatórios que mostram o mesmo número por caminhos diferentes.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Em 24/09/2026 os relatórios divergiam entre si na Pastel da Paulista, de 09
 * a 16/09: "Vendas por período" dizia R$ 34.660,54 e 635 pedidos; "Faturamento
 * por dia" dizia R$ 34.631,14 e 495 vendas, com total dos itens de
 * R$ 33.681,50 contra R$ 33.585,50 do "Itens vendidos"; o "Dia e hora"
 * aplicava um fator de desconto da mesa ao valor. O lojista que abre dois
 * relatórios e acha dois números para a mesma semana para de confiar nos dois.
 * A régua única (lib/relatorios/regua-da-venda.ts) acabou com isso; este
 * script é a prova, contra o banco de verdade, de que continua acabado.
 *
 * ── O que compara ───────────────────────────────────────────────────────────
 *
 *   valor vendido   vendas.resumo.totalPedidos · faturamento.total.valor ·
 *                   data-hora.metricas.valor.total · formas.vendas.valor ·
 *                   descontos.resumo.vendas (a BASE do "% sobre as vendas")
 *   vendas          (atendimentos: pedido sem mesa + 1 por mesa)
 *                   vendas.resumo.atendimentos · faturamento.total.vendas ·
 *                   data-hora.metricas.pedidos.total · formas.vendas.atendimentos
 *   lançamentos     vendas.resumo.pedidos · faturamento.total.lancamentos ·
 *                   formas.vendas.pedidos · itens-vendidos.pedidos ·
 *                   descontos.resumo.pedidos
 *   total dos itens vendas.resumo.totalItens · faturamento.total.itens ·
 *                   itens-vendidos.total.valor
 *   qtd. de itens   vendas.resumo.quantidadeDeItens · data-hora.metricas.itens.total ·
 *                   itens-vendidos.total.quantidade
 *   ticket médio    vendas.resumo.ticketMedio · faturamento.total.ticketMedio ·
 *                   data-hora (valor ÷ vendas, a conta da tela) · formas.vendas.ticketMedio
 *   serviço         (taxa de serviço das mesas fechadas, soma crua)
 *                   vendas.resumo.servico.taxa · faturamento.mesasFechadas.taxa ·
 *                   formas.mesas.taxaDeServico · a linha SERVICO da ponte do formas
 *   desconto mesa   (dado no fechamento, pelo dia em que a mesa fechou)
 *                   vendas.resumo.servico.descontoNaMesa ·
 *                   faturamento.mesasFechadas.descontoNaMesa · a linha DESCONTO_MESA da ponte ·
 *                   descontos (a origem "Desconto na conta da mesa")
 *   desconto total  (dos pedidos + o dado no fechamento da mesa)
 *                   vendas.resumo.descontos.total + servico.descontoNaMesa ·
 *                   faturamento.total.descontos + total.descontoNaMesa ·
 *                   descontos.resumo.desconto
 *   desc. anterior  (o mesmo total no período anterior, cortado no mesmo
 *                   horário quando o período chega até hoje)
 *                   vendas.anterior.descontos · descontos.anterior.desconto
 *
 * em NIK e Pastel da Paulista (a das mesas com conta), nos períodos "7 dias"
 * (até hoje), "Este mês" (até hoje) e 09–16/09/2026, sem filtro, com canal
 * iFood e com tipo Mesa; e em três casos que a revisão de 24/09/2026 achou:
 * a Pastel com a faixa das 18h às 02h, a Pastel de 01/08 a 12/09 (a conta de
 * 05/09 com taxa de serviço negativa), a Pastel só em 11/09 e só em 13/09 (a
 * Mesa 55, ver abaixo) e o Ruíco Burger de 01/08 até hoje (a
 * conta de 20/08 fechada com R$ 12 de consumo e nada pago, que a ponte do
 * formas chamava de desconto). Sai com código 1 se QUALQUER número divergir —
 * um centavo que seja.
 *
 * O Cupons e descontos entra desde 24/09/2026, quando passou para a régua
 * (o desconto da mesa pelo fechamento, a base do percentual = valor vendido).
 * Antes ele pendurava o desconto da mesa no dia dos lançamentos e abatia o
 * "vendas": na Pastel, 09–16/09, 34.535,14 contra 34.660,54 dos outros. Os
 * dias 11/09 e 13/09 da Pastel entram sozinhos porque são o caso que separava
 * os dois: a Mesa 55, lançada no dia 11 e fechada no 13 com R$ 125,40 de
 * desconto. A tela e o Excel do Vendas por período dizem que o total de
 * desconto dos dois é o mesmo — estes dois casos provam o que o texto afirma.
 *
 * ── O que exige ─────────────────────────────────────────────────────────────
 *
 * Ferramenta de DESENVOLVIMENTO, que só LÊ: não grava nada. Precisa do
 * servidor no ar (padrão http://localhost:3002) e de uma SESSÃO DE VERDADE —
 * as rotas /api/store/relatorios/* exigem login. Entre no painel com o
 * navegador, copie o cabeçalho Cookie de uma chamada a /api/store/relatorios/*
 * (F12 → Rede → a requisição → Cabeçalhos da solicitação → "cookie") e passe
 * em FH_COOKIE:
 *
 *   FH_COOKIE="next-auth.session-token=…; firehub_active_store=…" node scripts/conferir-relatorios-batem.mjs
 *   FH_COOKIE="…" node scripts/conferir-relatorios-batem.mjs --base=http://localhost:3000
 *
 * (No PowerShell: $env:FH_COOKIE="…"; node scripts/conferir-relatorios-batem.mjs)
 * O script vê só a loja DAQUELA sessão: roda os períodos, os filtros e os
 * casos da revisão (faixa 18h–02h, 01/08–12/09, 11/09, 13/09) nela. Para outra
 * loja, outra sessão — ou, com uma conta ADMIN, o cookie
 * `firehub_active_store=<id da loja>` escolhe a loja (é o seletor de loja do
 * admin; lib/relatorios/servidor.ts, contextoDoRelatorio). Em http (dev) o
 * cookie da sessão chama `next-auth.session-token`; em https,
 * `__Secure-next-auth.session-token`. O cookie é a sua sessão: não o grave em
 * arquivo nem cole em chat.
 *
 * Períodos que chegam até HOJE mudam enquanto a loja vende: um pedido que
 * chega entre uma rota e outra daria diferença falsa. Por isso, se as seis
 * rotas de um caso com hoje divergirem, o caso é refeito uma vez antes de
 * acusar. (Elas vão uma de cada vez: as cinco juntas, no mês da Pastel da
 * Paulista, esgotavam o pool do banco do dev server e a rota voltava 500.)
 */

const BASE = (process.argv.find((a) => a.startsWith("--base=")) || "--base=http://localhost:3002").slice(7).replace(/\/$/, "");
/** A sessão copiada do navegador (ver o cabeçalho). */
const COOKIE = String(process.env.FH_COOKIE || "").trim();
if (!COOKIE) {
  console.error("Falta FH_COOKIE: as rotas de relatório exigem login. Copie o cookie da sessão do navegador (ver o cabeçalho deste script).");
  process.exit(2);
}

// A loja é a da sessão (ou a do firehub_active_store do admin).
const LOJAS = [{ nome: "loja da sessão" }];
// Os casos da revisão que eram da Pastel rodam na loja da sessão.
const PASTEL = LOJAS[0];
const RUICO = null;
const FILTROS = [
  { nome: "sem filtro", query: {} },
  { nome: "canal iFood", query: { canais: "IFOOD" } },
  { nome: "tipo Mesa", query: { tipos: "MESA" } },
];
const ROTAS = ["vendas", "faturamento-por-dia", "data-hora", "formas-de-pagamento", "itens-vendidos", "descontos"];

const somarDias = (dia, n) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function buscar(rota, email, query, tentativa = 1) {
  const sp = new URLSearchParams(query);
  const resp = await fetch(`${BASE}/api/store/relatorios/${rota}?${sp}`, { headers: { cookie: COOKIE } });
  // O dev server compila a rota na primeira chamada e o pool do banco é
  // pequeno: um 500 isolado se refaz antes de virar falha.
  if (resp.status >= 500 && tentativa < 3) {
    await new Promise((ok) => setTimeout(ok, 1500 * tentativa));
    return buscar(rota, email, query, tentativa + 1);
  }
  if (resp.status === 401) {
    throw new Error(`${rota}: 401 — a sessão de FH_COOKIE não vale (expirou, ou o nome do cookie é o de https/http errado; ver o cabeçalho)`);
  }
  if (!resp.ok) throw new Error(`${rota}: HTTP ${resp.status} — ${(await resp.text()).slice(0, 200)}`);
  return resp.json();
}

/** Os números de cada relatório, com o nome de onde saíram. `undefined` = o relatório não tem esse número. */
function numeros(r) {
  const v = r["vendas"], f = r["faturamento-por-dia"], d = r["data-hora"], p = r["formas-de-pagamento"], i = r["itens-vendidos"], c = r["descontos"];
  const soma = (...x) => Math.round(x.reduce((s, n) => s + (Number(n) || 0) * 100, 0)) / 100;
  return {
    // `descontos` = a base do "% sobre as vendas" do Cupons e descontos.
    valor: { vendas: v.resumo.totalPedidos, faturamento: f.total.valor, "data-hora": d.metricas.valor.total, formas: p.vendas.valor, descontos: c.resumo.vendas },
    vendas: {
      // `atendimentos` nasceu com a régua única; antes dela o cartão era de pedidos.
      vendas: v.resumo.atendimentos ?? v.resumo.pedidos, faturamento: f.total.vendas,
      "data-hora": d.metricas.pedidos.total, formas: p.vendas.atendimentos ?? p.vendas.pedidos,
    },
    lancamentos: { vendas: v.resumo.lancamentos ?? v.resumo.pedidos, faturamento: f.total.lancamentos, formas: p.vendas.pedidos, itens: i.pedidos, descontos: c.resumo.pedidos },
    itens: { vendas: v.resumo.totalItens, faturamento: f.total.itens, itens: i.total.valor },
    qtdItens: { vendas: v.resumo.quantidadeDeItens, "data-hora": d.metricas.itens.total, itens: i.total.quantidade },
    ticket: {
      vendas: v.resumo.ticketMedio, faturamento: f.total.ticketMedio ?? 0,
      // A tela do Dia e hora divide na hora (DataHoraClient): valor ÷ vendas, ao centavo.
      "data-hora": d.metricas.pedidos.total > 0 ? Math.round((d.metricas.valor.total * 100) / d.metricas.pedidos.total) / 100 : 0,
      formas: p.vendas.ticketMedio,
    },
    servico: { vendas: v.resumo.servico?.taxa, faturamento: f.mesasFechadas?.taxa, formas: p.mesas?.taxaDeServico, ponte: linhaDaPonte(p, "SERVICO") },
    descontoMesa: {
      vendas: v.resumo.servico?.descontoNaMesa, faturamento: f.mesasFechadas?.descontoNaMesa, ponte: -linhaDaPonte(p, "DESCONTO_MESA"),
      descontos: (c.origens || []).find((o) => o.chave === "mesa:MESA:conta")?.valor ?? 0,
    },
    descontoTotal: {
      vendas: soma(v.resumo.descontos?.total, v.resumo.servico?.descontoNaMesa),
      faturamento: soma(f.total.descontos, f.total.descontoNaMesa),
      descontos: c.resumo.desconto,
    },
    descontoAnterior: { vendas: v.anterior?.descontos, descontos: c.anterior?.desconto },
  };
}

/** O valor de uma linha da ponte do Formas de pagamento (0 quando a linha não existe). */
const linhaDaPonte = (p, chave) => (p.diferenca?.linhas || []).find((l) => l.chave === chave)?.valor ?? 0;

const iguais = (valores) => {
  const lista = Object.values(valores).filter((x) => x !== undefined && x !== null);
  return lista.every((x) => Math.round(x * 100) === Math.round(lista[0] * 100));
};

const fmt = (n) => (n === undefined || n === null ? "—" : Number.isInteger(n) && Math.abs(n) < 100000 ? String(n) : n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const coluna = (valores) => (iguais(valores)
  ? `✓ ${fmt(Object.values(valores).find((x) => x !== undefined && x !== null))}`
  : `✗ ${Object.entries(valores).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}=${fmt(x)}`).join(" ")}`);

async function caso(loja, periodo, filtro, hoje) {
  const query = { de: periodo.de, ate: periodo.ate, ...filtro.query };
  const tentar = async () => {
    // Uma rota de cada vez: cinco consultas pesadas juntas esgotavam o pool do banco do dev server.
    const respostas = [];
    for (const rota of ROTAS) respostas.push(await buscar(rota, loja.email, query));
    return numeros(Object.fromEntries(ROTAS.map((rota, i) => [rota, respostas[i]])));
  };
  let n = await tentar();
  const bate = (x) => Object.values(x).every(iguais);
  if (!bate(n) && periodo.ate >= hoje) n = await tentar();
  return { n, ok: bate(n) };
}

async function main() {
  let hoje;
  try {
    hoje = (await buscar("vendas", LOJAS[0].email, {})).hoje;
  } catch (e) {
    console.error(`Não consegui falar com ${BASE}: ${e.message}`);
    process.exit(2);
  }
  const PERIODOS = [
    { nome: "7 dias", de: somarDias(hoje, -6), ate: hoje },
    { nome: "Este mês", de: `${hoje.slice(0, 7)}-01`, ate: hoje },
    { nome: "09–16/09", de: "2026-09-09", ate: "2026-09-16" },
  ];
  const CASOS = LOJAS.flatMap((loja) => PERIODOS.flatMap((periodo) => FILTROS.map((filtro) => ({ loja, periodo, filtro }))));
  // Os casos da revisão de 24/09/2026 (ver o cabeçalho).
  CASOS.push(
    { loja: PASTEL, periodo: { nome: "Este mês", de: `${hoje.slice(0, 7)}-01`, ate: hoje }, filtro: { nome: "18h–02h", query: { horaDe: "18:00", horaAte: "02:00" } } },
    { loja: PASTEL, periodo: { nome: "01/08–12/09", de: "2026-08-01", ate: "2026-09-12" }, filtro: FILTROS[0] },
    // A Mesa 55: lançada em 11/09, fechada em 13/09 (ver o cabeçalho).
    { loja: PASTEL, periodo: { nome: "só 11/09", de: "2026-09-11", ate: "2026-09-11" }, filtro: FILTROS[0] },
    { loja: PASTEL, periodo: { nome: "só 13/09", de: "2026-09-13", ate: "2026-09-13" }, filtro: FILTROS[0] },
    // O Ruíco é outra loja: com sessão (FH_COOKIE) ela não é visível.
    ...(RUICO ? [{ loja: RUICO, periodo: { nome: "01/08–hoje", de: "2026-08-01", ate: hoje }, filtro: FILTROS[0] }] : []),
  );

  const linhas = [];
  let falhas = 0;
  for (const { loja, periodo, filtro } of CASOS) {
    const { n, ok } = await caso(loja, periodo, filtro, hoje);
    if (!ok) falhas++;
    linhas.push([
      ok ? "OK " : "FALHA",
      loja.nome,
      `${periodo.nome} (${periodo.de.slice(8)}/${periodo.de.slice(5, 7)}–${periodo.ate.slice(8)}/${periodo.ate.slice(5, 7)})`,
      filtro.nome,
      coluna(n.valor),
      coluna(n.vendas),
      coluna(n.lancamentos),
      coluna(n.itens),
      coluna(n.qtdItens),
      coluna(n.ticket),
      coluna(n.servico),
      coluna(n.descontoMesa),
      coluna(n.descontoTotal),
      coluna(n.descontoAnterior),
    ]);
  }

  const cab = ["", "Loja", "Período", "Filtro", "Valor vendido", "Vendas", "Lançamentos", "Total dos itens", "Qtd. de itens", "Ticket médio", "Serviço", "Desconto na mesa", "Desconto total", "Desconto (anterior)"];
  const larguras = cab.map((c, i) => Math.max(c.length, ...linhas.map((l) => l[i].length)));
  const linha = (l) => l.map((c, i) => c.padEnd(larguras[i])).join(" │ ");
  console.log(`Relatórios em ${BASE} — hoje ${hoje} — com a sessão de FH_COOKIE\n`);
  console.log(linha(cab));
  console.log(larguras.map((n) => "─".repeat(n)).join("─┼─"));
  for (const l of linhas) console.log(linha(l));
  console.log(falhas === 0
    ? `\nTodos os ${linhas.length} casos batem, centavo a centavo.`
    : `\n${falhas} de ${linhas.length} casos com números diferentes entre os relatórios (✗ mostra de onde saiu cada um).`);
  process.exit(falhas === 0 ? 0 : 1);
}

main();
