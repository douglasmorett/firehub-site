/**
 * MÓDULO CAIXA DO BILL — abrir o caixa, sangria/suprimento e fechar com o que
 * o dono contou ("abre o caixa com 100 de troco", "tirei 200 pro cofre",
 * "fecha o caixa: 850 em dinheiro, 1.200 no débito").
 *
 * Grava pelo MESMO caminho da tela (StoreTopNav › Movimentar caixa):
 *   abrir / fechar        → lib/abrir-e-fechar-o-caixa.ts, o corpo do POST/PUT
 *                           de api/cash-session (encerra turno pendurado, quem
 *                           abriu, esperado recalculado, pedidos da rua dados
 *                           por entregues, NFC-e, papel e aviso ao dono);
 *   sangria / suprimento  → a mesma gravação do POST api/cash-session/movimentacao
 *                           (mesma leitura do valor, mesmo turno do login).
 *
 * O operador é quem conversa com o Bill (o dono no WhatsApp; no painel, quem
 * está logado) e vai gravado como a tela grava para ele: o nome do login em
 * "quem abriu", closedBy, no papel e no aviso. Caixa por usuário ligado = o
 * caixa DESTE login, como na tela.
 *
 * Desfazer: só a sangria/suprimento, e só como a tela deixa (turno ainda
 * aberto, sem a senha do gerente pedida para isso). Abrir e fechar não se
 * desfazem por aqui.
 *
 * Teste: scripts/teste-bill-loja-e-caixa.ts
 */
import { Type } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { FUSO_PADRAO } from "@/lib/fuso";
import { abrirCaixa, fecharCaixa, ultimoCaixaFechado, type QuemMexeNoCaixa } from "@/lib/abrir-e-fechar-o-caixa";
import { caixaAbertoPara, caixaPorUsuarioLigado } from "@/lib/caixa-por-usuario";
import { calcularEsperadoDoTurno } from "@/lib/esperado-do-turno";
import { conferirFechamento, FORMAS_DA_CONFERENCIA, type ChaveDaConferencia } from "@/lib/conferencia-do-caixa";
import { quemEstaAbrindo } from "@/lib/resumo-do-caixa-aberto";
import { caixaCegoPara, conferirSenhaDoGerente } from "@/lib/senha-do-gerente";
import { temEstruturaDeCaixa, garantirEstruturaDeCaixa } from "@/lib/garantir-colunas";
import { lerValorEmReais } from "@/lib/lancamento-tardio-do-caixa";
import type { ContextoDoAssessor } from "../ferramentas";
import { PARAMETRO_CONFIRMADO, pedirConfirmacao, reais, registrarNoBill, type ModuloDoBill, type Resultado } from "../modulo";

const PELO_PAINEL = "desfaça pelo painel em Caixa.";

/** Quem conversa com o Bill, como a rota do caixa enxerga o login da sessão. */
async function operadorDoBill(ctx: ContextoDoAssessor) {
  const [u, loja] = await Promise.all([
    prisma.user.findUnique({ where: { id: ctx.usuarioId }, select: { id: true, name: true, email: true, ownerId: true, role: true } }),
    prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { storeTimezone: true } }),
  ]);
  if (!u) return null;
  const tz = ctx.timezone || loja?.storeTimezone || FUSO_PADRAO;
  const quemMexe: QuemMexeNoCaixa = { id: u.id, targetId: ctx.franchiseeId, storeTimezone: tz };
  return { u, tz, quemMexe, nome: u.name || u.email || "" };
}

const hora = (d: Date, tz: string) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz });

/** Valor dito pelo dono ("100", "150,50", "R$ 1.200"): a mesma leitura da sangria da tela. */
export function lerValor(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = lerValorEmReais(typeof v === "string" ? v.replace(/reais|real/gi, "") : v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/**
 * O texto da conferência antes de fechar: esperado × contado por forma, o que
 * fica sem conferir e a diferença — a mesma conta do fechamento
 * (conferirFechamento). No fechamento cego (funcionário), sem o esperado.
 */
export function textoDaConferencia(
  esperado: Record<ChaveDaConferencia, number>,
  contado: Record<ChaveDaConferencia, number | null>,
  cego: boolean,
): { linhas: string[]; diferenca: number | null; semConferencia: boolean } {
  const c = conferirFechamento(esperado, contado);
  // Forma sem venda e sem contagem não diz nada ao dono: fica fora da pergunta.
  const formas = cego ? FORMAS_DA_CONFERENCIA : FORMAS_DA_CONFERENCIA.filter((f) => contado[f.chave] != null || Math.abs(esperado[f.chave] || 0) > 0.005);
  const linhas = formas.map((f) => {
    const cont = contado[f.chave];
    if (cego) return `${f.nome}: ${cont == null ? "não conferido" : reais(cont)}`;
    return `${f.nome}: esperado ${reais(esperado[f.chave] || 0)}, contado ${cont == null ? "— (não conferido)" : reais(cont)}`;
  });
  if (!cego) {
    if (c.semConferencia) linhas.push("Sem conferência: nenhuma forma contada (fecha sem falta nem sobra gravada).");
    else if (c.diferenca != null) linhas.push(Math.abs(c.diferenca) < 0.01 ? "Diferença: bate certinho." : `Diferença: ${c.diferenca < 0 ? "faltam" : "sobram"} ${reais(Math.abs(c.diferenca))}.`);
  }
  return { linhas, diferenca: cego ? null : c.diferenca, semConferencia: c.semConferencia };
}

// ── ABRIR ───────────────────────────────────────────────────────────────────

async function abrir(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const op = await operadorDoBill(ctx);
  if (!op) return { ok: false, erro: "Não achei o seu login." };
  const porUsuario = await caixaPorUsuarioLigado(ctx.franchiseeId);
  const aberto = await caixaAbertoPara(ctx.franchiseeId, op.u.id, porUsuario);
  if (aberto) {
    // Abrir outro encerraria este sem ninguém conferir a gaveta (é o que a rota faz): recusa antes.
    return { ok: false, erro: `O caixa já está aberto desde ${hora(aberto.openedAt, op.tz)} com ${reais(aberto.openingAmount || 0)} de troco. Para abrir outro, feche este antes (fechar_caixa).` };
  }
  const troco = lerValor(args?.trocoInicial);
  if (troco == null || troco < 0) {
    const ultimo = await ultimoCaixaFechado(ctx.franchiseeId, op.u.id, porUsuario);
    const sugestao = ultimo?.closingCash != null ? ` No último fechamento ficaram ${reais(ultimo.closingCash)} contados na gaveta.` : "";
    return { ok: false, erro: `Faltou o troco inicial: pergunte quanto tem na gaveta para começar (0 se nada).${sugestao}` };
  }
  // Login de suporte (ADMIN) entra como "Suporte FireHub", como a rota faz com quem acessa a loja.
  const quem = quemEstaAbrindo(op.u, op.u.role === "ADMIN" ? { name: op.u.name } : null);
  const r = await abrirCaixa(op.quemMexe, troco, quem);
  const resumo = `Caixa aberto às ${hora(r.session.openedAt, op.tz)} com ${reais(troco)} de troco${porUsuario ? ` (caixa de ${quem.nome})` : ""}`;
  await registrarNoBill(ctx, "CAIXA_ABERTO", resumo, { sessionId: r.session.id });
  return { ok: true, resumo };
}

// ── SANGRIA / SUPRIMENTO ────────────────────────────────────────────────────

async function sangriaOuSuprimento(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const tipoDito = String(args?.tipo || "").toUpperCase();
  const tipo = tipoDito === "SANGRIA" ? "SAIDA" : tipoDito === "SUPRIMENTO" ? "ENTRADA" : null;
  if (!tipo) return { ok: false, erro: "Diga se é SANGRIA (dinheiro que sai da gaveta) ou SUPRIMENTO (dinheiro que entra)." };
  const valor = lerValor(args?.valor);
  if (valor == null || valor <= 0) return { ok: false, erro: "Informe um valor maior que zero." };
  if (valor > 1_000_000) return { ok: false, erro: "Valor acima do limite. Confira o que foi dito." };
  const op = await operadorDoBill(ctx);
  if (!op) return { ok: false, erro: "Não achei o seu login." };

  // Como a rota: cria a tabela na hora se o boot não conseguiu.
  if (!(await temEstruturaDeCaixa())) {
    await garantirEstruturaDeCaixa();
    if (!(await temEstruturaDeCaixa())) return { ok: false, erro: "O registro de sangria ainda não está disponível nesta loja. Tente de novo em alguns minutos." };
  }
  const turno = await caixaAbertoPara(ctx.franchiseeId, op.u.id);
  if (!turno) return { ok: false, erro: "O caixa está fechado. Abra o caixa antes de lançar sangria ou suprimento." };

  const motivo = String(args?.motivo ?? "").trim().slice(0, 200);
  const mov = await prisma.cashMovement.create({
    data: { cashSessionId: turno.id, franchiseeId: ctx.franchiseeId, tipo, valor, descricao: motivo || null, criadoPor: op.u.email || null },
  });
  const nome = tipo === "SAIDA" ? "Sangria" : "Suprimento";
  const resumo = `${nome} de ${reais(valor)} no caixa${motivo ? ` (${motivo})` : ""}`;
  await registrarNoBill(ctx, "CAIXA_MOVIMENTO", resumo, { movimentoId: mov.id, sessionId: turno.id });
  return { ok: true, resumo, observacao: `Entra no esperado do fechamento (${tipo === "SAIDA" ? "sai" : "entra"} da gaveta).` };
}

// ── FECHAR ──────────────────────────────────────────────────────────────────

const CHAVES_DITAS: Record<ChaveDaConferencia, string> = { cash: "dinheiro", debit: "debito", credit: "credito", pix: "pix", voucher: "vale" };

async function fechar(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const op = await operadorDoBill(ctx);
  if (!op) return { ok: false, erro: "Não achei o seu login." };
  const porUsuario = await caixaPorUsuarioLigado(ctx.franchiseeId);
  const aberto = await caixaAbertoPara(ctx.franchiseeId, op.u.id, porUsuario);
  if (!aberto) return { ok: false, erro: "Não há caixa aberto para fechar." };

  const contado = {} as Record<ChaveDaConferencia, number | null>;
  for (const [chave, dito] of Object.entries(CHAVES_DITAS) as [ChaveDaConferencia, string][]) {
    const v = lerValor(args?.[dito]);
    if (v != null && v < 0) return { ok: false, erro: `O valor contado de ${dito} não pode ser negativo.` };
    contado[chave] = v;
  }

  // A conferência é recalculada aqui só para a pergunta; o fechamento recalcula de novo no instante em que grava.
  const d = await calcularEsperadoDoTurno(ctx.franchiseeId, aberto);
  const esperado = { cash: d.expected.cash, debit: d.expected.debit, credit: d.expected.credit, pix: d.expected.pix, voucher: d.expected.voucher };
  const cego = await caixaCegoPara(op.u);
  const conf = textoDaConferencia(esperado, contado, cego);
  const naRua = porUsuario ? 0 : await prisma.customerOrder.count({ where: { franchiseeId: ctx.franchiseeId, status: "SAIU_ENTREGA", createdAt: { gte: aberto.openedAt }, tableSessionId: null } });
  const imprimir = args?.imprimir === true;

  const pergunta = pedirConfirmacao(
    args,
    [
      `Fechar o caixa aberto às ${hora(aberto.openedAt, op.tz)} (troco inicial ${reais(aberto.openingAmount || 0)}).`,
      ...conf.linhas,
      naRua ? `${naRua} pedido(s) ainda "saiu para entrega" serão dados por entregues junto.` : "",
      imprimir ? "Imprime o papel do fechamento." : "Não imprime o papel (diga se quiser).",
    ].filter(Boolean).join("\n"),
  );
  if (pergunta) return pergunta;

  // O corpo que a tela manda (StoreTopNav.doClose): em branco = null = não conferido.
  const r = await fecharCaixa(op.quemMexe, {
    closingCash: contado.cash, closingDebit: contado.debit, closingCredit: contado.credit, closingPix: contado.pix, closingVoucher: contado.voucher,
    expectedCash: d.expected.cash, expectedTotal: d.expected.total,
    justification: String(args?.justificativa || "").trim() || null,
    imprimir,
    caixaCego: cego,
  }, op.nome);

  const resultado = r.semConferencia
    ? "sem conferência"
    : r.difference == null ? "fechado"
    : Math.abs(r.difference) < 0.01 ? "bateu certinho"
    : `${r.difference < 0 ? "faltaram" : "sobraram"} ${reais(Math.abs(r.difference))}`;
  const resumo = `Caixa fechado (aberto às ${hora(aberto.openedAt, op.tz)}): ${resultado}`;
  await registrarNoBill(ctx, "CAIXA_FECHADO", resumo, { sessionId: aberto.id });
  return {
    ok: true,
    resumo,
    ...(r.conferido ? { conferido: { esperado: reais(r.conferido.esperado), contado: reais(r.conferido.contado) } } : {}),
    ...(r.impressao && !r.impressao.assistenteOuvindo ? { observacao: "O papel foi para a fila, mas o Assistente de impressão não está ligado no computador da loja." } : {}),
  };
}

// ── DESFAZER ────────────────────────────────────────────────────────────────

async function desfazer(tipo: string, refs: any, ctx: ContextoDoAssessor): Promise<Resultado | null> {
  if (tipo === "CAIXA_ABERTO") return { ok: false, erro: `Abrir o caixa não se desfaz por aqui; se abriu errado, feche ou ${PELO_PAINEL}` };
  if (tipo === "CAIXA_FECHADO") return { ok: false, erro: "Fechar o caixa não se desfaz por aqui; corrija o fechamento pelo painel em Caixa › Histórico." };
  if (tipo !== "CAIXA_MOVIMENTO") return null;

  // As mesmas travas do DELETE api/cash-session/movimentacao.
  const senha = await conferirSenhaDoGerente(ctx.franchiseeId, "desfazerLancamentoDoCaixa", null);
  if (!senha.ok) return { ok: false, erro: `Apagar sangria/suprimento pede a senha do gerente nesta loja; ${PELO_PAINEL}` };
  const turno = await caixaAbertoPara(ctx.franchiseeId, ctx.usuarioId);
  if (!turno || turno.id !== refs?.sessionId) return { ok: false, erro: "O caixa desse lançamento já foi fechado — não dá para apagar lançamento de turno já conferido." };
  const { count } = await prisma.cashMovement.deleteMany({ where: { id: String(refs?.movimentoId || ""), franchiseeId: ctx.franchiseeId, cashSessionId: turno.id } });
  if (count === 0) return { ok: false, erro: `Esse lançamento não está mais no caixa; ${PELO_PAINEL}` };
  return { ok: true };
}

// ── O MÓDULO ────────────────────────────────────────────────────────────────

const VALOR_CONTADO = (forma: string) => ({ type: Type.NUMBER, description: `quanto ele contou de ${forma}; omita se não contou (fica "não conferido"), 0 se contou e não tem nada` });

export const MODULO_CAIXA: ModuloDoBill = {
  nome: "caixa",
  declaracoes: [
    {
      name: "abrir_caixa",
      description: "Abre o caixa da loja com o troco inicial da gaveta ('abre o caixa com 100'). Se já houver caixa aberto, não abre outro.",
      parameters: { type: Type.OBJECT, properties: { trocoInicial: { type: Type.NUMBER, description: "dinheiro na gaveta ao abrir, em reais (0 = nada)" } }, required: ["trocoInicial"] },
    },
    {
      name: "sangria_ou_suprimento",
      description: "Lança no caixa aberto o dinheiro que SAI da gaveta (sangria: cofre, pagar motoboy, compra) ou que ENTRA (suprimento: reforço de troco).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          tipo: { type: Type.STRING, enum: ["SANGRIA", "SUPRIMENTO"] },
          valor: { type: Type.NUMBER },
          motivo: { type: Type.STRING, description: "para que foi (opcional)" },
        },
        required: ["tipo", "valor"],
      },
    },
    {
      name: "fechar_caixa",
      description:
        "Fecha o caixa com o que o dono CONTOU em cada forma. A 1ª chamada mostra esperado × contado e a diferença e pede confirmação; só fecha com confirmado=true. " +
        "Fechar também dá por entregues os pedidos que estão 'saiu para entrega'.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          dinheiro: VALOR_CONTADO("dinheiro (a gaveta inteira, com o troco inicial)"),
          debito: VALOR_CONTADO("débito"),
          credito: VALOR_CONTADO("crédito"),
          pix: VALOR_CONTADO("Pix"),
          vale: VALOR_CONTADO("vale-refeição"),
          justificativa: { type: Type.STRING, description: "explicação da diferença, se ele der" },
          imprimir: { type: Type.BOOLEAN, description: "true = imprime o papel do fechamento (omita = não imprime)" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
      },
    },
  ],
  gravam: ["abrir_caixa", "sangria_ou_suprimento", "fechar_caixa"],
  regras: `
"Abre o caixa com X" = abrir_caixa (sem valor dito, pergunte o troco). "Tirei X do caixa / pro cofre / paguei o motoboy" = sangria_ou_suprimento SANGRIA; "pus X de troco" = SUPRIMENTO.
"Fecha o caixa" = fechar_caixa com o que ele contou de cada forma (dinheiro é a gaveta inteira, com o troco). Forma que ele não contou fica de fora, nunca invente 0.
A 1ª chamada de fechar_caixa só mostra a conferência: leia para ele e chame de novo com confirmado=true depois do sim.
Abrir e fechar não se desfazem pelo Bill (só pelo painel em Caixa); a sangria/suprimento se desfaz enquanto o caixa estiver aberto.
`,
  tipos: ["CAIXA_ABERTO", "CAIXA_MOVIMENTO", "CAIXA_FECHADO"],
  executar: async (nome, args, ctx) => {
    switch (nome) {
      case "abrir_caixa": return abrir(args, ctx);
      case "sangria_ou_suprimento": return sangriaOuSuprimento(args, ctx);
      case "fechar_caixa": return fechar(args, ctx);
      default: return null;
    }
  },
  desfazer,
};
