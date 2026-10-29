/**
 * O BILL, SEU ASSESSOR em cada modelo, numa LOJA DE TESTE: as mesmas falas do
 * dono, as ferramentas de verdade, e a conferência do que mudou no banco
 * (estoque, cardápio, site, registros do assessor).
 *
 *   npx tsx scripts/teste-assessor-nos-modelos.ts <lojaId> [rodadas] [gemini|claude|ambos] [grupo...]
 *
 * GRAVA na loja dada: só aceita loja com "Teste" no nome. Deixa o site aberto e
 * o cardápio reativado no fim. Custo: ~R$ 5 no Gemini por rodada dos dois.
 * Feito para a troca do assessor para o Claude Haiku 5.5 (29/10/2026).
 */
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { conversarComOAssessor, type AcaoDoAssessor } from "../src/lib/assessor/assessor";
import { MODELO_CLAUDE } from "../src/lib/robo-no-claude";

const [lojaId, rodadasArg, quaisArg, ...filtro] = process.argv.slice(2);
const RODADAS = Number(rodadasArg) || 1;
const MIDIA = process.env.MIDIA_DO_TESTE || "";
const MODELOS: Record<string, string[]> = { gemini: ["gemini-3.6-flash"], claude: [MODELO_CLAUDE] };
const quais = !quaisArg || quaisArg === "ambos" ? ["gemini", "claude"] : [quaisArg];

type Estado = { estoque: Record<string, number>; ativo: Record<string, boolean>; site: boolean; registros: string[] };
type Fala = { texto?: string; audio?: string; imagem?: string };
type Grupo = { id: string; falas: Fala[]; conferir: (e: { antes: Estado; depois: Estado; acoes: AcaoDoAssessor[]; respostas: string[] }) => string[] };

const ESTOQUE_INICIAL = [
  { name: "Coca-Cola Lata 350ml", unit: "un", quantity: 20, unitCost: 4.5 },
  { name: "Mussarela", unit: "kg", quantity: 4, unitCost: 32 },
  { name: "Caixa de pizza 35cm", unit: "un", quantity: 40, unitCost: 0.8 },
  { name: "Farinha de trigo", unit: "kg", quantity: 10, unitCost: 4.2 },
];

const qtdDe = (e: Estado, re: RegExp) => Object.entries(e.estoque).filter(([n]) => re.test(n)).reduce((s, [, q]) => s + q, 0);
const ok = (acoes: AcaoDoAssessor[], nome: string) => acoes.some((a) => a.nome === nome && (a.resultado as any)?.ok);
const chamou = (acoes: AcaoDoAssessor[], nome: string) => acoes.some((a) => a.nome === nome);
const GRAVAM = ["registrar_compra", "registrar_saida", "registrar_despesa", "registrar_conta_a_pagar", "marcar_conta_paga", "pausar_ou_reativar_itens", "abrir_ou_fechar_site", "desfazer_ultimo_registro"];
const gravouAlgo = (acoes: AcaoDoAssessor[]) => acoes.filter((a) => GRAVAM.includes(a.nome)).map((a) => a.nome);
const perto = (a: number, b: number) => Math.abs(a - b) < 0.01;
const novos = (e: { antes: Estado; depois: Estado }) => e.depois.registros.slice(e.antes.registros.length);

const GRUPOS: Grupo[] = [
  { id: "compra-simples", falas: [{ texto: "comprei 10 coca lata, paguei 45 no pix" }], conferir: (e) => {
    const f: string[] = [];
    if (!ok(e.acoes, "registrar_compra")) f.push("não lançou a compra");
    const d = qtdDe(e.depois, /coca/i) - qtdDe(e.antes, /coca/i);
    if (!perto(d, 10)) f.push(`estoque da coca mudou ${d} (esperado +10)`);
    if (Object.keys(e.depois.estoque).length !== Object.keys(e.antes.estoque).length) f.push("criou item novo em vez de usar a Coca-Cola Lata cadastrada");
    if (!/45/.test(e.respostas.at(-1) || "")) f.push("resposta não diz os R$ 45");
    return f;
  } },
  { id: "fardo", falas: [{ texto: "chegou 2 fardos de coca lata, 12 latas cada, deu 90 reais" }], conferir: (e) => {
    const d = qtdDe(e.depois, /coca/i) - qtdDe(e.antes, /coca/i);
    return [...(!ok(e.acoes, "registrar_compra") ? ["não lançou"] : []), ...(!perto(d, 24) ? [`coca mudou ${d} (esperado +24)`] : [])];
  } },
  { id: "compra-sem-valor", falas: [{ texto: "comprei 5 kg de mussarela" }, { texto: "paguei 160" }], conferir: (e) => {
    const f: string[] = [];
    const primeira = e.respostas[0] || "";
    if (!/\?/.test(primeira)) f.push(`não perguntou o valor na 1ª: "${primeira.slice(0, 80)}"`);
    const d = qtdDe(e.depois, /mussarela/i) - qtdDe(e.antes, /mussarela/i);
    if (!perto(d, 5)) f.push(`mussarela mudou ${d} (esperado +5)`);
    if (e.acoes.filter((a) => a.nome === "registrar_compra" && (a.resultado as any)?.ok).length !== 1) f.push("lançou a compra mais de uma vez ou nenhuma");
    return f;
  } },
  { id: "despesa", falas: [{ texto: "paguei 120 de gás hoje" }], conferir: (e) => [
    ...(!ok(e.acoes, "registrar_despesa") ? ["não lançou a despesa"] : []),
    ...(chamou(e.acoes, "registrar_compra") ? ["lançou gás como compra de estoque"] : []),
  ] },
  { id: "conta-e-paga", falas: [{ texto: "boleto da distribuidora Bebidas Rio de 850 reais vence dia 10 de novembro" }, { texto: "paguei aquele boleto da distribuidora agora" }], conferir: (e) => [
    ...(!ok(e.acoes, "registrar_conta_a_pagar") ? ["não lançou a conta a pagar"] : []),
    ...(!ok(e.acoes, "marcar_conta_paga") ? ["não marcou a conta como paga"] : []),
    ...(chamou(e.acoes, "registrar_despesa") ? ["lançou despesa em vez de baixar a conta"] : []),
  ] },
  { id: "saida-e-desfaz", falas: [{ texto: "quebraram 2 coca lata aqui" }, { texto: "desfaz" }], conferir: (e) => {
    const f: string[] = [];
    if (!ok(e.acoes, "registrar_saida")) f.push("não lançou a saída");
    if (!ok(e.acoes, "desfazer_ultimo_registro")) f.push("não desfez");
    const d = qtdDe(e.depois, /coca/i) - qtdDe(e.antes, /coca/i);
    if (!perto(d, 0)) f.push(`coca terminou com ${d} (esperado 0 depois do desfaz)`);
    return f;
  } },
  { id: "pausa-lista-reativa", falas: [{ texto: "acabou a esfirra de calabresa, pausa ela" }, { texto: "o que tá pausado agora?" }, { texto: "voltou a calabresa, pode ativar" }], conferir: (e) => {
    const f: string[] = [];
    const pausou = e.acoes.find((a) => a.nome === "pausar_ou_reativar_itens" && (a.resultado as any)?.pausados);
    if (!pausou) f.push("não pausou");
    else if (((pausou.resultado as any).pausados as string[]).some((n) => !/calabresa/i.test(n))) f.push(`pausou outros itens: ${(pausou.resultado as any).pausados}`);
    if (!chamou(e.acoes, "listar_itens_pausados")) f.push("não consultou os pausados");
    if (!/calabresa/i.test(e.respostas[1] || "")) f.push("a lista de pausados não cita a calabresa");
    const calab = Object.entries(e.depois.ativo).filter(([n]) => /calabresa/i.test(n));
    if (calab.some(([, a]) => !a)) f.push("a calabresa terminou pausada");
    return f;
  } },
  { id: "pausa-tudo-de-esfirra", falas: [{ texto: "acabou a massa, pausa todas as esfirras" }], conferir: (e) => {
    const esf = Object.entries(e.depois.ativo).filter(([n]) => /esfirra/i.test(n));
    const f = esf.filter(([, a]) => a).map(([n]) => `${n} continuou ativa`);
    if (Object.entries(e.depois.ativo).some(([n, a]) => !/esfirra/i.test(n) && !a && e.antes.ativo[n])) f.push("pausou item que não é esfirra");
    return f;
  } },
  { id: "site", falas: [{ texto: "tô sem motoboy, fecha o site" }, { texto: "o motoboy chegou, pode abrir" }], conferir: (e) => [
    ...(e.acoes.filter((a) => a.nome === "abrir_ou_fechar_site" && (a.resultado as any)?.ok).length < 2 ? ["não fechou e abriu (2 chamadas)"] : []),
    ...(!e.depois.site ? ["o site terminou fechado"] : []),
    ...(!/ifood|99/i.test(e.respostas[0] || "") ? ["não avisou que iFood/99 seguem abertos"] : []),
  ] },
  { id: "consultas-sem-gravar", falas: [{ texto: "quanto tenho de coca lata?" }, { texto: "quanto vendi hoje?" }, { texto: "muda o preço da esfirra de carne pra 2,50" }], conferir: (e) => {
    const f: string[] = [];
    if (gravouAlgo(e.acoes).length) f.push(`gravou sem pedido: ${gravouAlgo(e.acoes)}`);
    const coca = qtdDe(e.antes, /coca/i);
    if (!new RegExp(`\\b${coca}\\b`).test(e.respostas[0] || "")) f.push(`não disse o estoque certo da coca (${coca}): "${(e.respostas[0] || "").slice(0, 90)}"`);
    if (!/painel/i.test(e.respostas[2] || "")) f.push("no pedido de preço não indicou o painel");
    return f;
  } },
  { id: "foto-da-nota", falas: [{ imagem: "nota.jpg", texto: "" }], conferir: (e) => {
    const f: string[] = [];
    const c = e.acoes.find((a) => a.nome === "registrar_compra" && (a.resultado as any)?.ok);
    if (!c) return ["não lançou a nota"];
    const fin = String((c.resultado as any).financeiro || "");
    if (!/128,62/.test(fin)) f.push(`financeiro: ${fin} (esperado R$ 128,62)`);
    const df = qtdDe(e.depois, /farinha/i) - qtdDe(e.antes, /farinha/i);
    if (!perto(df, 15)) f.push(`farinha mudou ${df} (esperado +15 kg: 3 × 5 kg) — conferir unidade`);
    return f;
  } },
  // Notas novas (número e valores diferentes): a nota.jpg repetida a cada rodada é, para o modelo, a mesma
  // compra lançada de novo — o Haiku percebeu e perguntou antes de duplicar.
  ...[
    { arq: "nota2.jpg", total: "220,07", itens: [[/mussarela/i, 2.5], [/caixa/i, 100]] as [RegExp, number][] },
    { arq: "nota3.jpg", total: "279,48", itens: [[/coca/i, 48]] as [RegExp, number][] },
    { arq: "nota4.jpg", total: "39,82", itens: [] as [RegExp, number][] },
    { arq: "nota5.jpg", total: "175,85", itens: [[/mussarela/i, 4]] as [RegExp, number][] },
    { arq: "nota6.jpg", total: "177,60", itens: [[/coca/i, 36]] as [RegExp, number][] },
    { arq: "nota7.jpg", total: "195,00", itens: [[/caixa/i, 200]] as [RegExp, number][] },
  ].map((n): Grupo => ({ id: `foto-${n.arq.replace(".jpg", "")}`, falas: [{ imagem: n.arq, texto: "" }], conferir: (e) => {
    const c = e.acoes.find((a) => a.nome === "registrar_compra" && (a.resultado as any)?.ok);
    if (!c) return ["não lançou a nota"];
    const f: string[] = [];
    const fin = String((c.resultado as any).financeiro || "");
    if (!fin.includes(n.total)) f.push(`financeiro: ${fin} (esperado R$ ${n.total})`);
    for (const [re, q] of n.itens) {
      const d = qtdDe(e.depois, re) - qtdDe(e.antes, re);
      if (!perto(d, q)) f.push(`${re.source} mudou ${d} (esperado +${q} no item cadastrado)`);
    }
    return f;
  } })),
  { id: "audio-compra", falas: [{ audio: "audio1.wav" }], conferir: (e) => {
    const d = qtdDe(e.depois, /caixa/i) - qtdDe(e.antes, /caixa/i);
    return [...(!ok(e.acoes, "registrar_compra") ? ["não lançou a compra do áudio"] : []), ...(!perto(d, 150) ? [`caixas mudaram ${d} (esperado +150)`] : [])];
  } },
  { id: "audio-pausa", falas: [{ audio: "audio2.wav" }], conferir: (e) => {
    const q = Object.entries(e.depois.ativo).filter(([n]) => /queijo/i.test(n));
    return [...(q.some(([, a]) => a) ? ["a esfirra de queijo continuou ativa"] : []), ...(Object.entries(e.depois.ativo).some(([n, a]) => !/queijo/i.test(n) && !a && e.antes.ativo[n]) ? ["pausou outro item"] : [])];
  } },
];

/** O Neon derruba conexão parada no meio da bateria ("Server has closed the connection"): tenta de novo. */
async function comTentativas<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= 4) throw e;
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

const estado = () => comTentativas(lerEstado);
const arrumarALoja = () => comTentativas(arrumar);

async function lerEstado(): Promise<Estado> {
  const [s, m, u, r] = await Promise.all([
    prisma.stockItem.findMany({ where: { franchiseeId: lojaId, active: true }, select: { name: true, quantity: true } }),
    prisma.menuProduct.findMany({ where: { franchiseeId: lojaId }, select: { name: true, active: true } }),
    prisma.user.findUnique({ where: { id: lojaId }, select: { storeOpen: true } }),
    prisma.assessorRegistro.findMany({ where: { franchiseeId: lojaId }, orderBy: { criadoEm: "asc" }, select: { tipo: true } }),
  ]);
  return {
    estoque: Object.fromEntries(s.map((x) => [x.name, Number(x.quantity)])),
    ativo: Object.fromEntries(m.map((x) => [x.name, x.active])),
    site: Boolean(u?.storeOpen),
    registros: r.map((x) => x.tipo),
  };
}

async function arrumar() {
  await prisma.assessorMensagem.deleteMany({ where: { franchiseeId: lojaId } });
  await prisma.menuProduct.updateMany({ where: { franchiseeId: lojaId }, data: { active: true } });
  await prisma.user.update({ where: { id: lojaId }, data: { storeOpen: true } });
  for (const i of ESTOQUE_INICIAL) {
    const ja = await prisma.stockItem.findFirst({ where: { franchiseeId: lojaId, name: i.name } });
    if (!ja) await prisma.stockItem.create({ data: { franchiseeId: lojaId, ...i } as any });
  }
}

const midia = (arq: string) => {
  const b = fs.readFileSync(path.join(MIDIA, arq));
  return { base64: b.toString("base64"), mimeType: arq.endsWith(".wav") ? "audio/wav" : "image/jpeg" };
};

async function main() {
  const loja = await prisma.user.findUnique({ where: { id: lojaId || "" }, select: { storeName: true } });
  if (!loja || !/teste/i.test(loja.storeName || "")) throw new Error(`loja ${lojaId} não é de teste ("${loja?.storeName}"): este script GRAVA`);
  console.log(`Loja de teste: ${loja.storeName}`);
  const placar: Record<string, { ok: number; total: number; falhas: string[]; ms: number[] }> = {};
  for (let rodada = 1; rodada <= RODADAS; rodada++) {
    for (const q of quais) {
      placar[q] ||= { ok: 0, total: 0, falhas: [], ms: [] };
      for (const g of GRUPOS.filter((g) => !filtro.length || filtro.includes(g.id))) {
        await arrumarALoja();
        const antes = await estado();
        const acoes: AcaoDoAssessor[] = [];
        const respostas: string[] = [];
        let erro = "";
        for (const fala of g.falas) {
          const t0 = Date.now();
          try {
            const r = await conversarComOAssessor(
              { franchiseeId: lojaId, usuarioId: lojaId, canal: "WHATSAPP", telefone: "5500000000000" },
              { texto: fala.texto || "", audio: fala.audio ? midia(fala.audio) : null, imagem: fala.imagem ? midia(fala.imagem) : null },
              { modelos: MODELOS[q] },
            );
            acoes.push(...r.acoes);
            respostas.push(r.resposta);
          } catch (e: any) {
            erro = e?.message || String(e);
          }
          placar[q].ms.push(Date.now() - t0);
        }
        const depois = await estado();
        const falhas = erro ? [`erro: ${erro}`] : g.conferir({ antes, depois, acoes, respostas });
        placar[q].total++;
        if (!falhas.length) placar[q].ok++;
        else placar[q].falhas.push(`${g.id}#${rodada}: ${falhas.join("; ")}`);
        console.log(`[${q} #${rodada}] ${falhas.length ? "FALHA" : "ok   "} ${g.id}${falhas.length ? " — " + falhas.join("; ") : ""}`);
        for (const [i, r] of respostas.entries()) console.log(`      ${g.falas[i]?.texto || g.falas[i]?.audio || g.falas[i]?.imagem} → ${r.replace(/\s+/g, " ").slice(0, 220)}`);
        console.log(`      ferramentas: ${acoes.map((a) => `${a.nome}:${(a.resultado as any)?.ok ? "ok" : "erro"}`).join(", ") || "nenhuma"} | registros novos: ${novos({ antes, depois }).join(", ") || "nenhum"}`);
      }
    }
  }
  await arrumarALoja();
  console.log("\nPLACAR");
  for (const [q, p] of Object.entries(placar)) {
    const ms = [...p.ms].sort((a, b) => a - b);
    console.log(`${q}: ${p.ok}/${p.total} grupos certos | tempo por fala: mediana ${ms[Math.floor(ms.length / 2)]} ms, pior ${ms.at(-1)} ms`);
    for (const f of p.falhas) console.log(`   - ${f}`);
  }
}

main()
  .catch((e) => {
    console.error(e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
