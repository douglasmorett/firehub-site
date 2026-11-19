/**
 * BILL NO MARKETING — "cria um cupom VOLTA10 de 10% até domingo", "pausa o
 * cupom FRETE", "quem sumiu?", "quanto o 22 99999-0000 tem de cashback?",
 * "baixa o cashback para 3%".
 *
 * Douglas, 18/11/2026: "ele tem que conseguir buscar no sistema, ativar e usar
 * qualquer coisa pro dono de restaurante". Cada ferramenta grava pelo caminho
 * da tela:
 *
 *   cupons                → `storeCoupons` da loja, a lista que a tela de
 *                           cupons (Minha Loja › Cupons, StoreSettingsForm)
 *                           salva inteira pelo PUT api/store-settings; lida
 *                           por lib/cupons.ts, a régua do checkout e do robô
 *   clientes_sumidos      → a base da aba Clientes (lib/clientes-da-loja.ts,
 *                           `sqlDaBaseDeClientes`): só leitura
 *   cashback_e_fidelidade → a configuração (lib/cashback.ts e os programas) e
 *                           o saldo da ficha do cliente (`extratoDoCliente`):
 *                           só leitura
 *   mudar_cashback        → `storeLoyalty.cashbackActive`/`rate`, o liga e o
 *                           % da aba Fidelidade (o mesmo PUT), com confirmação
 *
 * Disparo de mensagem em massa NÃO entra: é só pelo módulo oficial.
 *
 * Teste: scripts/teste-bill-pedidos-e-marketing.ts
 */
import { Type } from "@google/genai";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { lerCupons, descreverBeneficio, cupomVenceu, type Cupom } from "@/lib/cupons";
import { lerCashback, ondeValeOCashback } from "@/lib/cashback";
import { extratoDoCliente, horaEmUtc } from "@/lib/cashback-no-banco";
import { lerTrilha, trilhaValida } from "@/lib/trilha-premiada";
import { carimbosNoAr, lerCarimbos } from "@/lib/carimbos";
import { lerIndicacao } from "@/lib/indicacao";
import { sqlDaBaseDeClientes } from "@/lib/clientes-da-loja";
import { chaveDoCliente } from "@/lib/clientes-da-loja-regras";
import { hojeNaLoja, fmtDia, naLoja, somarDias } from "@/lib/relatorios/base";
import { janelaDoPeriodo } from "@/lib/relatorios/janela";
import { entraNaVenda } from "@/lib/relatorios/regua-da-venda";
import { canalDoPedido } from "@/lib/canal-do-pedido";
import type { ContextoDoAssessor } from "../ferramentas";
import { pedirConfirmacao, PARAMETRO_CONFIRMADO, reais, registrarNoBill, type ModuloDoBill, type Resultado } from "../modulo";

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const c2 = (n: number) => Math.round(n * 100) / 100;

async function lojaDoMarketing(ctx: ContextoDoAssessor) {
  return prisma.user.findUnique({
    where: { id: ctx.franchiseeId },
    select: { storeCoupons: true, storeLoyalty: true, storeTimezone: true },
  });
}
const fusoDe = (ctx: ContextoDoAssessor, loja: { storeTimezone: string | null } | null) => ctx.timezone || loja?.storeTimezone || null;

// ── Cupons ──────────────────────────────────────────────────────────────────

/** A lista crua gravada (o que a tela salva), para mexer sem perder campo que o Bill não conhece. */
const listaCrua = (bruto: unknown): Record<string, unknown>[] => (Array.isArray(bruto) ? bruto.filter((c) => c && typeof c === "object") : []);
const codigoDe = (c: unknown) => String((c as any)?.code ?? "").trim().toUpperCase();

/** Como o dono lê um cupom. */
export function cupomParaDono(c: Cupom, hoje: string) {
  const regras = [
    c.minOrderValue > 0 ? `pedido mínimo ${reais(c.minOrderValue)}` : null,
    c.validade ? `${cupomVenceu(c, hoje) ? "venceu em" : "válido até"} ${fmtDia(c.validade)}` : "sem prazo",
    c.usosPorCliente > 0 ? `${c.usosPorCliente === 1 ? "1 vez" : `${c.usosPorCliente} vezes`} por cliente` : null,
    c.primeiroPedido ? "só no 1º pedido (o site aplica sozinho)" : null,
  ].filter(Boolean);
  return {
    codigo: c.code,
    desconto: descreverBeneficio(c),
    situacao: !c.active ? "pausado" : cupomVenceu(c, hoje) ? "vencido" : "ativo",
    regras: regras.join(" · "),
  };
}

/**
 * O cupom novo como a tela grava (StoreSettingsForm, `Coupon`), ou o porquê de
 * não dar. Pura: o teste prova cada recusa.
 */
export function novoCupom(args: any, existentes: unknown, hoje: string): { ok: true; cupom: Record<string, unknown> } | { ok: false; erro: string } {
  const code = String(args?.codigo || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return { ok: false, erro: "O código do cupom precisa ter de 3 a 30 letras ou números, sem espaço (ex.: VOLTA10)." };
  const lista = lerCupons(existentes);
  if (lista.some((c) => c.code === code)) return { ok: false, erro: `Já existe um cupom ${code}. Use outro código ou reative/apague o existente.` };

  const type = args?.tipo === "fixed" || args?.tipo === "free_shipping" ? args.tipo : "percent";
  const discount = type === "free_shipping" ? 0 : Number(String(args?.valor ?? "").replace(",", "."));
  if (type === "percent" && !(discount > 0 && discount <= 100)) return { ok: false, erro: "Diga a porcentagem do desconto (de 1 a 100)." };
  if (type === "fixed" && !(discount > 0)) return { ok: false, erro: "Diga o valor do desconto em reais." };

  const minimo = Number(String(args?.minimo ?? 0).replace(",", "."));
  if (!Number.isFinite(minimo) || minimo < 0) return { ok: false, erro: "Pedido mínimo inválido." };
  const validade = args?.validade ? String(args.validade) : null;
  if (validade && !DIA_RE.test(validade)) return { ok: false, erro: "Validade em YYYY-MM-DD." };
  if (validade && validade < hoje) return { ok: false, erro: `A validade ${fmtDia(validade)} já passou.` };
  const usos = Math.max(0, Math.floor(Number(args?.usosPorCliente) || 0));
  const primeiroPedido = args?.primeiroPedido === true;
  // A tela não deixa cadastrar o segundo: lib/cupons.ts lê só o primeiro ativo.
  if (primeiroPedido && lista.some((c) => c.active && c.primeiroPedido)) return { ok: false, erro: "A loja já tem um cupom de 1º pedido ativo: pause ou apague o outro antes." };

  return {
    ok: true,
    cupom: {
      code, discount, type, active: true,
      ...(minimo > 0 ? { minOrderValue: c2(minimo) } : {}),
      ...(validade ? { validade } : {}),
      ...(usos > 0 ? { usosPorCliente: usos } : {}),
      ...(primeiroPedido ? { primeiroPedido: true } : {}),
    },
  };
}

async function gravarCupons(ctx: ContextoDoAssessor, lista: Record<string, unknown>[]) {
  await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { storeCoupons: lista as any } });
}

async function cupons(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const loja = await lojaDoMarketing(ctx);
  if (!loja) return { ok: false, erro: "Loja não encontrada." };
  const hoje = hojeNaLoja(fusoDe(ctx, loja));
  const crua = listaCrua(loja.storeCoupons);
  const acao = String(args?.acao || "listar");

  if (acao === "listar") {
    const lista = lerCupons(crua).map((c) => cupomParaDono(c, hoje));
    return { ok: true, total: lista.length, cupons: lista, observacao: lista.length ? undefined : "A loja não tem cupom cadastrado." };
  }

  if (acao === "criar") {
    const r = novoCupom(args, crua, hoje);
    if (!r.ok) return r;
    await gravarCupons(ctx, [...crua, r.cupom]);
    const c = cupomParaDono(lerCupons([r.cupom])[0], hoje);
    const resumo = `Cupom ${c.codigo} criado: ${c.desconto} (${c.regras})`;
    await registrarNoBill(ctx, "MKT_CUPOM_CRIADO", resumo, { codigo: c.codigo });
    return { ok: true, resumo, observacao: "Vale no site e no robô do WhatsApp, em todas as formas de pagamento (para limitar a forma, é na tela de cupons)." };
  }

  const codigo = String(args?.codigo || "").trim().toUpperCase();
  const idx = crua.findIndex((c) => codigoDe(c) === codigo);
  if (idx < 0) return { ok: false, erro: `Não achei o cupom ${codigo || "(sem código)"}.`, cupons: lerCupons(crua).map((c) => c.code) };

  if (acao === "pausar" || acao === "reativar") {
    const ativo = acao === "reativar";
    const antes = crua[idx].active !== false;
    if (antes === ativo) return { ok: true, resumo: `O cupom ${codigo} já estava ${ativo ? "ativo" : "pausado"}.` };
    if (ativo && crua[idx].primeiroPedido === true && lerCupons(crua).some((c) => c.active && c.primeiroPedido)) {
      return { ok: false, erro: "Já tem outro cupom de 1º pedido ativo: pause o outro antes." };
    }
    await gravarCupons(ctx, crua.map((c, i) => (i === idx ? { ...c, active: ativo } : c)));
    const resumo = `Cupom ${codigo} ${ativo ? "reativado" : "pausado"}`;
    await registrarNoBill(ctx, ativo ? "MKT_CUPOM_REATIVADO" : "MKT_CUPOM_PAUSADO", resumo, { codigo, ativoAntes: antes });
    return { ok: true, resumo };
  }

  if (acao === "apagar") {
    const c = lerCupons([crua[idx]])[0];
    const pergunta = pedirConfirmacao(args, `Apagar o cupom ${codigo} (${c ? descreverBeneficio(c) : "cupom"})? Quem tiver o código não consegue mais usar.`);
    if (pergunta) return pergunta;
    await gravarCupons(ctx, crua.filter((_, i) => i !== idx));
    const resumo = `Cupom ${codigo} apagado`;
    await registrarNoBill(ctx, "MKT_CUPOM_APAGADO", resumo, { codigo, cupom: crua[idx], posicao: idx });
    return { ok: true, resumo };
  }

  return { ok: false, erro: "Ação de cupom: listar, criar, pausar, reativar ou apagar." };
}

// ── Clientes ────────────────────────────────────────────────────────────────

type ClienteDoBill = { nome: string | null; telefone: string; pedidos: number; gasto: string; ultimoPedido: string | null; diasSemPedir?: number };

async function clientesSumidos(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const loja = await lojaDoMarketing(ctx);
  const tz = fusoDe(ctx, loja);
  const dias = Math.min(365, Math.max(7, Math.floor(Number(args?.dias) || 30)));
  const limite = Math.min(30, Math.max(1, Math.floor(Number(args?.limite) || 10)));
  const agora = new Date();
  const hoje = hojeNaLoja(tz, agora);
  const desde = new Date(agora.getTime() - dias * 86_400_000);

  // A base da aba Clientes (mesma régua de pedido e a mesma chave DDD + 8).
  // O nome corrigido no "Editar cadastro" só entra se a tabela existir: o Bill
  // não cria tabela.
  const [{ existe }] = await prisma.$queryRaw<{ existe: boolean }[]>`SELECT to_regclass('"ClienteDaLoja"') IS NOT NULL AS existe`;
  type Linha = { tel: string; nome: string | null; pedidos: number; gasto: number; ultimo: Date | null };
  const sumidos = await prisma.$queryRaw<Linha[]>(Prisma.sql`
    ${sqlDaBaseDeClientes(ctx.franchiseeId, [], [], Boolean(existe))}
    SELECT c.tel, c.nome, c.pedidos, c.gasto, c.ultimo
    FROM clientes c
    WHERE c.pedidos > 0 AND c.ultimo < ${horaEmUtc(desde)}
    ORDER BY c.gasto DESC, c.pedidos DESC
    LIMIT ${limite}`);

  // Os melhores do período: os pedidos da janela (dia de operação), pela régua da venda.
  const { inicio, fim } = janelaDoPeriodo(somarDias(hoje, -(dias - 1)), hoje, tz);
  const pedidos = await prisma.customerOrder.findMany({
    where: { franchiseeId: ctx.franchiseeId, createdAt: { gte: inicio, lt: fim }, tableSessionId: null, ifoodOrderId: null },
    select: {
      status: true, totalAmount: true, reposicao: true, customerPhone: true, customerName: true, createdAt: true,
      source: true, openDeliveryChannel: true, openDeliveryOrderId: true,
    },
  });
  const porCliente = new Map<string, { telefone: string; nome: string | null; pedidos: number; gasto: number; ultimo: Date }>();
  for (const p of pedidos) {
    // Pedido de app (99, Keeta…) vem com o telefone do app, não do cliente: um
    // "cliente" do 99 somava 6.844 pedidos na loja medida em 19/11/2026.
    if (!entraNaVenda(p) || canalDoPedido(p).ehMarketplace) continue;
    const chave = chaveDoCliente(p.customerPhone);
    if (!chave) continue;
    const g = porCliente.get(chave) || { telefone: p.customerPhone, nome: null, pedidos: 0, gasto: 0, ultimo: p.createdAt };
    g.pedidos++;
    g.gasto += Number(p.totalAmount) || 0;
    if (p.createdAt >= g.ultimo) {
      g.ultimo = p.createdAt;
      if (p.customerName?.trim()) g.nome = p.customerName.trim();
    }
    porCliente.set(chave, g);
  }
  const melhores = [...porCliente.values()].sort((a, b) => b.gasto - a.gasto || b.pedidos - a.pedidos).slice(0, limite);

  const dia = (d: Date | null) => (d ? fmtDia(naLoja(d, tz).dia) : null);
  return {
    ok: true,
    periodo: `últimos ${dias} dias`,
    sumidos: sumidos.map((c): ClienteDoBill => ({
      nome: c.nome, telefone: c.tel, pedidos: Number(c.pedidos) || 0, gasto: reais(Number(c.gasto) || 0), ultimoPedido: dia(c.ultimo),
      diasSemPedir: c.ultimo ? Math.floor((agora.getTime() - new Date(c.ultimo).getTime()) / 86_400_000) : undefined,
    })),
    melhoresDoPeriodo: melhores.map((c): ClienteDoBill => ({ nome: c.nome, telefone: c.telefone, pedidos: c.pedidos, gasto: reais(c2(c.gasto)), ultimoPedido: dia(c.ultimo) })),
    observacao: "Sumidos: quem já pediu e não pede há mais que o período, do que mais gastou para o que menos (a mesma base da aba Clientes, fora mesa e iFood). Melhores: só pedidos próprios (site, robô, balcão), porque o telefone dos apps não é do cliente. Para chamar, o dono fala com cada um; disparo em massa é só pelo módulo oficial.",
  };
}

// ── Cashback e fidelidade ───────────────────────────────────────────────────

/** A configuração como o dono lê. Pura. */
export function fidelidadeParaDono(storeLoyalty: unknown) {
  const r = lerCashback(storeLoyalty);
  const trilha = lerTrilha(storeLoyalty);
  const carimbos = lerCarimbos(storeLoyalty);
  return {
    cashback: r.ativo
      ? {
          situacao: "ligado",
          percentual: `${r.taxa}%`,
          pedidoMinimo: r.minimo > 0 ? reais(r.minimo) : "sem mínimo",
          usoMaximo: `até ${r.maxResgatePct}% dos produtos`,
          validade: r.validadeDias > 0 ? `${r.validadeDias} dias` : "não vence",
          ondeVale: ondeValeOCashback(r.canais),
          niveisVip: r.vip ? `bronze +${r.vip.bronze}%, prata +${r.vip.prata}% (a partir de ${reais(r.vip.prataMinimo)} em 30 dias), ouro +${r.vip.ouro}% (${reais(r.vip.ouroMinimo)})` : undefined,
        }
      : { situacao: "desligado", percentualGravado: r.taxa > 0 ? `${r.taxa}%` : undefined },
    trilhaPremiada: trilhaValida(trilha) ? "ligada" : "desligada",
    cartaoDeCarimbos: carimbosNoAr(carimbos) ? "ligado" : "desligado",
    indiqueEGanhe: lerIndicacao(storeLoyalty).ativo ? "ligado" : "desligado",
  };
}

async function cashbackEFidelidade(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const loja = await lojaDoMarketing(ctx);
  if (!loja) return { ok: false, erro: "Loja não encontrada." };
  const config = fidelidadeParaDono(loja.storeLoyalty);
  const telefone = String(args?.telefone || "").replace(/\D/g, "");
  if (!telefone) return { ok: true, ...config, observacao: "Para o saldo de um cliente, mande o telefone dele." };
  if (telefone.length < 10) return { ok: false, erro: "Mande o telefone com DDD." };

  // O saldo da ficha do cliente (aba Clientes): o mesmo que o cardápio deixa usar.
  const tz = fusoDe(ctx, loja);
  const e = await extratoDoCliente(ctx.franchiseeId, loja.storeLoyalty, telefone);
  return {
    ok: true,
    ...config,
    cliente: {
      telefone,
      saldo: reais(e.saldo),
      aReceber: e.aReceber > 0 ? `${reais(e.aReceber)} (de pedidos ainda não entregues)` : undefined,
      proximoVencimento: e.proximoVencimento ? `${reais(e.proximoVencimento.valor)} vence em ${fmtDia(naLoja(e.proximoVencimento.em, tz).dia)}` : undefined,
      ultimosMovimentos: e.movimentos.slice(0, 5).map((m) => ({
        em: fmtDia(naLoja(m.em, tz).dia), valor: reais(m.valor), tipo: m.tipo.replace("_", " "),
        pedido: m.pedidoNumero ? `#${m.pedidoNumero}` : undefined, motivo: m.motivo || undefined,
      })),
    },
    observacao: config.cashback.situacao === "desligado" && e.saldo > 0 ? "O cliente tem saldo, mas o cashback está desligado: o cardápio não deixa usar." : undefined,
  };
}

async function mudarCashback(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const loja = await lojaDoMarketing(ctx);
  if (!loja) return { ok: false, erro: "Loja não encontrada." };
  const atual = (loja.storeLoyalty && typeof loja.storeLoyalty === "object" && !Array.isArray(loja.storeLoyalty) ? loja.storeLoyalty : {}) as Record<string, unknown>;
  const antes = { cashbackActive: atual.cashbackActive === true, rate: Number(atual.rate) || 0 };
  const depois = { ...antes };
  if (typeof args?.ativo === "boolean") depois.cashbackActive = args.ativo;
  if (args?.percentual !== undefined && args?.percentual !== null && args?.percentual !== "") {
    const pct = Number(String(args.percentual).replace(",", "."));
    if (!(pct > 0 && pct <= 100)) return { ok: false, erro: "O percentual do cashback vai de 0,1 a 100." };
    depois.rate = c2(pct);
  }
  if (depois.cashbackActive && depois.rate <= 0) return { ok: false, erro: "Para ligar, diga o percentual do cashback." };
  if (depois.cashbackActive === antes.cashbackActive && depois.rate === antes.rate) return { ok: true, resumo: "O cashback já estava assim.", ...fidelidadeParaDono(atual) };

  const txt = (v: typeof antes) => (v.cashbackActive ? `ligado com ${v.rate}%` : "desligado");
  const pergunta = pedirConfirmacao(args, `Cashback: de ${txt(antes)} para ${txt(depois)}? Vale para os próximos pedidos do site e do robô; o saldo que os clientes já têm continua.`);
  if (pergunta) return pergunta;

  // Mesma gravação da aba Fidelidade (o objeto inteiro em storeLoyalty), só com as duas chaves mudadas.
  await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { storeLoyalty: { ...atual, ...depois } as any } });
  const resumo = `Cashback ${txt(antes)} → ${txt(depois)}`;
  await registrarNoBill(ctx, "MKT_CASHBACK", resumo, { antes, depois });
  return { ok: true, resumo };
}

// ── Desfazer ────────────────────────────────────────────────────────────────

async function desfazer(tipo: string, refs: any, ctx: ContextoDoAssessor): Promise<Resultado | null> {
  if (!tipo.startsWith("MKT_")) return null;
  const loja = await lojaDoMarketing(ctx);
  if (!loja) return { ok: false, erro: "Loja não encontrada." };
  const crua = listaCrua(loja.storeCoupons);
  const codigo = String(refs?.codigo || "").toUpperCase();
  const idx = crua.findIndex((c) => codigoDe(c) === codigo);

  if (tipo === "MKT_CUPOM_CRIADO") {
    if (idx < 0) return { ok: false, erro: `O cupom ${codigo} já não existe.` };
    await gravarCupons(ctx, crua.filter((_, i) => i !== idx));
    return { ok: true };
  }
  if (tipo === "MKT_CUPOM_PAUSADO" || tipo === "MKT_CUPOM_REATIVADO") {
    if (idx < 0) return { ok: false, erro: `O cupom ${codigo} já não existe.` };
    await gravarCupons(ctx, crua.map((c, i) => (i === idx ? { ...c, active: refs.ativoAntes !== false } : c)));
    return { ok: true };
  }
  if (tipo === "MKT_CUPOM_APAGADO") {
    if (idx >= 0) return { ok: false, erro: `Já existe de novo um cupom ${codigo}: confira na tela de cupons.` };
    const lista = [...crua];
    lista.splice(Math.min(Number(refs.posicao) || 0, lista.length), 0, refs.cupom);
    await gravarCupons(ctx, lista);
    return { ok: true };
  }
  if (tipo === "MKT_CASHBACK") {
    const atual = (loja.storeLoyalty && typeof loja.storeLoyalty === "object" ? loja.storeLoyalty : {}) as Record<string, unknown>;
    // Mudou de novo depois do Bill (pela tela): não passa por cima.
    if ((atual.cashbackActive === true) !== refs.depois?.cashbackActive || (Number(atual.rate) || 0) !== refs.depois?.rate) {
      return { ok: false, erro: "O cashback mudou depois: ajuste pela aba Fidelidade." };
    }
    await prisma.user.update({ where: { id: ctx.franchiseeId }, data: { storeLoyalty: { ...atual, ...refs.antes } as any } });
    return { ok: true };
  }
  return null;
}

// ── O módulo ────────────────────────────────────────────────────────────────

export const MODULO_MARKETING: ModuloDoBill = {
  nome: "marketing",
  declaracoes: [
    {
      name: "cupons",
      description: "Cupons de desconto da loja (os da tela de cupons, que valem no site e no robô): listar, criar, pausar, reativar ou apagar.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          acao: { type: Type.STRING, enum: ["listar", "criar", "pausar", "reativar", "apagar"] },
          codigo: { type: Type.STRING, description: "o código do cupom (ex.: VOLTA10)" },
          tipo: { type: Type.STRING, enum: ["percent", "fixed", "free_shipping"], description: "criar: percent = % de desconto; fixed = R$ de desconto; free_shipping = frete grátis" },
          valor: { type: Type.NUMBER, description: "criar: a % ou os reais do desconto" },
          minimo: { type: Type.NUMBER, description: "criar: pedido mínimo em reais (omita = sem mínimo)" },
          validade: { type: Type.STRING, description: "criar: último dia que vale, YYYY-MM-DD (omita = sem prazo)" },
          usosPorCliente: { type: Type.NUMBER, description: "criar: quantas vezes o mesmo cliente pode usar (omita = sem limite)" },
          primeiroPedido: { type: Type.BOOLEAN, description: "criar: só para quem nunca pediu pelo site (o site aplica sozinho)" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
        required: ["acao"],
      },
    },
    {
      name: "clientes_sumidos",
      description: "Só leitura: clientes que já pediram e não pedem há X dias (os que mais gastaram primeiro) e os melhores clientes do mesmo período, para o dono chamar.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          dias: { type: Type.NUMBER, description: "o período em dias (padrão 30)" },
          limite: { type: Type.NUMBER, description: "quantos de cada lista (padrão 10, máx. 30)" },
        },
      },
    },
    {
      name: "cashback_e_fidelidade",
      description: "Só leitura: como estão o cashback, a trilha premiada, o cartão de carimbos e o indique e ganhe; com o telefone, o saldo de cashback do cliente.",
      parameters: {
        type: Type.OBJECT,
        properties: { telefone: { type: Type.STRING, description: "telefone do cliente com DDD, para ver o saldo dele" } },
      },
    },
    {
      name: "mudar_cashback",
      description: "Liga, desliga ou muda o % do cashback da loja (aba Fidelidade). Sempre pede confirmação.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          ativo: { type: Type.BOOLEAN, description: "true liga, false desliga; omita para só mudar o %" },
          percentual: { type: Type.NUMBER, description: "o novo % de cashback" },
          confirmado: PARAMETRO_CONFIRMADO,
        },
      },
    },
  ],
  gravam: ["cupons", "mudar_cashback"],
  regras: [
    "Cupom: confira com cupons acao=listar antes de pausar/reativar/apagar; apagar SEMPRE pergunta antes. Criar diz de volta o cupom como ficou.",
    "Cupom só tem: código, % ou R$ ou frete grátis, pedido mínimo, validade, usos por cliente e 1º pedido. Forma de pagamento e o resto, só na tela de cupons.",
    "clientes_sumidos e cashback_e_fidelidade só leem. Para chamar os clientes o dono fala com cada um; disparo em massa NÃO é pelo Bill (só pelo módulo oficial).",
    "mudar_cashback sempre pergunta antes (de quanto para quanto) e só com o sim vai com confirmado=true.",
    "Tudo de cupom e cashback se desfaz com desfazer_ultimo_registro.",
  ].join("\n"),
  tipos: ["MKT_CUPOM_CRIADO", "MKT_CUPOM_PAUSADO", "MKT_CUPOM_REATIVADO", "MKT_CUPOM_APAGADO", "MKT_CASHBACK"],
  executar: async (nome, args, ctx) => {
    if (nome === "cupons") return cupons(args, ctx);
    if (nome === "clientes_sumidos") return clientesSumidos(args, ctx);
    if (nome === "cashback_e_fidelidade") return cashbackEFidelidade(args, ctx);
    if (nome === "mudar_cashback") return mudarCashback(args, ctx);
    return null;
  },
  desfazer,
};
