/**
 * BILL BUSCA NO SISTEMA (só leitura) — fase 1b do mapa de 18/11/2026
 * (Projetos/FireHub - Bill controla o sistema (mapa 18-11).md): "cadê o pedido
 * 32?", "quanto o João já gastou?", "o caixa de ontem fechou certo?", "quais
 * mesas estão abertas?", "a nota do pedido 15 saiu?", "o iFood está
 * conectado?", "qual foi meu lucro em outubro?", "onde eu mudo a impressora?".
 *
 * Cada ferramenta lê pela MESMA lib da tela, para o número bater com o painel:
 *
 *   buscar_pedido           → CustomerOrder da loja; itens por pedidoDoCliente e
 *                             o telefone pela ficha do cliente (lib/clientes-da-loja,
 *                             a aba Clientes); status/pagamento como nos Relatórios
 *                             (lib/relatorios/vendas)
 *   consultar_cliente       → listarClientes + detalheDoCliente (aba Clientes)
 *   consultar_caixa         → aberto: calcularEsperadoDoTurno + resumoDoCaixaAberto
 *                             (o "Movimentar caixa"); período: os caixas fechados
 *                             lidos como no Histórico de caixas (conferenciaGravada,
 *                             movimentacoesDosCaixas)
 *   consultar_mesas         → as sessões abertas e o saldo do quadro de Mesas
 *                             (api/store/tables, saldoDaMesaDoQuadro)
 *   consultar_notas_fiscais → a leitura de api/store/fiscal/invoices (emitida,
 *                             cancelada, falha, sem nota + porQueSemNota)
 *   status_das_integracoes  → só o que está gravado (vínculos e último pedido de
 *                             cada canal); nenhuma API de fora é chamada
 *   consultar_dre           → dadosDoPeriodoDoFinanceiro + calcularDRE, as mesmas
 *                             entradas da página do Financeiro (aba DRE)
 *   guia_do_sistema         → o menu lateral (lib/menu-do-painel) e os vídeos de
 *                             cada tela (lib/tutoriais): caminho de verdade, nunca
 *                             inventado
 *
 * Tudo pela loja do contexto (`ctx.franchiseeId`). Nenhuma ferramenta recebe id
 * da IA: a busca é por número, nome, telefone e data, sempre dentro da loja.
 */
import { Type } from "@google/genai";
import { prisma } from "@/lib/prisma";
import { diasNoPeriodo, hojeNaLoja, naLoja, somarDias, tipoDeVenda } from "@/lib/relatorios/base";
import { janelaDoPeriodo } from "@/lib/relatorios/janela";
import { pagamentoDoPedido, rotuloDoStatus } from "@/lib/relatorios/vendas";
import { canalDoPedido, chaveDoCanal } from "@/lib/canal-do-pedido";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { detalheDoCliente, listarClientes, pedidoDoCliente, type SessaoDosClientes } from "@/lib/clientes-da-loja";
import { calcularEsperadoDoTurno } from "@/lib/esperado-do-turno";
import { resumoDoCaixaAberto, lerQuemAbriu } from "@/lib/resumo-do-caixa-aberto";
import { conferenciaGravada } from "@/lib/conferencia-do-caixa";
import { movimentacoesDosCaixas, resumoDasMovimentacoes } from "@/lib/movimentacoes-do-caixa";
import { saldoDaMesaDoQuadro } from "@/lib/saldo-da-mesa";
import { TIPO_COMANDA } from "@/lib/comanda";
import { normalizarConfigFiscal } from "@/lib/fiscal-config";
import { porQueSemNota } from "@/lib/fiscal-modo";
import { lojas99DaConta } from "@/lib/food99-lojas";
import { lojaKeetaDoFranqueado } from "@/lib/keeta/lojas";
import { instalacoesDasLojas as instalacoesCardapioWeb } from "@/lib/cardapioweb/instalacoes";
import { instalacoesDasLojas as instalacoesAiqfome } from "@/lib/aiqfome/instalacoes";
import { lojasAnotaAiDaConta } from "@/lib/anotaai/lojas";
import { configDaFoody } from "@/lib/foody-no-banco";
import { dadosDoPeriodoDoFinanceiro } from "@/lib/financeiro/periodo-do-financeiro";
import { calcularDRE, diasDoMes, lerComissoesDosApps, lerTaxasDosApps } from "@/lib/financeiro/dre";
import { lojaIsenta } from "@/lib/billing";
import { MENU_DO_PAINEL } from "@/lib/menu-do-painel";
import { tutoriaisDaTela, tutorialPorId, type Tutorial } from "@/lib/tutoriais";
import type { ContextoDoAssessor } from "../ferramentas";
import { reais, semAcento, type ModuloDoBill, type Resultado } from "../modulo";

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const MES_RE = /^\d{4}-\d{2}$/;
const MAX_LINHAS = 20;
const FUSO_PADRAO = "America/Sao_Paulo";
const LINK_DOS_VIDEOS = "https://firehubfood.com.br/tutoriais";

const c2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const cancelado = (s: string | null | undefined) => (STATUS_CANCELADOS as readonly string[]).includes(String(s || "").toUpperCase());

/** Lista longa vira as primeiras linhas + quantas são (o modelo não precisa de 300 pedidos). */
function cortar<T>(lista: T[], n = MAX_LINHAS): { linhas: T[]; total: number; cortada?: string } {
  return { linhas: lista.slice(0, n), total: lista.length, ...(lista.length > n ? { cortada: `mostrando ${n} de ${lista.length}` } : {}) };
}

/** "18/11 21:05", no relógio da loja. */
function quando(d: Date | string | null | undefined, tz: string): string | null {
  if (!d) return null;
  return new Date(d).toLocaleString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", "");
}

/** O WhatsApp não manda o fuso no contexto: o da loja, como em relatorios.ts. */
async function fusoDaLoja(ctx: ContextoDoAssessor): Promise<string> {
  if (ctx.timezone) return ctx.timezone;
  const u = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { storeTimezone: true } });
  return u?.storeTimezone || FUSO_PADRAO;
}

/** O período pedido, no dia operacional (vira às 5h). Vazio = hoje. Exportada para o teste. */
export function periodoDaBusca(args: any, hoje: string, maxDias = 31): { de: string; ate: string } | { erro: string } {
  const de = DIA_RE.test(String(args?.de || "")) ? String(args.de) : hoje;
  let ate = DIA_RE.test(String(args?.ate || "")) ? String(args.ate) : de;
  if (de > hoje) return { erro: `O período começa no futuro (${de}); hoje é ${hoje}.` };
  if (ate > hoje) ate = hoje;
  if (ate < de) return { erro: "A data final vem antes da inicial." };
  if (diasNoPeriodo(de, ate) > maxDias) return { erro: `Período grande demais: até ${maxDias} dias por vez.` };
  return { de, ate };
}

// ── buscar_pedido ───────────────────────────────────────────────────────────

const CAMPOS_DO_PEDIDO = {
  id: true, dailyOrderNumber: true, createdAt: true, status: true, totalAmount: true, deliveryType: true,
  source: true, ifoodOrderId: true, ifoodReference: true, openDeliveryChannel: true, openDeliveryOrderId: true, openDeliveryReference: true,
  tableSessionId: true, totemLicenseId: true, paymentMethod: true, paymentMethods: true,
  customerName: true, customerPhone: true, deliveryBy: true, ifoodDriverName: true,
  acceptedAt: true, readyAt: true, dispatchedAt: true, deliveredAt: true, cancelledAt: true, cancelReason: true, cancelledBy: true,
  motoboy: { select: { name: true } },
  tableSession: { select: { id: true, status: true, paymentMethods: true, table: { select: { number: true, label: true } } } },
} as const;

/** Quem cancelou, como o lojista fala (o iFood manda RESTAURANT/IFOOD/CUSTOMER). */
function quemCancelou(bruto: string | null | undefined): string | null {
  const q = String(bruto || "").toUpperCase();
  if (!q) return null;
  if (q.includes("RESTAURANT") || q.includes("MERCHANT") || q.includes("LOJA")) return "a loja";
  if (q.includes("CUSTOMER") || q.includes("CLIENTE")) return "o cliente";
  if (q.includes("IFOOD")) return "o iFood";
  return String(bruto).toLowerCase();
}

function resumoDoPedido(p: any, tz: string) {
  const c = canalDoPedido(p);
  const mesa = p.tableSession?.table;
  const telefone = String(p.customerPhone || "").replace(/\D/g, "");
  return {
    numero: p.dailyOrderNumber != null ? `#${p.dailyOrderNumber}` : "—",
    noApp: c.referencia || undefined,
    feito: quando(p.createdAt, tz),
    status: rotuloDoStatus(p.status, tipoDeVenda(p)),
    canal: p.tableSessionId ? (mesa ? `Mesa ${mesa.label || mesa.number}` : "Mesa") : c.chave === "SITE" ? "Site" : c.nome,
    cliente: p.customerName || undefined,
    // O telefone do app é a central mascarada dele (o 99 manda o mesmo número para todo cliente).
    telefone: telefone && !/^0+$/.test(telefone) && !c.ehMarketplace ? p.customerPhone : undefined,
    total: reais(p.totalAmount),
    pagamento: pagamentoDoPedido(p, p.tableSession),
  };
}

async function detalheDoPedido(p: any, tz: string, sessao: SessaoDosClientes) {
  const d = await pedidoDoCliente(sessao, p.id);
  const motoboy = p.motoboy?.name || (p.ifoodDriverName ? `${p.ifoodDriverName} (entregador do iFood)` : p.deliveryBy === "IFOOD" ? "entregador do iFood" : null);
  return {
    ...resumoDoPedido(p, tz),
    itens: d?.itens.map((i) => `${i.qtd}x ${i.nome}${i.opcoes.length ? ` (${i.opcoes.map((o) => `${o.qtd > 1 ? `${o.qtd}x ` : ""}${o.nome}`).join(", ")})` : ""}${i.observacao ? ` — obs: ${i.observacao}` : ""} ${reais(i.total)}`),
    taxaDeEntrega: d?.taxaDeEntrega ? reais(d.taxaDeEntrega) : undefined,
    desconto: d?.desconto ? reais(d.desconto) : undefined,
    troco: d?.troco ? reais(d.troco) : undefined,
    endereco: d?.endereco || undefined,
    observacao: d?.observacao || undefined,
    motoboy: motoboy || undefined,
    horarios: {
      criado: quando(p.createdAt, tz), aceito: quando(p.acceptedAt, tz) || undefined, pronto: quando(p.readyAt, tz) || undefined,
      saiu: quando(p.dispatchedAt, tz) || undefined, entregue: quando(p.deliveredAt, tz) || undefined,
    },
    cancelamento: cancelado(p.status)
      ? { em: quando(p.cancelledAt, tz) || undefined, por: quemCancelou(p.cancelledBy) || undefined, motivo: p.cancelReason || "sem motivo gravado" }
      : undefined,
  };
}

async function sessaoDosClientesDoBill(ctx: ContextoDoAssessor, tz: string): Promise<SessaoDosClientes> {
  const loja = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { storeLoyalty: true } });
  return { lojaId: ctx.franchiseeId, quem: "Bill", storeLoyalty: loja?.storeLoyalty ?? null, fuso: tz };
}

async function buscarPedido(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const tz = await fusoDaLoja(ctx);
  const hoje = hojeNaLoja(tz);
  const data = DIA_RE.test(String(args?.data || "")) ? String(args.data) : null;
  if (data && data > hoje) return { ok: false, erro: `${data} ainda não chegou; hoje é ${hoje}.` };
  const numero = String(args?.numero ?? "").replace(/[^0-9a-z]/gi, "");
  const cliente = String(args?.cliente ?? "").trim();
  const loja = ctx.franchiseeId;
  let pedidos: any[] = [];
  let onde = "";

  if (numero) {
    // O número do dia (#32) e o número do app (iFood/99/Brendi…) — o dono fala dos dois.
    const n = /^\d{1,9}$/.test(numero) ? Number(numero) : null;
    const porNumero = { OR: [...(n != null ? [{ dailyOrderNumber: n }] : []), { ifoodReference: numero }, { ifoodReference: `#${numero}` }, { openDeliveryReference: numero }, { openDeliveryReference: `#${numero}` }] };
    const procurar = (de: string, ate: string) => {
      const j = janelaDoPeriodo(de, ate, tz);
      return prisma.customerOrder.findMany({ where: { franchiseeId: loja, createdAt: { gte: j.inicio, lt: j.fim }, ...porNumero }, select: CAMPOS_DO_PEDIDO, orderBy: { createdAt: "desc" }, take: 10 });
    };
    pedidos = await procurar(data || hoje, data || hoje);
    onde = `pedido ${numero} em ${data || `hoje (${hoje})`}`;
    // Sem data, o "pedido 32" pode ser de ontem (a numeração reinicia no fechamento do caixa).
    if (!pedidos.length && !data) {
      pedidos = await procurar(somarDias(hoje, -7), hoje);
      onde = `pedido ${numero} nos últimos 7 dias`;
    }
  } else if (cliente) {
    const digitos = cliente.replace(/\D/g, "");
    const sessao = await sessaoDosClientesDoBill(ctx, tz);
    if (digitos.length >= 10) {
      // Pelo telefone, a mesma chave da ficha do cliente (com e sem o 9).
      const ficha = await detalheDoCliente(sessao, digitos);
      const ids = (ficha?.pedidos || []).filter((x) => !data || naLoja(x.em, tz).dia === data).map((x) => x.id);
      pedidos = ids.length ? await prisma.customerOrder.findMany({ where: { id: { in: ids.slice(0, 50) }, franchiseeId: loja }, select: CAMPOS_DO_PEDIDO, orderBy: { createdAt: "desc" } }) : [];
      onde = `pedidos do telefone ${cliente}${data ? ` em ${data}` : ""}`;
    } else if (cliente.length >= 2) {
      const j = data ? janelaDoPeriodo(data, data, tz) : janelaDoPeriodo(somarDias(hoje, -30), hoje, tz);
      pedidos = await prisma.customerOrder.findMany({
        where: { franchiseeId: loja, createdAt: { gte: j.inicio, lt: j.fim }, customerName: { contains: cliente, mode: "insensitive" } },
        select: CAMPOS_DO_PEDIDO, orderBy: { createdAt: "desc" }, take: 60,
      });
      onde = `pedidos de "${cliente}" ${data ? `em ${data}` : "nos últimos 30 dias"}`;
    }
  }
  if (!numero && !cliente) return { ok: false, erro: "Diga o número do pedido, o nome ou o telefone do cliente." };
  if (!pedidos.length) return { ok: true, achados: 0, busca: onde, observacao: "Nenhum pedido encontrado. Pergunte a data ou outro dado (nome, telefone, número do app)." };

  // Poucos achados: vai o pedido inteiro (itens, motoboy, horários). Muitos: a lista para ele escolher.
  const sessao = await sessaoDosClientesDoBill(ctx, tz);
  if (pedidos.length <= 3) {
    return { ok: true, achados: pedidos.length, busca: onde, pedidos: await Promise.all(pedidos.map((p) => detalheDoPedido(p, tz, sessao))) };
  }
  return { ok: true, achados: pedidos.length, busca: onde, pedidos: cortar(pedidos.map((p) => resumoDoPedido(p, tz))), observacao: "Vários pedidos: pergunte qual e busque pelo número para ver itens e horários." };
}

// ── consultar_cliente ───────────────────────────────────────────────────────

async function consultarCliente(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const busca = String(args?.busca ?? "").trim();
  if (busca.length < 2) return { ok: false, erro: "Diga o nome ou o telefone do cliente." };
  const tz = await fusoDaLoja(ctx);
  const sessao = await sessaoDosClientesDoBill(ctx, tz);
  let telefone = busca.replace(/\D/g, "").length >= 10 ? busca : null;

  if (!telefone) {
    const { clientes, total } = await listarClientes(sessao, { q: busca, ordem: "pedidos", porPagina: 10 });
    if (!clientes.length) return { ok: true, encontrado: false, observacao: `Nenhum cliente com "${busca}" na loja.` };
    if (clientes.length > 1) {
      return {
        ok: true, encontrado: false, varios: total,
        clientes: clientes.map((c) => ({ nome: c.nome, telefone: c.telefone, pedidos: c.pedidos, gasto: reais(c.gasto), ultimo: quando(c.ultimo, tz), saldoCashback: c.saldo ? reais(c.saldo) : undefined })),
        observacao: "Mais de um cliente: pergunte qual (ou peça o telefone).",
      };
    }
    telefone = clientes[0].telefone;
  }

  const f = await detalheDoCliente(sessao, telefone);
  if (!f) return { ok: false, erro: "Telefone inválido: use DDD + número." };
  if (!f.encontrado) return { ok: true, encontrado: false, observacao: `O telefone ${telefone} nunca pediu nesta loja.` };
  const tr = f.fidelidade.trilha;
  const ca = f.fidelidade.carimbos;
  return {
    ok: true, encontrado: true,
    nome: f.nome, telefone: f.telefone, aniversario: f.aniversario || undefined, clienteDesde: quando(f.clienteDesde, tz),
    pedidos: f.numeros.pedidos, gasto: reais(f.numeros.gasto), ticketMedio: reais(f.numeros.ticketMedio),
    ultimoPedido: quando(f.numeros.ultimo, tz), cancelados: f.numeros.cancelados || undefined,
    ultimos: f.pedidos.slice(0, 5).map((p) => ({ numero: p.numero != null ? `#${p.numero}` : "—", em: quando(p.em, tz), total: reais(p.total), status: p.status, canal: p.canal })),
    enderecos: f.enderecos.slice(0, 3),
    cashback: f.cashback.ativo ? { saldo: reais(f.cashback.saldo), aReceber: f.cashback.aReceber ? reais(f.cashback.aReceber) : undefined, vence: f.cashback.proximoVencimento ? `${reais(f.cashback.proximoVencimento.valor)} em ${f.cashback.proximoVencimento.em}` : undefined } : undefined,
    trilha: tr ? { passos: tr.passos, faltam: tr.faltam, proximoPremio: tr.proxima?.premio, premioAReceber: tr.premioAReceber || undefined } : undefined,
    carimbos: ca ? { noCartao: ca.noCartao, meta: ca.meta, faltam: ca.faltam, premio: ca.premio } : undefined,
  };
}

// ── consultar_caixa ─────────────────────────────────────────────────────────

const comoFoi = (d: number | null) => (d == null ? "sem conferência" : Math.abs(d) < 0.01 ? "confere" : d < 0 ? `faltou ${reais(-d)}` : `sobrou ${reais(d)}`);

async function caixaAberto(s: any, ctx: ContextoDoAssessor, tz: string) {
  const turno = await calcularEsperadoDoTurno(ctx.franchiseeId, s);
  const r = resumoDoCaixaAberto(s, turno);
  const e = turno.expected;
  return {
    abertoEm: quando(r.abertoEm, tz), abertoPor: r.abertoPor?.nome || undefined, trocoInicial: reais(r.trocoInicial),
    vendas: { qtd: r.vendas.qtd, valor: reais(r.vendas.valor) },
    porForma: {
      dinheiro: reais(r.vendasEmDinheiro), pix: reais(e.pix), credito: reais(e.credit), debito: reais(e.debit), vale: reais(e.voucher),
      ...(turno.onlineProprio ? { onlineNoSite: reais(turno.onlineProprio) } : {}),
      ...(e.ifoodOnline ? { iFoodOnline: reais(e.ifoodOnline) } : {}),
      ...(e.food99Online ? { food99Online: reais(e.food99Online) } : {}),
    },
    reforcos: reais(r.entradas), sangrias: reais(r.saidas),
    dinheiroNaGaveta: reais(r.dinheiroNaGaveta),
    pendentes: turno.pendentesQuantidade ? `${turno.pendentesQuantidade} pedido(s) aguardando pagamento: ${reais(turno.pendentesValor)}` : undefined,
  };
}

async function consultarCaixa(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const tz = await fusoDaLoja(ctx);
  const hoje = hojeNaLoja(tz);
  const loja = ctx.franchiseeId;
  const abertos = await prisma.cashSession.findMany({ where: { franchiseeId: loja, status: "OPEN" }, orderBy: { openedAt: "desc" }, take: 5 });
  const agora = await Promise.all(abertos.map((s) => caixaAberto(s, ctx, tz)));

  const pediuPeriodo = DIA_RE.test(String(args?.de || "")) || DIA_RE.test(String(args?.ate || ""));
  const p = pediuPeriodo ? periodoDaBusca(args, hoje) : { de: somarDias(hoje, -1), ate: hoje };
  if ("erro" in p) return { ok: false, erro: p.erro };
  const j = janelaDoPeriodo(p.de, p.ate, tz);
  // Pelo dia operacional da ABERTURA, como lib/relatorios/caixas-do-periodo.ts.
  const fechados = await prisma.cashSession.findMany({
    where: { franchiseeId: loja, status: "CLOSED", openedAt: { gte: j.inicio, lt: j.fim } },
    orderBy: { openedAt: "desc" }, take: 100,
  });
  const movs = await movimentacoesDosCaixas(loja, fechados);
  const linhas = fechados.map((s) => {
    const conf = conferenciaGravada(s as any);
    const m = movs?.get(s.id);
    const mv = m ? resumoDasMovimentacoes(m) : null;
    return {
      abriu: quando(s.openedAt, tz), fechou: quando(s.closedAt, tz),
      abertoPor: lerQuemAbriu(s.abertoPor)?.nome || undefined,
      fechadoPor: String(s.closedBy || "").startsWith("sistema") ? "encerrado sozinho ao abrir outro caixa" : s.closedBy?.trim() || undefined,
      trocoInicial: reais(s.openingAmount), totalEsperado: reais(s.expectedTotal || 0),
      resultado: comoFoi(conf.diferenca), _dif: conf.diferenca,
      reforcos: mv && mv.entradas.qtd ? `${mv.entradas.qtd}x ${reais(mv.entradas.valor)}` : undefined,
      sangrias: mv && mv.retiradas.qtd ? `${mv.retiradas.qtd}x ${reais(mv.retiradas.valor)}` : undefined,
      justificativa: s.justification || undefined,
    };
  });
  const conferidos = linhas.filter((l) => l._dif != null);
  const soma = c2(conferidos.reduce((t, l) => t + (l._dif as number), 0));
  return {
    ok: true, hoje,
    abertoAgora: agora.length ? agora : "nenhum caixa aberto agora",
    fechados: {
      periodo: p, qtd: linhas.length,
      ...(conferidos.length ? { somaDasDiferencas: comoFoi(soma), comFalta: conferidos.filter((l) => (l._dif as number) < -0.009).length } : {}),
      semConferencia: linhas.length - conferidos.length || undefined,
      caixas: cortar(linhas.map(({ _dif, ...l }) => l)),
    },
  };
}

// ── consultar_mesas ─────────────────────────────────────────────────────────

async function consultarMesas(_args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const tz = await fusoDaLoja(ctx);
  const [sessoes, loja] = await Promise.all([
    prisma.tableSession.findMany({
      where: { franchiseeId: ctx.franchiseeId, status: "OPEN" },
      select: {
        id: true, openedAt: true, customerName: true, waiterName: true, pessoas: true, waiterTip: true, paymentMethods: true,
        table: { select: { number: true, label: true, tipo: true } },
        orders: { select: { status: true, totalAmount: true, dailyOrderNumber: true } },
      },
      orderBy: { openedAt: "asc" },
    }),
    prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { taxaServicoPadrao: true } }),
  ]);
  const agora = Date.now();
  // A conta é a do quadro de Mesas (api/store/tables): consumo sem os cancelados + a taxa da casa.
  const mesas = sessoes.map((s) => {
    const vivos = s.orders.filter((o) => !cancelado(o.status));
    const saldo = saldoDaMesaDoQuadro({ ...s, table: { ...s.table, franchisee: loja ?? undefined } });
    const minutos = Math.round((agora - s.openedAt.getTime()) / 60000);
    return {
      mesa: `${s.table.tipo === TIPO_COMANDA ? "Comanda" : "Mesa"} ${s.table.label || s.table.number}`,
      cliente: s.customerName || undefined, garcom: s.waiterName || undefined, pessoas: s.pessoas || undefined,
      abertaDesde: quando(s.openedAt, tz), tempo: minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`,
      pedidos: vivos.length, consumo: reais(vivos.reduce((t, o) => t + (o.totalAmount || 0), 0)),
      contaComTaxa: reais(saldo.total), ...(saldo.recebido ? { recebido: reais(saldo.recebido), falta: reais(saldo.falta) } : {}),
      _total: saldo.total, _falta: saldo.falta,
    };
  });
  return {
    ok: true, abertas: mesas.length,
    totalEmAberto: reais(mesas.reduce((t, m) => t + m._falta, 0)),
    mesas: cortar(mesas.map(({ _total, _falta, ...m }) => m)),
    ...(mesas.length ? {} : { observacao: "Nenhuma mesa aberta agora." }),
  };
}

// ── consultar_notas_fiscais ─────────────────────────────────────────────────

async function consultarNotasFiscais(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const tz = await fusoDaLoja(ctx);
  const hoje = hojeNaLoja(tz);
  const p = periodoDaBusca(args, hoje);
  if ("erro" in p) return { ok: false, erro: p.erro };
  const loja = await prisma.user.findUnique({ where: { id: ctx.franchiseeId }, select: { fiscalConfig: true } });
  const config = normalizarConfigFiscal(loja?.fiscalConfig);
  if (config.enabled !== true) return { ok: true, ligado: false, observacao: "A emissão de NFC-e está desligada nesta loja (Fiscal › Configurações)." };

  const j = janelaDoPeriodo(p.de, p.ate, tz);
  const pedidos = await prisma.customerOrder.findMany({
    where: { franchiseeId: ctx.franchiseeId, createdAt: { gte: j.inicio, lt: j.fim }, status: { notIn: ["CRIANDO_IA", "AGUARDANDO_PAGAMENTO"] } },
    select: {
      id: true, dailyOrderNumber: true, createdAt: true, status: true, totalAmount: true, fiscalStatus: true, fiscalInfo: true,
      deliveryType: true, tableSessionId: true, customerCpfCnpj: true, paymentMethod: true, paymentMethods: true, paymentPaidAt: true,
      source: true, openDeliveryChannel: true, openDeliveryOrderId: true, ifoodOrderId: true, ifoodReference: true, gatewayProvider: true,
    },
    orderBy: { createdAt: "desc" }, take: 5000,
  });

  // A mesma leitura da lista da tela Fiscal (api/store/fiscal/invoices): só o que a SEFAZ emitiu de verdade conta como nota.
  let emitidas = 0, valorEmitido = 0, contingencia = 0, canceladas = 0, processando = 0;
  const falhas: any[] = [];
  const vendaCanceladaComNota: string[] = [];
  const semNota = new Map<string, number>();
  for (const o of pedidos) {
    const f = (o.fiscalInfo as any) || {};
    const foiEmitida = o.fiscalStatus === "EMITTED" && Boolean(f.nfceKey);
    const num = o.dailyOrderNumber != null ? `#${o.dailyOrderNumber}` : o.id.slice(-5);
    if (foiEmitida) {
      emitidas++;
      valorEmitido += typeof f.valorDaNota === "number" ? f.valorDaNota : o.totalAmount || 0;
      if (f.contingencia === true) contingencia++;
      if (cancelado(o.status) && !f.devolucao) vendaCanceladaComNota.push(num);
    } else if (o.fiscalStatus === "CANCELED" && f.nfceKey) canceladas++;
    else if (f.processando) processando++;
    else if (f.ultimoErro) {
      const pend = Array.isArray(f.pendencias) && f.pendencias[0]?.mensagem ? ` (${f.pendencias[0].mensagem})` : "";
      falhas.push({ pedido: num, em: quando(o.createdAt, tz), total: reais(o.totalAmount), motivo: `${String(f.motivo || f.ultimoErro)}${pend}`.slice(0, 200) });
    } else if (!cancelado(o.status)) {
      const porque = f.semNotaAutomatica?.motivo ? String(f.semNotaAutomatica.motivo) : porQueSemNota(config, o as any)?.texto;
      if (porque) semNota.set(porque, (semNota.get(porque) || 0) + 1);
    }
  }
  const qtdSemNota = [...semNota.values()].reduce((t, n) => t + n, 0);
  return {
    ok: true, ligado: true, periodo: p,
    emitidas: { qtd: emitidas, valor: reais(valorEmitido), ...(contingencia ? { emContingencia: contingencia } : {}) },
    comFalha: falhas.length ? cortar(falhas) : 0,
    processandoNaSefaz: processando || undefined,
    notasCanceladas: canceladas || undefined,
    vendaCanceladaComNotaDePe: vendaCanceladaComNota.length ? { pedidos: vendaCanceladaComNota.slice(0, MAX_LINHAS), observacao: "Pedido cancelado com a nota ainda válida: cancele a nota ou registre a devolução em Fiscal." } : undefined,
    semNota: qtdSemNota ? { qtd: qtdSemNota, porque: [...semNota.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([motivo, qtd]) => ({ motivo, qtd })) } : 0,
  };
}

// ── status_das_integracoes ──────────────────────────────────────────────────

async function statusDasIntegracoes(_args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const tz = await fusoDaLoja(ctx);
  const id = ctx.franchiseeId;
  const nada = <T,>(v: T) => () => v;
  const [u, colunas, ifood, lojas99, keeta, cardapioweb, aiqfome, anotaai, foody, recentes] = await Promise.all([
    prisma.user.findUnique({ where: { id }, select: { storeOpen: true, ifoodConnected: true, ifoodMerchantId: true, food99Connected: true, jotajaConnected: true, chatbotConfig: true, printQueuePolledAt: true } }),
    // Colunas de garantir-colunas.ts que o cliente do Prisma não conhece (como em lib/atendimento/estado-da-loja.ts).
    prisma.$queryRaw<{ brendi: boolean | null; wabiz: boolean | null }[]>`SELECT "brendiConnected" AS brendi, "wabizConnected" AS wabiz FROM "User" WHERE id = ${id}`.catch(nada([] as { brendi: boolean | null; wabiz: boolean | null }[])),
    prisma.ifoodIntegration.findMany({ where: { userId: id, active: true }, select: { label: true, connected: true } }),
    lojas99DaConta(id),
    lojaKeetaDoFranqueado(id).catch(nada(null)),
    instalacoesCardapioWeb([id]).catch(nada([])),
    instalacoesAiqfome([id]).catch(nada([])),
    lojasAnotaAiDaConta([id]).catch(nada([])),
    configDaFoody(id).catch(nada(null)),
    prisma.customerOrder.findMany({
      where: { franchiseeId: id, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
      select: { createdAt: true, source: true, status: true, ifoodOrderId: true, ifoodReference: true, openDeliveryChannel: true, openDeliveryOrderId: true },
      orderBy: { createdAt: "desc" }, take: 5000,
    }),
  ]);
  if (!u) return { ok: false, erro: "Loja não encontrada." };

  // O último pedido de cada canal: é o sinal de que a integração está trazendo pedido.
  const porCanal = new Map<string, { qtd: number; ultimo: Date }>();
  for (const o of recentes) {
    const k = chaveDoCanal(o);
    const a = porCanal.get(k);
    if (a) a.qtd++;
    else porCanal.set(k, { qtd: 1, ultimo: o.createdAt });
  }
  const pedidosDe = (chave: string) => {
    const a = porCanal.get(chave);
    return a ? { pedidos7dias: a.qtd, ultimoPedido: quando(a.ultimo, tz) } : { pedidos7dias: 0 };
  };
  const extra = colunas[0] || { brendi: null, wabiz: null };
  const apps = [
    { app: "iFood", chave: "IFOOD", conectado: ifood.some((i) => i.connected) || (u.ifoodConnected && !!u.ifoodMerchantId), lojas: ifood.map((i) => `${i.label}${i.connected ? "" : " (desconectada)"}`) },
    { app: "99Food", chave: "99FOOD", conectado: lojas99.length > 0 || u.food99Connected, lojas: lojas99.map((l) => `${l.label || l.appShopId}${l.connected ? "" : " (desconectada)"}`) },
    { app: "Keeta", chave: "KEETA", conectado: !!keeta?.ativa, lojas: keeta?.ativa && keeta.nomeNaKeeta ? [keeta.nomeNaKeeta] : [] },
    { app: "Wabiz", chave: "WABIZ", conectado: extra.wabiz === true, lojas: [] },
    { app: "Brendi", chave: "BRENDI", conectado: extra.brendi === true, lojas: [] },
    { app: "Jotajá", chave: "JOTAJA", conectado: u.jotajaConnected, lojas: [] },
    { app: "CardápioWeb", chave: "CARDAPIOWEB", conectado: cardapioweb.length > 0, lojas: cardapioweb.map((l) => `${l.nome || l.companyId}${l.estado === "reconectar" ? ` (RECONECTAR${l.motivoDoEstado ? `: ${l.motivoDoEstado}` : ""})` : ""}`) },
    { app: "aiqfome", chave: "AIQFOME", conectado: aiqfome.length > 0, lojas: aiqfome.map((l) => `${l.nome || l.storeId}${l.estado === "reconectar" ? ` (RECONECTAR${l.motivoDoEstado ? `: ${l.motivoDoEstado}` : ""})` : ""}`) },
    { app: "Anota AI", chave: "ANOTAAI", conectado: anotaai.length > 0, lojas: anotaai.map((l) => `${l.nome || l.pageId}${l.ultimoErro ? ` (erro: ${l.ultimoErro.slice(0, 120)})` : ""}`) },
  ];
  const conectados = apps.filter((a) => a.conectado || porCanal.has(a.chave)).map(({ chave, lojas, ...a }) => ({ ...a, ...(lojas.length ? { lojas } : {}), ...pedidosDe(chave) }));
  const bot = (u.chatbotConfig as any) || {};
  const assistente = u.printQueuePolledAt ? Math.round((Date.now() - u.printQueuePolledAt.getTime()) / 60000) : null;
  return {
    ok: true,
    siteDaLoja: u.storeOpen ? "aberto para pedidos" : "FECHADO para pedidos",
    apps: conectados,
    naoConectados: apps.filter((a) => !a.conectado && !porCanal.has(a.chave)).map((a) => a.app),
    roboDoWhatsApp: bot.connected === true ? (bot.active === false ? "conectado, mas desligado" : "conectado") : bot.instanceName ? "desconectado" : "não configurado",
    entregaFoody: foody?.conectada ? "conectada" : undefined,
    assistenteDeImpressao: assistente == null ? "nunca conectou" : assistente <= 2 ? "ligado agora" : `sem contato há ${assistente < 120 ? `${assistente} min` : `${Math.round(assistente / 60)} h`}`,
    observacao: "Se a loja está aberta ou pausada DENTRO do iFood/99, o sistema não guarda: confira no app deles. Conectar/reconectar é em Configurações › Integrações.",
  };
}

// ── consultar_dre ───────────────────────────────────────────────────────────

async function consultarDre(args: any, ctx: ContextoDoAssessor): Promise<Resultado> {
  const dono = await prisma.user.findUnique({
    where: { id: ctx.franchiseeId },
    select: { storeTimezone: true, paymentFees: true, fixedCosts: true, financialGoals: true, email: true, planPercent: true, isFranqueadoHakim: true },
  });
  if (!dono) return { ok: false, erro: "Loja não encontrada." };
  const tz = ctx.timezone || dono.storeTimezone || FUSO_PADRAO;
  const hoje = hojeNaLoja(tz);
  // Sem nada = este mês até hoje (o "Este mês" da tela). "mes" = o mês inteiro.
  const mes = MES_RE.test(String(args?.mes || "")) ? String(args.mes) : null;
  const p = mes
    ? periodoDaBusca({ de: `${mes}-01`, ate: `${mes}-${String(diasDoMes(mes)).padStart(2, "0")}` }, hoje, 400)
    : DIA_RE.test(String(args?.de || "")) ? periodoDaBusca(args, hoje, 400) : { de: `${hoje.slice(0, 7)}-01`, ate: hoje };
  if ("erro" in p) return { ok: false, erro: p.erro };

  // As mesmas entradas que a página do Financeiro passa ao DREClient → calcularDRE.
  const [dados, despesas] = await Promise.all([
    dadosDoPeriodoDoFinanceiro({ lojaId: ctx.franchiseeId, tz, hoje, de: p.de, ate: p.ate, isenta: lojaIsenta(dono) }),
    // Sem garantirEstruturaDeDespesas: ela roda DDL, e aqui só se lê (a tabela nasce no boot).
    prisma.despesaLancada.findMany({ where: { franchiseeId: ctx.franchiseeId, dia: { gte: p.de, lte: p.ate } }, select: { dia: true, categoria: true, valor: true } })
      .catch(() => [] as { dia: string; categoria: string; valor: number }[]),
  ]);
  const custosFixos = (Array.isArray(dono.fixedCosts) ? (dono.fixedCosts as any[]) : [])
    .map((c) => ({ id: String(c?.id ?? ""), label: String(c?.label ?? ""), value: Number(c?.value) || 0 }))
    .filter((c) => c.label);
  const r = calcularDRE({ dados, custosFixos, despesas, comissoes: lerComissoesDosApps(dono.financialGoals), taxasDosApps: lerTaxasDosApps(dono.financialGoals), paymentFees: dono.paymentFees });

  return {
    ok: true, periodo: p,
    vendas: r.vendas, valorVendido: reais(r.valorVendido), ticketMedio: reais(r.ticketMedio), receitaDaLoja: reais(r.receitaDaLoja),
    porCanal: r.porCanal.slice(0, 8).map((c) => `${c.nome}: ${c.pedidos} pedidos, ${reais(c.valor)}`),
    cmv: reais(r.cmv), coberturaDoCusto: `${Math.round(r.cobertura * 100)}%`, lucroBruto: reais(r.lucroBruto),
    comissoesDosApps: reais(r.totalComissoes), taxasDePagamento: reais(r.totalTaxas), entregadores: reais(r.entregadores.total),
    margemDeContribuicao: reais(r.margemDeContribuicao),
    mensalidadeFireHub: r.mensalidade.isenta ? "isenta" : reais(r.mensalidade.total),
    despesas: reais(r.despesas.total), despesasPorCategoria: r.despesas.porCategoria.slice(0, 8).map(([c, v]) => `${c}: ${reais(v)}`),
    custosFixos: reais(r.custosFixos.total),
    resultado: reais(r.resultado), margemDoResultado: `${r.margens.resultado.toFixed(1).replace(".", ",")}%`,
    cancelados: r.cancelados.pedidos ? `${r.cancelados.pedidos} pedidos, ${reais(r.cancelados.valor)}` : undefined,
    completo: r.completo,
    ...(r.completo ? {} : { pendencias: r.pendencias.slice(0, 5), observacao: "O resultado ainda NÃO é lucro de verdade: falta o que está em pendencias. Diga isso ao dono." }),
    avisos: r.avisos.length ? r.avisos.slice(0, 3) : undefined,
  };
}

// ── guia_do_sistema ─────────────────────────────────────────────────────────

type TelaDoGuia = { caminho: string; href: string | null; rotulo: string; videos: Tutorial[] };

/** Telas que não moram no menu lateral, mas existem (barra do topo e botão do menu — StoreTopNav/StoreSidebar). */
const FORA_DO_MENU: { caminho: string; href: string | null; rotulo: string; videos: string[] }[] = [
  { caminho: "Barra do topo › botão Caixa (abrir, fechar, Movimentar caixa: sangria e reforço) — em qualquer tela", href: null, rotulo: "Caixa abrir fechar sangria reforço troco", videos: ["caixa"] },
  { caminho: "Barra do topo › botão Caixa › Ver histórico de caixas", href: "/store/caixa/historico", rotulo: "Histórico de caixas fechamento diferença", videos: ["caixa"] },
  { caminho: "Menu lateral › Modo Contingência (botão roxo abaixo de Tutoriais em vídeo)", href: "/store/contingencia", rotulo: "Modo Contingência internet caiu sistema fora", videos: ["contingencia"] },
];

const NAO_CONTAM = new Set([
  "onde", "como", "que", "qual", "quais", "quero", "queria", "mudo", "mudar", "muda", "trocar", "troco", "fica", "ficam", "faco", "fazer", "faz",
  "para", "pra", "por", "uma", "umas", "uns", "com", "sem", "meu", "minha", "meus", "minhas", "tela", "painel", "sistema", "firehub",
  "configurar", "configuro", "configuracao", "achar", "acho", "vejo", "ver", "posso", "consigo", "tem", "tenho", "cadastrar", "cadastro", "cadastra",
  "aceitar", "aceito", "aceita", "colocar", "coloco", "botar", "ativar", "ativo", "ligar", "ligo", "desligar", "aparecer", "aparece", "isso", "aqui", "dos", "das", "nos", "nas",
]);

const palavras = (t: string) => semAcento(t).split(/[^a-z0-9]+/).filter((p) => p.length >= 3);

/** Mesma palavra com outro final: garçom/garçons, cupom/cupons, impressora/impressoras. */
function parecida(a: string, b: string): boolean {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i >= Math.max(3, Math.min(5, a.length - 1));
}

function telasDoGuia(): TelaDoGuia[] {
  const videosDe = (ids: string[]) => ids.map((v) => tutorialPorId(v)).filter((t): t is Tutorial => !!t);
  const telas: TelaDoGuia[] = [];
  for (const g of MENU_DO_PAINEL) {
    for (const i of g.itens) {
      // Quem tem filhos (Minha loja) deixa os vídeos para eles: "pix" é Pagamento, não a tela inteira.
      const vs = i.filhos?.length ? [] : tutoriaisDaTela(i.href);
      telas.push({ caminho: `Menu › ${g.titulo} › ${i.label}`, href: i.href, rotulo: i.label, videos: vs });
      for (const f of i.filhos || []) {
        // O vídeo do filho de Minha loja é o do # (horarios, entrega…), quando existe.
        const hash = f.href.split("#")[1];
        const fv = hash ? videosDe([hash]) : tutoriaisDaTela(f.href);
        telas.push({ caminho: `Menu › ${g.titulo} › ${i.label} › ${f.label}`, href: f.href, rotulo: `${f.label} ${hash || ""}`, videos: fv });
      }
    }
  }
  for (const e of FORA_DO_MENU) {
    const vs = videosDe(e.videos);
    telas.push({ caminho: e.caminho, href: e.href, rotulo: e.rotulo, videos: vs });
  }
  return telas;
}

/** As telas que respondem ao assunto, da mais provável para a menos. Exportada para o teste (é pura). */
export function buscarNoGuia(assunto: string): { caminho: string; link: string | null; videos?: string[] }[] {
  const termos = palavras(assunto).filter((p) => !NAO_CONTAM.has(p));
  if (!termos.length) return [];
  const pontuadas = telasDoGuia().map((t) => {
    const doRotulo = palavras(t.rotulo);
    const doCaminho = palavras(t.caminho);
    const doTitulo = palavras(t.videos.map((v) => v.titulo).join(" "));
    const doCapitulo = palavras(t.videos.flatMap((v) => v.capitulos.map((c) => c.titulo)).join(" "));
    let pontos = 0;
    for (const termo of termos) {
      const casa = (lista: string[]) => lista.some((w) => parecida(termo, w));
      pontos += casa(doRotulo) ? 3 : casa(doTitulo) ? 2 : casa(doCaminho) ? 1.5 : casa(doCapitulo) ? 1 : 0;
    }
    return { t, pontos };
  });
  const melhor = Math.max(0, ...pontuadas.map((p) => p.pontos));
  if (melhor === 0) return [];
  return pontuadas
    .filter((p) => p.pontos >= melhor / 2)
    .sort((a, b) => b.pontos - a.pontos)
    .slice(0, 3)
    .map(({ t }) => ({
      caminho: t.caminho,
      link: t.href ? `https://firehubfood.com.br${t.href}` : null,
      ...(t.videos.length ? { videos: t.videos.slice(0, 2).map((v) => `${v.titulo}: ${LINK_DOS_VIDEOS}/${v.id}`) } : {}),
    }));
}

function guiaDoSistema(args: any): Resultado {
  const assunto = String(args?.assunto ?? "").trim();
  if (!assunto) return { ok: false, erro: "Diga o assunto (ex.: 'impressora', 'cadastrar garçom')." };
  const telas = buscarNoGuia(assunto);
  if (telas.length) return { ok: true, telas, observacao: "Responda com o caminho exato (e o vídeo, se houver). Não invente outro caminho." };
  return {
    ok: true, telas: [],
    menu: MENU_DO_PAINEL.map((g) => `${g.titulo}: ${g.itens.map((i) => i.label).join(", ")}`),
    observacao: "Nenhuma tela casou com o assunto. Use o menu acima para indicar a mais próxima, ou diga que não sabe onde fica.",
  };
}

// ── O módulo ────────────────────────────────────────────────────────────────

const PERIODO = {
  de: { type: Type.STRING, description: "Primeiro dia AAAA-MM-DD (dia de operação, vira às 5h). Vazio = hoje." },
  ate: { type: Type.STRING, description: "Último dia AAAA-MM-DD. Vazio = o mesmo de 'de'." },
};

export const MODULO_BUSCA: ModuloDoBill = {
  nome: "busca",
  gravam: [],
  regras: [
    "- Um pedido (\"cadê o 32\", \"pedido da Maria\", \"o 4521 do iFood\", \"quem levou o 15\", \"por que cancelou\"): buscar_pedido. Sem data = hoje.",
    "- Um cliente (quantos pedidos, quanto gastou, último pedido, saldo de cashback/carimbos): consultar_cliente.",
    "- Caixa aberto agora ou caixas de dias passados (diferença, sangria, reforço): consultar_caixa. Mesas abertas agora: consultar_mesas.",
    "- NFC-e (emitidas, com falha e por quê): consultar_notas_fiscais. Lucro/DRE do mês: consultar_dre. iFood/99/apps, robô e impressão conectados: status_das_integracoes.",
    "- \"Onde fica / como faço X no painel\" e tudo que nenhuma ferramenta faz: guia_do_sistema; responda com o caminho que voltou e o vídeo, nunca invente caminho.",
  ].join("\n"),
  declaracoes: [
    {
      name: "buscar_pedido",
      description: "Acha pedidos da loja pelo número (do dia ou do app iFood/99), pelo nome ou telefone do cliente. Volta status, itens, total, pagamento, canal, motoboy, horários e motivo do cancelamento.",
      parameters: {
        type: Type.OBJECT,
        properties: {
          numero: { type: Type.STRING, description: "Número do pedido (#32) ou do app (4521)." },
          cliente: { type: Type.STRING, description: "Nome ou telefone do cliente." },
          data: { type: Type.STRING, description: "Dia AAAA-MM-DD. Vazio = hoje (número) ou últimos 30 dias (nome)." },
        },
      },
    },
    {
      name: "consultar_cliente",
      description: "Ficha de um cliente da loja: pedidos, total gasto, ticket, último pedido, cashback, carimbos e trilha.",
      parameters: { type: Type.OBJECT, properties: { busca: { type: Type.STRING, description: "Nome ou telefone com DDD." } }, required: ["busca"] },
    },
    {
      name: "consultar_caixa",
      description: "O caixa aberto agora (vendas por forma, sangrias, dinheiro na gaveta) e os caixas fechados do período (diferença, quem abriu, sangrias). Vazio = ontem e hoje.",
      parameters: { type: Type.OBJECT, properties: PERIODO },
    },
    {
      name: "consultar_mesas",
      description: "Mesas e comandas abertas agora: valor da conta, quanto falta, garçom e há quanto tempo.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "consultar_notas_fiscais",
      description: "NFC-e do período: emitidas (quantidade e valor), com falha (pedido e motivo), sem nota e por quê.",
      parameters: { type: Type.OBJECT, properties: PERIODO },
    },
    {
      name: "status_das_integracoes",
      description: "Quais apps estão conectados (iFood, 99, Keeta, Wabiz, Brendi, Anota AI, aiqfome, CardápioWeb…), último pedido de cada um, site aberto/fechado, robô do WhatsApp e Assistente de impressão.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
    {
      name: "consultar_dre",
      description: "DRE do Financeiro: vendido, CMV, comissões, taxas, entregadores, despesas, custos fixos e resultado. Vazio = este mês até hoje.",
      parameters: {
        type: Type.OBJECT,
        properties: { mes: { type: Type.STRING, description: "Mês AAAA-MM (o mês inteiro)." }, ...PERIODO },
      },
    },
    {
      name: "guia_do_sistema",
      description: "Onde fica uma função no painel: devolve o caminho exato no menu, o link da tela e o vídeo do tutorial.",
      parameters: { type: Type.OBJECT, properties: { assunto: { type: Type.STRING, description: "Ex.: 'impressora', 'cadastrar garçom', 'horário'." } }, required: ["assunto"] },
    },
  ],
  async executar(nome, args, ctx) {
    switch (nome) {
      case "buscar_pedido": return buscarPedido(args, ctx);
      case "consultar_cliente": return consultarCliente(args, ctx);
      case "consultar_caixa": return consultarCaixa(args, ctx);
      case "consultar_mesas": return consultarMesas(args, ctx);
      case "consultar_notas_fiscais": return consultarNotasFiscais(args, ctx);
      case "status_das_integracoes": return statusDasIntegracoes(args, ctx);
      case "consultar_dre": return consultarDre(args, ctx);
      case "guia_do_sistema": return guiaDoSistema(args);
      default: return null;
    }
  },
};
