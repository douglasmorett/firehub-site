/**
 * O PERFIL DA LOJA — as regras puras (sem banco). Pedido do Douglas, 18/10/2026:
 *
 *   "preciso que na tela de vendedor e no meu painel de adm também eu consiga
 *    ver o perfil de cada cliente (cada LOJA cliente do FireHub), quais
 *    funcionalidades ele usa, se está ativo ou não, para oferecermos para ele o
 *    que ele não usa! Preciso de relatórios melhores e mais detalhados sobre os
 *    clientes para os vendedores atuarem."
 *
 * O banco junta os SINAIS de cada loja (lib/perfil-da-loja/no-banco.ts, só
 * count/aggregate/groupBy); daqui saem, sem tocar no banco:
 *
 *   • o STATUS da atividade (ATIVA / ESFRIANDO / PARADA / NOVA), com o motivo;
 *   • o estado de CADA recurso do produto (usando / ligado / parado / nunca),
 *     com a evidência em número;
 *   • as OPORTUNIDADES — o que oferecer, por quê (o dado) e o argumento curto
 *     que o vendedor pode usar —, já em ordem;
 *   • os passos que faltam para a loja em teste ATIVAR;
 *   • o relatório da carteira (risco, oportunidades por produto, ranking).
 *
 * Testado em scripts/teste-perfil-da-loja.ts. Regra nova = mudar aqui e no teste.
 *
 * ── De onde vêm os números de venda ────────────────────────────────────────
 *
 * Da régua oficial (lib/relatorios/regua-da-venda.ts + base.ts; memória
 * auditoria-dos-numeros-out-2026): status fora da venda e reposição ficam de
 * fora, os períodos são dias OPERACIONAIS no fuso da loja (virando às 5h) e "30
 * dias" são 30 dias (periodoDoAtalho). VENDAS = atendimentos: a mesa conta uma
 * vez por conta (TableSession), o acréscimo (parentOrderId) não abre venda.
 * FATURAMENTO = Σ totalAmount desses pedidos (o "valor vendido" dos relatórios).
 */
import type { ChaveDeCanal } from "@/lib/canal-do-pedido";

// ═════════════════════════════════════════════════════════════════════════════
// TIPOS
// ═════════════════════════════════════════════════════════════════════════════

export type StatusDaAtividade = "ATIVA" | "ESFRIANDO" | "PARADA" | "NOVA";

/**
 * USANDO  — há evento com data nos últimos 30 dias (pedido, resposta, lançamento).
 * LIGADO  — configurado, mas o sistema não guarda evento de uso para medir (ex.: KDS sem pedido passando por ele ainda).
 * PARADO  — configurado/contratado, e nenhum uso nos últimos 30 dias.
 * NUNCA   — nunca configurou nem usou.
 */
export type EstadoDoRecurso = "USANDO" | "LIGADO" | "PARADO" | "NUNCA";

export type GrupoDoRecurso = "Canais de venda" | "Operação" | "Gestão" | "Clientes e marketing";

export type ChaveDoRecurso =
  | "cardapio" | "robo" | "ifood" | "food99" | "outrosMarketplaces" | "balcao" | "mesas" | "totem" | "appDaLoja" | "pagamentoOnline"
  | "kds" | "impressao" | "motoboys" | "appDoEntregador" | "contingencia"
  | "caixa" | "financeiro" | "estoque" | "fiscal" | "bill" | "firecheck"
  | "fidelidade" | "cupons" | "disparo" | "trafego" | "multimarcas" | "avaliacoes";

export type RecursoDoPerfil = {
  chave: ChaveDoRecurso;
  nome: string;
  grupo: GrupoDoRecurso;
  estado: EstadoDoRecurso;
  /** O dado que sustenta o estado, em português: "robô conectado, 230 respostas em 30 dias". */
  evidencia: string;
  /** Serviço pago à parte da mensalidade (Bill, App, Totem, Tráfego, Multimarcas, Disparo). */
  pago?: { contratado: boolean; valorMensal: number | null; rotuloDoValor?: string };
};

export type JanelaDeVendas = { vendas: number; valor: number };

export type VendasDoCanal = {
  canal: ChaveDeCanal;
  d7: JanelaDeVendas;
  d30: JanelaDeVendas;
  /** Os 30 dias antes dos últimos 30. */
  d30Anterior: JanelaDeVendas;
};

/**
 * Tudo o que o banco devolve de UMA loja. Contagens são dos últimos 30 dias
 * operacionais, salvo quando o nome diz outra coisa.
 */
export type SinaisDaLoja = {
  id: string;
  nome: string;
  dono: string | null;
  cidade: string | null;
  telefone: string | null;
  email: string;
  slug: string | null;
  logo: string | null;
  criadaEm: string;
  /** User.trialEndsAt (lib/fim-do-teste.ts). */
  testeAte: string | null;
  isenta: boolean;
  motivoDaIsencao: string | null;
  soDelivery: boolean;
  vendedor: { id: string; nome: string } | null;
  embaixador: { id: string; nome: string } | null;
  /** Lojas extras na mesma conta (aberta pelo "Nova loja"). */
  lojasNaConta: number;

  // ── Vendas (régua) ──
  vendasPorCanal: VendasDoCanal[];
  ultimaVendaEm: string | null;
  /** Pedido não cancelado mais recente de qualquer data (o "Uso" antigo); só para texto. */
  entregas30: number;
  entregasComMotoboy30: number;
  pagosOnlineNoCanalProprio30: number;
  comCashback30: number;
  comCupom30: number;
  passaramNoKds30: number;
  comNotaFiscal30: number;
  impressos30: number;

  // ── Cardápio ──
  produtos: number;
  categorias: number;

  // ── Robô ──
  roboConfigurado: boolean;
  respostasDoRobo30: number;
  /** Conversas com mensagem nos últimos 30 dias (ChatbotConversationState.lastMessageAt). */
  conversasDoRobo30: number;
  usosDeIa30: number;

  // ── Integrações ligadas ──
  integracoes: { ifood: boolean; food99: boolean; keeta: boolean; cardapioweb: boolean; jotaja: boolean; brendi: boolean };

  // ── Operação ──
  mesas: number;
  garcons: number;
  contasDeMesa30: number;
  kdsConfigurado: boolean;
  assistenteVistoEm: string | null;
  motoboys: number;
  aparelhosDoEntregador: number;
  contingenciaConfigurada: boolean;
  contingenciaUsada30: number;

  // ── Gestão ──
  caixas30: number;
  lancamentosFinanceiros30: number;
  itensDeEstoque: number;
  fichasTecnicas: number;
  movimentosDeEstoque30: number;
  fiscalConfigurado: boolean;
  firecheckLigado: boolean;
  descartesDoFirecheck30: number;

  // ── Clientes e marketing ──
  fidelidade: { cashback: boolean; carimbos: boolean; trilha: boolean };
  cuponsAtivos: number;
  clientesNaBase: number;
  avaliacoes30: number;

  // ── Serviços pagos ──
  bill: { ativo: boolean; valorMensal: number | null; usos30: number };
  appDaLoja: { ativo: boolean; valorMensal: number | null; pedidos30: number; aparelhos: number };
  totem: { licencasAtivas: number; valorMensal: number | null };
  trafego: { ativo: boolean; valorMensal: number | null; campanhasAtivas: number };
  multimarcas: { ativo: boolean; valorMensal: number | null };
  disparo: { conectado: boolean; campanhas30: number; saldo: number | null };
  pagamentoOnlineLigado: boolean;
  acompanhamentoIfood: boolean;

  // ── Mensalidade FireHub ──
  mensalidade: {
    mes: string;
    /** O que o ciclo do mês corrente já soma (OPEN = recalculado de hora em hora). */
    valorDoMes: number;
    situacaoDoMes: string;
    emAberto: { valor: number; meses: number; diasDeAtraso: number; boletoUrl: string | null } | null;
  };

  /** O último sinal de que alguém mexeu no painel (caixa aberto, Assistente, lançamento…). */
  ultimoSinalDoPainel: { em: string; oQue: string } | null;
};

export type Oportunidade = {
  chave: ChaveDaOportunidade;
  produto: string;
  /** VENDA = serviço pago (gera receita). ADOCAO = recurso incluído (segura o cliente). */
  tipo: "VENDA" | "ADOCAO";
  /** 0–100; a lista sai ordenada por isto. */
  prioridade: number;
  /** O dado que justifica, em uma frase. */
  motivo: string;
  /** O que o vendedor fala, curto. */
  argumento: string;
  /** Serviço pago: quanto entra por mês se fechar. */
  valorMensal: number | null;
};

export type ChaveDaOportunidade =
  | "APP_DA_LOJA" | "CARDAPIO_PROPRIO" | "ROBO" | "APP_DO_ENTREGADOR" | "ESTOQUE" | "BILL" | "FIDELIDADE"
  | "DISPARO" | "TRAFEGO" | "TOTEM" | "MULTIMARCAS" | "PAGAMENTO_ONLINE" | "FISCAL" | "KDS" | "MESAS" | "CUPONS";

export type PassoDaAtivacao = { chave: string; texto: string; feito: boolean; detalhe: string };

export type AtividadeDoPerfil = {
  status: StatusDaAtividade;
  motivo: string;
  ultimaVendaEm: string | null;
  diasSemVenda: number | null;
  d7: JanelaDeVendas;
  d30: JanelaDeVendas;
  d30Anterior: JanelaDeVendas;
  /** Variação das VENDAS de 30 dias contra os 30 anteriores, em %. null sem base. */
  tendenciaPct: number | null;
  ticketMedio30: number;
  canais: { canal: ChaveDeCanal; nome: string; vendas: number; valor: number; pct: number }[];
  emTeste: boolean;
  diasDeTeste: number;
};

export type PerfilDaLoja = {
  /** Produtos ativos de cardápio (sem o espelho das integrações) e se o cardápio está puxado. */
  cardapio: { produtos: number; puxado: boolean };
  loja: Pick<SinaisDaLoja, "id" | "nome" | "dono" | "cidade" | "telefone" | "email" | "slug" | "logo" | "criadaEm" | "vendedor" | "embaixador" | "lojasNaConta">;
  atividade: AtividadeDoPerfil;
  recursos: RecursoDoPerfil[];
  contagem: Record<EstadoDoRecurso, number>;
  servicosPagos: { chave: ChaveDoRecurso; nome: string; contratado: boolean; valorMensal: number | null; rotuloDoValor?: string }[];
  financeiro: {
    isenta: boolean;
    motivoDaIsencao: string | null;
    clienteDesde: string;
    testeAte: string | null;
    mensalidadeDoMes: { mes: string; valor: number; situacao: string };
    emAberto: SinaisDaLoja["mensalidade"]["emAberto"];
    servicosContratados: number;
    totalDosServicos: number;
  };
  oportunidades: Oportunidade[];
  ativacao: PassoDaAtivacao[] | null;
  ultimoSinalDoPainel: SinaisDaLoja["ultimoSinalDoPainel"];
  geradoEm: string;
};

/** O que a lista (admin › Lojistas, carteira do vendedor) precisa de cada loja — sem o detalhe dos recursos. */
export type ResumoDoPerfil = {
  id: string;
  /** Produtos ativos de cardápio e o selo "Cardápio puxado" × "SEM cardápio". */
  produtos: number;
  cardapioPuxado: boolean;
  nome: string;
  cidade: string | null;
  telefone: string | null;
  vendedor: { id: string; nome: string } | null;
  criadaEm: string;
  status: StatusDaAtividade;
  motivo: string;
  diasSemVenda: number | null;
  vendas30: number;
  valor30: number;
  valor30Anterior: number;
  tendenciaPct: number | null;
  canalPrincipal: string | null;
  usando: number;
  totalDeRecursos: number;
  oportunidades: Pick<Oportunidade, "chave" | "produto" | "tipo" | "prioridade" | "motivo" | "valorMensal">[];
  emTeste: boolean;
  diasDeTeste: number;
  ativacaoFalta: string[];
  emAberto: number;
  isenta: boolean;
};

// ═════════════════════════════════════════════════════════════════════════════
// CONSTANTES (as regras, em número)
// ═════════════════════════════════════════════════════════════════════════════

const DIA = 86_400_000;

/** Sem venda há este tanto de dias = PARADA. O mesmo número de DIAS_PARA_INATIVA (lib/atividade-da-loja.ts). */
export const DIAS_PARA_PARADA = 7;
/** Loja sem `trialEndsAt` conta como nova até este tanto de dias de cadastro (o selo "Teste" do admin). */
export const DIAS_DE_LOJA_NOVA = 15;
/** ESFRIANDO por queda: vendas de 30 dias ≤ 70% das dos 30 anteriores, com pelo menos 20 vendas de base. */
export const QUEDA_QUE_ESFRIA = 0.7;
export const BASE_MINIMA_DA_QUEDA = 20;
/** ESFRIANDO por semana fraca: últimos 7 dias ≤ 50% da média semanal dos 30 dias (com ≥ 20 vendas em 30 dias). */
export const SEMANA_FRACA = 0.5;
/** ESFRIANDO por sumiço: loja de ≥ 2 vendas/dia (60 em 30 dias) há 3+ dias sem vender. */
export const VENDAS_DE_LOJA_DIARIA = 60;
export const DIAS_DE_SUMICO = 3;
/**
 * CARDÁPIO PUXADO: a loja tem pelo menos 5 produtos ATIVOS de cardápio de
 * verdade — fora das categorias de integração (o espelho que o iFood/99/Keeta
 * criam a partir dos pedidos, `CATEGORIAS_DE_INTEGRACAO` em
 * lib/cardapio-interno.ts). Não importa se foi montado à mão, importado ou
 * copiado de marketplace: o que conta é o cardápio estar lá. Menos que isso =
 * "SEM cardápio" (a loja não tem o que vender pelo site, robô e mesa).
 */
export const PRODUTOS_PARA_CARDAPIO = 5;
export const cardapioPuxado = (produtos: number) => produtos >= PRODUTOS_PARA_CARDAPIO;
/** O critério em uma frase, para a tela e a planilha. */
export const CRITERIO_DO_CARDAPIO = `Cardápio puxado = pelo menos ${PRODUTOS_PARA_CARDAPIO} produtos ativos no cardápio da loja, sem contar o espelho que iFood, 99 e Keeta criam a partir dos pedidos.`;

/** Teste ativado: pelo menos este tanto de vendas. */
export const VENDAS_PARA_ATIVAR = 10;
/** Comissão de marketplace usada só na ESTIMATIVA do argumento do App (dito como estimativa). */
export const COMISSAO_ESTIMADA_DO_MARKETPLACE = 0.2;

const MARKETPLACES: ChaveDeCanal[] = ["IFOOD", "99FOOD", "KEETA", "BRENDI", "WABIZ", "JOTAJA"];

export const NOME_DO_CANAL: Record<ChaveDeCanal, string> = {
  IFOOD: "iFood", "99FOOD": "99Food", BRENDI: "Brendi", WABIZ: "Wabiz", JOTAJA: "Jotajá", KEETA: "Keeta",
  CARDAPIOWEB: "CardápioWeb", ANOTAAI: "Anota AI", WHATSAPP_IA: "Robô (WhatsApp)", PDV: "Balcão", TOTEM: "Totem", MESA: "Mesa",
  SITE: "Cardápio digital", DESCONHECIDO: "Outro",
};

// ═════════════════════════════════════════════════════════════════════════════
// FORMATOS
// ═════════════════════════════════════════════════════════════════════════════

export const brl = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
/** R$ sem centavos, para frase: "R$ 32.400". */
export const brl0 = (v: number) => "R$ " + Math.round(Number(v) || 0).toLocaleString("pt-BR");
const n = (v: number) => Math.round(v).toLocaleString("pt-BR");
const plural = (q: number, um: string, varios: string) => `${n(q)} ${q === 1 ? um : varios}`;

const vazio = (): JanelaDeVendas => ({ vendas: 0, valor: 0 });
const somar = (a: JanelaDeVendas, b: JanelaDeVendas): JanelaDeVendas => ({ vendas: a.vendas + b.vendas, valor: Math.round((a.valor + b.valor) * 100) / 100 });

export function totalDasJanelas(canais: VendasDoCanal[]): { d7: JanelaDeVendas; d30: JanelaDeVendas; d30Anterior: JanelaDeVendas } {
  return canais.reduce(
    (t, c) => ({ d7: somar(t.d7, c.d7), d30: somar(t.d30, c.d30), d30Anterior: somar(t.d30Anterior, c.d30Anterior) }),
    { d7: vazio(), d30: vazio(), d30Anterior: vazio() },
  );
}

const vendasDe = (s: SinaisDaLoja, canais: ChaveDeCanal[]) =>
  s.vendasPorCanal.filter((c) => canais.includes(c.canal)).reduce((t, c) => t + c.d30.vendas, 0);
const valorDe = (s: SinaisDaLoja, canais: ChaveDeCanal[]) =>
  s.vendasPorCanal.filter((c) => canais.includes(c.canal)).reduce((t, c) => t + c.d30.valor, 0);

// ═════════════════════════════════════════════════════════════════════════════
// STATUS DA ATIVIDADE
// ═════════════════════════════════════════════════════════════════════════════

export type EntradaDoStatus = {
  criadaEm: string | Date;
  testeAte: string | Date | null;
  ultimaVendaEm: string | Date | null;
  d7: JanelaDeVendas;
  d30: JanelaDeVendas;
  d30Anterior: JanelaDeVendas;
};

/** A loja está no período de teste? `trialEndsAt` no futuro; sem ele, cadastro há menos de 15 dias. */
export function lojaEmTeste(e: Pick<EntradaDoStatus, "criadaEm" | "testeAte">, agora: Date): { emTeste: boolean; dias: number } {
  if (e.testeAte) {
    const fim = new Date(e.testeAte).getTime();
    const resta = fim - agora.getTime();
    return { emTeste: resta > 0, dias: resta > 0 ? Math.ceil(resta / DIA) : 0 };
  }
  const idade = (agora.getTime() - new Date(e.criadaEm).getTime()) / DIA;
  const emTeste = idade < DIAS_DE_LOJA_NOVA;
  return { emTeste, dias: emTeste ? Math.max(0, Math.ceil(DIAS_DE_LOJA_NOVA - idade)) : 0 };
}

export function diasDesde(quando: string | Date | null, agora: Date): number | null {
  if (!quando) return null;
  return Math.max(0, Math.floor((agora.getTime() - new Date(quando).getTime()) / DIA));
}

export function tendencia(atual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}

/**
 * A regra do status, na ordem em que é decidida:
 *
 *  1. NOVA — está no teste (trialEndsAt no futuro; sem ele, cadastro < 15 dias).
 *     O trabalho do vendedor aqui é ATIVAR, não salvar.
 *  2. PARADA — nunca vendeu, ou está há 7+ dias sem venda.
 *  3. ESFRIANDO — vende, mas:
 *       a) as vendas de 30 dias caíram para ≤ 70% das dos 30 anteriores (com ≥ 20 de base), ou
 *       b) os últimos 7 dias ficaram em ≤ 50% da média semanal dos 30 (com ≥ 20 vendas em 30 dias), ou
 *       c) vendia ≥ 2 por dia (60 em 30 dias) e está há 3+ dias sem vender.
 *  4. ATIVA — o resto (vendeu nos últimos 7 dias e não caiu).
 */
export function statusDaAtividade(e: EntradaDoStatus, agora: Date): { status: StatusDaAtividade; motivo: string } {
  const teste = lojaEmTeste(e, agora);
  const dias = diasDesde(e.ultimaVendaEm, agora);
  const v30 = e.d30.vendas;
  const vAnt = e.d30Anterior.vendas;

  if (teste.emTeste) {
    const vendas = v30;
    const fase = vendas === 0 ? "ainda sem venda" : vendas >= VENDAS_PARA_ATIVAR ? `já ativada (${plural(vendas, "venda", "vendas")})` : `${plural(vendas, "venda", "vendas")} até agora`;
    return { status: "NOVA", motivo: `Em teste — ${plural(teste.dias, "dia restante", "dias restantes")}, ${fase}.` };
  }

  if (dias === null) return { status: "PARADA", motivo: "Saiu do teste e nunca vendeu pelo sistema." };
  if (dias >= DIAS_PARA_PARADA) {
    const antes = vAnt > 0 ? ` Nos 30 dias anteriores foram ${plural(vAnt, "venda", "vendas")}.` : "";
    return { status: "PARADA", motivo: `Sem venda há ${dias} dias.${antes}` };
  }

  if (vAnt >= BASE_MINIMA_DA_QUEDA && v30 <= vAnt * QUEDA_QUE_ESFRIA) {
    const queda = Math.round((1 - v30 / vAnt) * 100);
    return { status: "ESFRIANDO", motivo: `Vendas caíram ${queda}% — ${n(v30)} nos últimos 30 dias contra ${n(vAnt)} nos 30 anteriores.` };
  }
  const mediaSemanal = (v30 * 7) / 30;
  if (v30 >= BASE_MINIMA_DA_QUEDA && e.d7.vendas <= mediaSemanal * SEMANA_FRACA) {
    return { status: "ESFRIANDO", motivo: `Semana fraca — ${plural(e.d7.vendas, "venda", "vendas")} em 7 dias, menos da metade da média (${n(mediaSemanal)} por semana).` };
  }
  if (v30 >= VENDAS_DE_LOJA_DIARIA && dias >= DIAS_DE_SUMICO) {
    return { status: "ESFRIANDO", motivo: `Vendia ~${n(v30 / 30)} por dia e está há ${dias} dias sem venda.` };
  }

  const t = tendencia(v30, vAnt);
  const tt = t === null ? "" : t >= 0 ? ` (+${t}% contra os 30 dias anteriores)` : ` (${t}% contra os 30 dias anteriores)`;
  return { status: "ATIVA", motivo: `${plural(v30, "venda", "vendas")} em 30 dias${tt}.` };
}

// ═════════════════════════════════════════════════════════════════════════════
// RECURSOS
// ═════════════════════════════════════════════════════════════════════════════

const estado = (usou: boolean, configurado: boolean, mede = true): EstadoDoRecurso =>
  usou ? "USANDO" : configurado ? (mede ? "PARADO" : "LIGADO") : "NUNCA";

/** O estado de cada recurso do produto, com a evidência. Ordem = a do menu do painel. */
export function recursosDaLoja(s: SinaisDaLoja, agora: Date): RecursoDoPerfil[] {
  const v = (c: ChaveDeCanal) => vendasDe(s, [c]);
  const site = v("SITE");
  const robo = v("WHATSAPP_IA");
  const ifood = v("IFOOD");
  const f99 = v("99FOOD");
  const outros: { nome: string; ligado: boolean; vendas: number }[] = [
    { nome: "Keeta", ligado: s.integracoes.keeta, vendas: v("KEETA") },
    { nome: "CardápioWeb", ligado: s.integracoes.cardapioweb, vendas: v("CARDAPIOWEB") },
    { nome: "Jotajá", ligado: s.integracoes.jotaja, vendas: v("JOTAJA") },
    { nome: "Brendi", ligado: s.integracoes.brendi, vendas: v("BRENDI") },
    { nome: "Wabiz", ligado: false, vendas: v("WABIZ") },
  ];
  const outrosVendas = outros.reduce((t, o) => t + o.vendas, 0);
  const outrosLigados = outros.filter((o) => o.ligado || o.vendas > 0);
  const balcao = v("PDV");
  const totem = v("TOTEM");
  const assistenteDias = diasDesde(s.assistenteVistoEm, agora);
  const lista: RecursoDoPerfil[] = [];
  const add = (r: RecursoDoPerfil) => lista.push(r);

  // ── Canais de venda ──
  add({
    chave: "cardapio", nome: "Cardápio digital (site)", grupo: "Canais de venda",
    estado: estado(site > 0, s.produtos > 0),
    evidencia: s.produtos === 0 ? "Nenhum produto cadastrado."
      : `${plural(s.produtos, "produto", "produtos")} em ${plural(s.categorias, "categoria", "categorias")} · ${plural(site, "venda", "vendas")} pelo site em 30 dias.`,
  });
  add({
    chave: "robo", nome: "Robô do WhatsApp (IA)", grupo: "Canais de venda",
    estado: estado(s.respostasDoRobo30 > 0 || robo > 0, s.roboConfigurado),
    evidencia: s.respostasDoRobo30 > 0 || robo > 0
      ? `${s.roboConfigurado ? "Conectado · " : ""}${plural(s.conversasDoRobo30, "conversa", "conversas")}, ${plural(s.respostasDoRobo30, "resposta enviada", "respostas enviadas")} e ${plural(robo, "venda fechada", "vendas fechadas")} pelo robô em 30 dias.`
      : s.roboConfigurado ? "Configurado, mas não respondeu ninguém em 30 dias." : "Nunca configurou o robô.",
  });
  add({
    chave: "ifood", nome: "iFood integrado", grupo: "Canais de venda",
    estado: estado(ifood > 0, s.integracoes.ifood),
    evidencia: ifood > 0 ? `${plural(ifood, "venda", "vendas")} do iFood em 30 dias (${brl0(valorDe(s, ["IFOOD"]))}).`
      : s.integracoes.ifood ? "Integração ligada, nenhum pedido em 30 dias." : "Não integrou o iFood.",
  });
  add({
    chave: "food99", nome: "99Food integrado", grupo: "Canais de venda",
    estado: estado(f99 > 0, s.integracoes.food99),
    evidencia: f99 > 0 ? `${plural(f99, "venda", "vendas")} do 99Food em 30 dias (${brl0(valorDe(s, ["99FOOD"]))}).`
      : s.integracoes.food99 ? "Integração ligada, nenhum pedido em 30 dias." : "Não integrou o 99Food.",
  });
  add({
    chave: "outrosMarketplaces", nome: "Outras integrações (Keeta, CardápioWeb, Jotajá, Brendi)", grupo: "Canais de venda",
    estado: estado(outrosVendas > 0, outrosLigados.length > 0),
    evidencia: outrosLigados.length === 0 ? "Nenhuma ligada."
      : outrosLigados.map((o) => `${o.nome}: ${o.vendas > 0 ? plural(o.vendas, "venda", "vendas") : "ligada, sem pedido"}`).join(" · "),
  });
  add({
    chave: "balcao", nome: "Balcão / PDV", grupo: "Canais de venda",
    estado: estado(balcao > 0, false),
    evidencia: balcao > 0 ? `${plural(balcao, "venda", "vendas")} no balcão em 30 dias.` : "Nenhuma venda de balcão em 30 dias.",
  });
  add({
    chave: "mesas", nome: "Mesas e garçom", grupo: "Canais de venda",
    estado: estado(s.contasDeMesa30 > 0, s.mesas > 0 || s.garcons > 0),
    evidencia: s.contasDeMesa30 > 0 ? `${plural(s.contasDeMesa30, "conta de mesa", "contas de mesa")} em 30 dias · ${plural(s.mesas, "mesa", "mesas")}, ${plural(s.garcons, "garçom", "garçons")}.`
      : s.mesas > 0 || s.garcons > 0 ? `${plural(s.mesas, "mesa cadastrada", "mesas cadastradas")}, nenhuma conta em 30 dias.`
      : s.soDelivery ? "Loja só de delivery." : "Nenhuma mesa cadastrada.",
  });
  add({
    chave: "totem", nome: "Totem de autoatendimento", grupo: "Canais de venda",
    estado: estado(totem > 0, s.totem.licencasAtivas > 0),
    evidencia: s.totem.licencasAtivas > 0
      ? `${plural(s.totem.licencasAtivas, "licença ativa", "licenças ativas")} · ${plural(totem, "venda", "vendas")} em 30 dias.`
      : "Sem totem.",
    pago: { contratado: s.totem.licencasAtivas > 0, valorMensal: s.totem.valorMensal },
  });
  add({
    chave: "appDaLoja", nome: "App próprio da loja", grupo: "Canais de venda",
    estado: estado(s.appDaLoja.pedidos30 > 0, s.appDaLoja.ativo),
    evidencia: s.appDaLoja.ativo
      ? `Plano ativo · ${plural(s.appDaLoja.aparelhos, "aparelho", "aparelhos")} com o app · ${plural(s.appDaLoja.pedidos30, "pedido", "pedidos")} pelo app em 30 dias.`
      : "Não contratou.",
    pago: { contratado: s.appDaLoja.ativo, valorMensal: s.appDaLoja.valorMensal },
  });
  add({
    chave: "pagamentoOnline", nome: "Pagamento online (Pix/cartão)", grupo: "Canais de venda",
    estado: estado(s.pagosOnlineNoCanalProprio30 > 0, s.pagamentoOnlineLigado),
    evidencia: s.pagosOnlineNoCanalProprio30 > 0 ? `${plural(s.pagosOnlineNoCanalProprio30, "pedido pago", "pedidos pagos")} online no site/robô em 30 dias.`
      : s.pagamentoOnlineLigado ? "Ligado, nenhum pedido pago online em 30 dias." : "Não ligou Pix/cartão online.",
  });

  // ── Operação ──
  add({
    chave: "kds", nome: "KDS (tela da cozinha)", grupo: "Operação",
    estado: estado(s.passaramNoKds30 > 0, s.kdsConfigurado),
    evidencia: s.passaramNoKds30 > 0 ? `${plural(s.passaramNoKds30, "pedido passou", "pedidos passaram")} pelo KDS em 30 dias.`
      : s.kdsConfigurado ? "Telas configuradas, nenhum pedido passou pelo KDS em 30 dias." : "Nunca configurou.",
  });
  add({
    chave: "impressao", nome: "Assistente de impressão", grupo: "Operação",
    estado: assistenteDias === null ? "NUNCA" : assistenteDias <= 2 ? "USANDO" : "PARADO",
    evidencia: assistenteDias === null ? "Nunca instalou o Assistente no computador."
      : assistenteDias <= 2 ? `Ligado (visto ${assistenteDias === 0 ? "hoje" : assistenteDias === 1 ? "ontem" : `há ${assistenteDias} dias`}) · ${plural(s.impressos30, "pedido impresso", "pedidos impressos")} em 30 dias.`
      : `Instalado, mas desligado há ${assistenteDias} dias.`,
  });
  add({
    chave: "motoboys", nome: "Motoboys e acerto", grupo: "Operação",
    estado: estado(s.entregasComMotoboy30 > 0, s.motoboys > 0),
    evidencia: s.motoboys === 0 ? (s.entregas30 > 0 ? `${plural(s.entregas30, "entrega", "entregas")} em 30 dias e nenhum motoboy cadastrado.` : "Nenhum motoboy cadastrado.")
      : `${plural(s.motoboys, "motoboy", "motoboys")} · ${plural(s.entregasComMotoboy30, "entrega despachada", "entregas despachadas")} no sistema em 30 dias (de ${n(s.entregas30)}).`,
  });
  add({
    chave: "appDoEntregador", nome: "App do entregador", grupo: "Operação",
    estado: s.aparelhosDoEntregador > 0 ? "USANDO" : "NUNCA",
    evidencia: s.aparelhosDoEntregador > 0 ? `${plural(s.aparelhosDoEntregador, "motoboy", "motoboys")} com o app instalado.` : "Nenhum motoboy com o app.",
  });
  add({
    chave: "contingencia", nome: "Modo contingência", grupo: "Operação",
    estado: estado(s.contingenciaUsada30 > 0, s.contingenciaConfigurada, false),
    evidencia: s.contingenciaUsada30 > 0 ? `Usado ${plural(s.contingenciaUsada30, "vez", "vezes")} em 30 dias.`
      : s.contingenciaConfigurada ? "Preparado, não precisou usar em 30 dias." : "Nunca preparou.",
  });

  // ── Gestão ──
  add({
    chave: "caixa", nome: "Controle de caixa", grupo: "Gestão",
    estado: estado(s.caixas30 > 0, false),
    evidencia: s.caixas30 > 0 ? `${plural(s.caixas30, "caixa aberto", "caixas abertos")} em 30 dias.` : "Não abriu caixa em 30 dias.",
  });
  add({
    chave: "financeiro", nome: "Financeiro / DRE", grupo: "Gestão",
    estado: estado(s.lancamentosFinanceiros30 > 0, false),
    evidencia: s.lancamentosFinanceiros30 > 0 ? `${plural(s.lancamentosFinanceiros30, "lançamento", "lançamentos")} (contas, despesas, notas de compra) em 30 dias.`
      : "Nenhuma conta ou despesa lançada em 30 dias.",
  });
  add({
    chave: "estoque", nome: "Estoque e ficha técnica", grupo: "Gestão",
    estado: estado(s.movimentosDeEstoque30 > 0, s.itensDeEstoque > 0),
    evidencia: s.itensDeEstoque === 0 ? "Nenhum item de estoque cadastrado."
      : `${plural(s.itensDeEstoque, "item", "itens")} · ${plural(s.fichasTecnicas, "ficha técnica", "fichas técnicas")} · ${plural(s.movimentosDeEstoque30, "movimento", "movimentos")} em 30 dias.`,
  });
  add({
    chave: "fiscal", nome: "Nota fiscal (NFC-e)", grupo: "Gestão",
    estado: estado(s.comNotaFiscal30 > 0, s.fiscalConfigurado),
    evidencia: s.comNotaFiscal30 > 0 ? `${plural(s.comNotaFiscal30, "nota emitida", "notas emitidas")} em 30 dias.`
      : s.fiscalConfigurado ? "Configurada, nenhuma nota em 30 dias." : "Não emite NFC-e pelo sistema.",
  });
  add({
    chave: "bill", nome: "Bill, o assessor no WhatsApp", grupo: "Gestão",
    estado: estado(s.bill.usos30 > 0, s.bill.ativo),
    evidencia: s.bill.ativo ? (s.bill.usos30 > 0 ? `Assinante · ${plural(s.bill.usos30, "registro", "registros")} em 30 dias.` : "Assinante, sem uso em 30 dias.") : "Não assina.",
    pago: { contratado: s.bill.ativo, valorMensal: s.bill.valorMensal },
  });
  add({
    chave: "firecheck", nome: "FireCheck (checklist e ponto)", grupo: "Gestão",
    estado: estado(s.descartesDoFirecheck30 > 0, s.firecheckLigado, false),
    evidencia: s.firecheckLigado ? (s.descartesDoFirecheck30 > 0 ? `Ligado · ${plural(s.descartesDoFirecheck30, "descarte", "descartes")} vindos do FireCheck em 30 dias.` : "Ligado ao FireCheck.") : "Não ligou o FireCheck.",
  });

  // ── Clientes e marketing ──
  const fid = [s.fidelidade.cashback && "cashback", s.fidelidade.carimbos && "carimbos", s.fidelidade.trilha && "trilha"].filter(Boolean) as string[];
  add({
    chave: "fidelidade", nome: "Fidelidade (cashback, carimbos, trilha)", grupo: "Clientes e marketing",
    estado: estado(s.comCashback30 > 0, fid.length > 0, s.fidelidade.cashback),
    evidencia: fid.length === 0 ? "Nenhum programa de fidelidade ligado."
      : `Ligado: ${fid.join(", ")}${s.fidelidade.cashback ? ` · ${plural(s.comCashback30, "pedido", "pedidos")} com cashback em 30 dias` : ""}.`,
  });
  add({
    chave: "cupons", nome: "Cupons", grupo: "Clientes e marketing",
    estado: estado(s.comCupom30 > 0, s.cuponsAtivos > 0),
    evidencia: s.cuponsAtivos === 0 && s.comCupom30 === 0 ? "Nenhum cupom ativo."
      : `${plural(s.cuponsAtivos, "cupom ativo", "cupons ativos")} · ${plural(s.comCupom30, "pedido", "pedidos")} com desconto da loja em 30 dias.`,
  });
  add({
    chave: "disparo", nome: "Disparo pela API oficial", grupo: "Clientes e marketing",
    estado: estado(s.disparo.campanhas30 > 0, s.disparo.conectado),
    evidencia: s.disparo.conectado
      ? `Conectado · ${plural(s.disparo.campanhas30, "campanha", "campanhas")} em 30 dias${s.disparo.saldo !== null ? ` · saldo ${brl(s.disparo.saldo)}` : ""}.`
      : `Não conectou · ${plural(s.clientesNaBase, "cliente", "clientes")} na base.`,
    pago: { contratado: s.disparo.conectado, valorMensal: null, rotuloDoValor: "crédito pré-pago" },
  });
  add({
    chave: "trafego", nome: "Tráfego pago (Meta Ads)", grupo: "Clientes e marketing",
    estado: estado(s.trafego.campanhasAtivas > 0, s.trafego.ativo),
    evidencia: s.trafego.ativo ? `Contratado · ${plural(s.trafego.campanhasAtivas, "campanha ativa", "campanhas ativas")}.` : "Não contratou.",
    pago: { contratado: s.trafego.ativo, valorMensal: s.trafego.valorMensal },
  });
  add({
    chave: "multimarcas", nome: "Multimarcas", grupo: "Clientes e marketing",
    estado: s.multimarcas.ativo ? "LIGADO" : "NUNCA",
    evidencia: s.multimarcas.ativo ? "Página das marcas contratada." : s.lojasNaConta > 0 ? `${plural(s.lojasNaConta + 1, "loja", "lojas")} na conta, sem a página das marcas.` : "Não contratou.",
    pago: { contratado: s.multimarcas.ativo, valorMensal: s.multimarcas.valorMensal },
  });
  add({
    chave: "avaliacoes", nome: "Avaliações dos clientes", grupo: "Clientes e marketing",
    estado: s.avaliacoes30 > 0 ? "USANDO" : "NUNCA",
    evidencia: s.avaliacoes30 > 0 ? `${plural(s.avaliacoes30, "avaliação", "avaliações")} recebidas em 30 dias.` : "Nenhuma avaliação em 30 dias.",
  });
  return lista;
}

// ═════════════════════════════════════════════════════════════════════════════
// OPORTUNIDADES
// ═════════════════════════════════════════════════════════════════════════════

/** Limiares das oportunidades (vendas/valor em 30 dias). Ver a regra de cada uma em `oportunidadesDaLoja`. */
export const LIMIARES = {
  APP_MARKETPLACE_MIN: 100,
  APP_MARKETPLACE_PCT: 0.5,
  APP_PROPRIO_MIN: 150,
  CARDAPIO_VENDAS_MIN: 30,
  ROBO_DELIVERY_MIN: 30,
  ENTREGADOR_ENTREGAS_MIN: 40,
  ESTOQUE_FATURAMENTO_MIN: 30_000,
  BILL_FATURAMENTO_MIN: 15_000,
  FIDELIDADE_VENDAS_MIN: 60,
  DISPARO_CLIENTES_MIN: 300,
  TRAFEGO_SITE_MIN: 20,
  TRAFEGO_VENDAS_MAX: 600,
  TOTEM_BALCAO_MIN: 200,
  PAGAMENTO_PROPRIO_MIN: 30,
  FISCAL_FATURAMENTO_MIN: 20_000,
  KDS_VENDAS_MIN: 300,
  MESAS_BALCAO_MIN: 100,
  CUPONS_SITE_MIN: 30,
} as const;

/** Preço de tabela usado quando o banco não traz o valor do serviço (loja que ainda não contratou). */
export type PrecosDeTabela = { bill: number | null; appDaLoja: number | null; totem: number | null; trafego: number | null; multimarcas: number | null };

/**
 * O que oferecer para a loja, em ordem de prioridade. Cada regra olha os dados
 * de 30 dias e só dispara se o recurso NÃO está em uso. Loja PARADA não recebe
 * oferta de venda (o trabalho é reativar); loja NOVA recebe só adoção (o
 * trabalho é ativar) — vender serviço pago a quem nem começou afasta.
 *
 *  VENDA (serviço pago — gera receita):
 *   APP_DA_LOJA   ≥ 100 vendas/mês em marketplace e ≥ 50% das vendas lá; OU ≥ 150 vendas/mês no canal próprio (site+robô). Sem o plano do app.
 *   BILL          faturamento ≥ R$ 15 mil/mês, sem assinar, e financeiro ou estoque sem uso.
 *   DISPARO       ≥ 300 clientes na base e disparo oficial não conectado.
 *   TRAFEGO       ≥ 20 vendas/mês pelo site, sem tráfego, e (esfriando, em queda ou < 600 vendas/mês).
 *   TOTEM         ≥ 200 vendas/mês de balcão, sem totem, loja não é só delivery.
 *   MULTIMARCAS   mais de uma loja na conta, sem Multimarcas e sem o App completo (R$ 197, que já traz de cortesia).
 *
 *  ADOÇÃO (recurso incluído — segura o cliente):
 *   CARDAPIO_PROPRIO   ≥ 30 vendas/mês e nenhuma pelo cardápio digital.
 *   ROBO               ≥ 30 vendas/mês de delivery (site + marketplaces) e o robô não respondeu ninguém.
 *   APP_DO_ENTREGADOR  ≥ 40 entregas/mês e nenhum motoboy com o app.
 *   ESTOQUE            faturamento ≥ R$ 30 mil/mês e nenhum item de estoque.
 *   FIDELIDADE         ≥ 60 vendas/mês e nenhum programa de fidelidade ligado.
 *   PAGAMENTO_ONLINE   ≥ 30 vendas/mês no site/robô e Pix/cartão online desligado.
 *   FISCAL             faturamento ≥ R$ 20 mil/mês e NFC-e não configurada.
 *   KDS                ≥ 300 vendas/mês e KDS nunca configurado.
 *   CUPONS             ≥ 30 vendas/mês pelo site e nenhum cupom ativo.
 *   MESAS              ≥ 100 vendas/mês de balcão, nenhuma mesa, loja não é só delivery.
 */
export function oportunidadesDaLoja(
  s: SinaisDaLoja,
  status: StatusDaAtividade,
  recursos: RecursoDoPerfil[],
  precos: PrecosDeTabela,
): Oportunidade[] {
  if (status === "PARADA") return [];
  const soAdocao = status === "NOVA";
  const usa = (c: ChaveDoRecurso) => recursos.find((r) => r.chave === c)?.estado === "USANDO";
  const tot = totalDasJanelas(s.vendasPorCanal);
  const v30 = tot.d30.vendas;
  const r30 = tot.d30.valor;
  const mkt = vendasDe(s, MARKETPLACES);
  const mktValor = valorDe(s, MARKETPLACES);
  const site = vendasDe(s, ["SITE"]);
  const proprio = vendasDe(s, ["SITE", "WHATSAPP_IA"]);
  const balcao = vendasDe(s, ["PDV"]);
  const cw = vendasDe(s, ["CARDAPIOWEB"]);
  const principalMkt = s.vendasPorCanal.filter((c) => MARKETPLACES.includes(c.canal)).sort((a, b) => b.d30.vendas - a.d30.vendas)[0];
  const nomeMkt = principalMkt ? NOME_DO_CANAL[principalMkt.canal] : "marketplace";
  const L = LIMIARES;
  const lista: Oportunidade[] = [];
  const venda = (o: Omit<Oportunidade, "tipo">) => { if (!soAdocao) lista.push({ ...o, tipo: "VENDA" }); };
  const adocao = (o: Omit<Oportunidade, "tipo" | "valorMensal">) => lista.push({ ...o, tipo: "ADOCAO", valorMensal: null });
  const esfriando = status === "ESFRIANDO";
  const t = tendencia(v30, tot.d30Anterior.vendas);

  // ── VENDA ──
  if (!s.appDaLoja.ativo) {
    if (mkt >= L.APP_MARKETPLACE_MIN && v30 > 0 && mkt / v30 >= L.APP_MARKETPLACE_PCT) {
      const migram = Math.round(mkt * 0.2);
      const economia = (mktValor / Math.max(mkt, 1)) * migram * COMISSAO_ESTIMADA_DO_MARKETPLACE;
      venda({
        chave: "APP_DA_LOJA", produto: "App da loja", prioridade: Math.min(98, 80 + Math.floor(mkt / 50)),
        motivo: `Vende ${n(mkt)} pedidos/mês em marketplace (${Math.round((mkt / v30) * 100)}%, mais no ${nomeMkt}) e só ${n(proprio)} no canal próprio.`,
        argumento: `Cada cliente que passa a pedir pelo app com a sua marca deixa de pagar comissão ao ${nomeMkt}. Se 1 em cada 5 migrar (~${n(migram)} pedidos/mês), são ~${brl0(economia)} por mês que voltam para você (estimando 20% de comissão).`,
        valorMensal: precos.appDaLoja,
      });
    } else if (proprio >= L.APP_PROPRIO_MIN) {
      venda({
        chave: "APP_DA_LOJA", produto: "App da loja", prioridade: Math.min(92, 72 + Math.floor(proprio / 50)),
        motivo: `Já tem clientela direta: ${n(proprio)} pedidos/mês pelo site e pelo robô.`,
        argumento: "Quem já compra direto com você ganha o app com a sua marca na tela do celular: notificação de promoção, pedido em dois toques e recompra sem passar por marketplace.",
        valorMensal: precos.appDaLoja,
      });
    }
  }
  if (!s.bill.ativo && r30 >= L.BILL_FATURAMENTO_MIN && (!usa("financeiro") || !usa("estoque"))) {
    const falta = [!usa("financeiro") && "financeiro", !usa("estoque") && "estoque"].filter(Boolean).join(" e ");
    venda({
      chave: "BILL", produto: "Bill (assessor no WhatsApp)", prioridade: Math.min(90, 66 + Math.floor(r30 / 10_000)),
      motivo: `Fatura ${brl0(r30)}/mês e não usa ${falta} no sistema.`,
      argumento: "O Bill é o assessor no WhatsApp do dono: lança despesa por áudio, controla o estoque conversando e manda o resumo do dia. Organiza a gestão sem o dono abrir o computador.",
      valorMensal: precos.bill,
    });
  }
  if (!s.disparo.conectado && s.clientesNaBase >= L.DISPARO_CLIENTES_MIN) {
    venda({
      chave: "DISPARO", produto: "Disparo pela API oficial", prioridade: Math.min(85, 58 + Math.floor(s.clientesNaBase / 500) * 4),
      motivo: `${n(s.clientesNaBase)} clientes na base e nenhuma campanha pelo WhatsApp oficial.`,
      argumento: "Campanha pelo WhatsApp oficial, sem risco de bloquear o número da loja: cupom para quem sumiu há 30 dias, aviso de promoção do dia. Paga só o que mandar (crédito pré-pago).",
      valorMensal: null,
    });
  }
  if (!s.trafego.ativo && site >= L.TRAFEGO_SITE_MIN && (esfriando || (t !== null && t < 0) || v30 < L.TRAFEGO_VENDAS_MAX)) {
    venda({
      chave: "TRAFEGO", produto: "Tráfego pago (Meta Ads)", prioridade: esfriando || (t !== null && t < 0) ? 76 : 60,
      motivo: `O cardápio próprio vende ${n(site)}/mês${t !== null && t < 0 ? ` e as vendas caíram ${-t}%` : ""}${esfriando ? " — loja esfriando" : ""}.`,
      argumento: "Anúncio no Instagram e no Facebook levando direto para o seu cardápio, onde não tem comissão. A gente monta e acompanha a campanha.",
      valorMensal: precos.trafego,
    });
  }
  if (s.totem.licencasAtivas === 0 && !s.soDelivery && balcao >= L.TOTEM_BALCAO_MIN) {
    venda({
      chave: "TOTEM", produto: "Totem de autoatendimento", prioridade: Math.min(80, 55 + Math.floor(balcao / 100) * 5),
      motivo: `${n(balcao)} vendas de balcão por mês, todas passando pelo caixa.`,
      argumento: "O totem tira a fila do caixa: o cliente monta o pedido sozinho, o totem sempre oferece o adicional e o caixa fica livre para atender.",
      valorMensal: precos.totem,
    });
  }
  // O plano Android + Apple do app (R$ 197) já traz o Multimarcas de cortesia (lib/multimarcas).
  const multimarcasDeCortesia = s.appDaLoja.ativo && (s.appDaLoja.valorMensal || 0) >= 197;
  if (!s.multimarcas.ativo && !multimarcasDeCortesia && s.lojasNaConta > 0) {
    venda({
      chave: "MULTIMARCAS", produto: "Multimarcas", prioridade: 64,
      motivo: `Tem ${n(s.lojasNaConta + 1)} lojas/marcas na mesma conta.`,
      argumento: "Uma página só com todas as marcas da cozinha e um carrinho só: o cliente pede o hambúrguer de uma marca e a sobremesa da outra num pedido.",
      valorMensal: precos.multimarcas,
    });
  }

  // ── ADOÇÃO ──
  if (site === 0 && v30 >= L.CARDAPIO_VENDAS_MIN) {
    adocao({
      chave: "CARDAPIO_PROPRIO", produto: "Cardápio digital próprio", prioridade: cw > 0 ? 74 : 68,
      motivo: cw > 0 ? `Vende ${n(cw)} pedidos/mês pelo CardápioWeb e nenhum pelo cardápio do FireHub.` : `Vende ${n(v30)} pedidos/mês e nenhum pelo cardápio digital próprio.`,
      argumento: cw > 0
        ? "O cardápio do FireHub já está incluso na mensalidade e o pedido cai direto no painel, sem outro sistema no meio."
        : "O cardápio digital já está pronto e não tem comissão: link na bio do Instagram, no status do WhatsApp e no QR da mesa.",
    });
  }
  const delivery = site + mkt + vendasDe(s, ["WHATSAPP_IA"]);
  if (!usa("robo") && delivery >= L.ROBO_DELIVERY_MIN) {
    adocao({
      chave: "ROBO", produto: "Robô do WhatsApp", prioridade: 70,
      motivo: `${n(delivery)} vendas de delivery/mês e o robô ${s.roboConfigurado ? "não respondeu ninguém em 30 dias" : "nunca foi ligado"}.`,
      argumento: "O robô atende no WhatsApp 24h: manda o cardápio, tira dúvida, fecha o pedido e já joga no painel. O atendente para de copiar e colar.",
    });
  }
  if (s.aparelhosDoEntregador === 0 && s.entregas30 >= L.ENTREGADOR_ENTREGAS_MIN) {
    adocao({
      chave: "APP_DO_ENTREGADOR", produto: "App do entregador", prioridade: 62,
      motivo: `${n(s.entregas30)} entregas em 30 dias e ${s.motoboys === 0 ? "nenhum motoboy cadastrado" : "nenhum motoboy com o app"}.`,
      argumento: "Com o app, o motoboy recebe a rota no celular, o cliente acompanha a entrega e o acerto do fim do dia sai pronto, sem caderninho.",
    });
  }
  if (s.itensDeEstoque === 0 && r30 >= L.ESTOQUE_FATURAMENTO_MIN) {
    adocao({
      chave: "ESTOQUE", produto: "Estoque e ficha técnica", prioridade: 60,
      motivo: `Fatura ${brl0(r30)}/mês sem nenhum item de estoque cadastrado.`,
      argumento: "Com ficha técnica, cada venda dá baixa sozinha no estoque e o sistema mostra o custo real do prato (CMV). É onde quem fatura bem acha dinheiro escapando.",
    });
  }
  if (!s.fidelidade.cashback && !s.fidelidade.carimbos && !s.fidelidade.trilha && v30 >= L.FIDELIDADE_VENDAS_MIN) {
    adocao({
      chave: "FIDELIDADE", produto: "Fidelidade (cashback/carimbos)", prioridade: 58,
      motivo: `${n(v30)} vendas/mês e nenhum programa de fidelidade ligado.`,
      argumento: "Cashback ou cartão de carimbos fazem o cliente voltar para pedir direto com você. Já está incluso: é ligar em Minha loja › Fidelidade.",
    });
  }
  if (!s.pagamentoOnlineLigado && proprio >= L.PAGAMENTO_PROPRIO_MIN) {
    adocao({
      chave: "PAGAMENTO_ONLINE", produto: "Pix/cartão online", prioridade: 56,
      motivo: `${n(proprio)} pedidos/mês pelo site e robô sem pagamento online.`,
      argumento: "Com Pix online o dinheiro cai antes de a entrega sair: acaba o calote e a troca de maquininha na porta.",
    });
  }
  if (!s.fiscalConfigurado && r30 >= L.FISCAL_FATURAMENTO_MIN) {
    adocao({
      chave: "FISCAL", produto: "NFC-e pelo sistema", prioridade: 50,
      motivo: `Fatura ${brl0(r30)}/mês e não emite NFC-e pelo FireHub.`,
      argumento: "A nota sai junto com o pedido, sem digitar de novo em outro emissor.",
    });
  }
  if (!s.kdsConfigurado && v30 >= L.KDS_VENDAS_MIN) {
    adocao({
      chave: "KDS", produto: "KDS (tela da cozinha)", prioridade: 46,
      motivo: `${n(v30)} vendas/mês sem tela de cozinha.`,
      argumento: "O KDS mostra a fila de preparo numa TV ou tablet na cozinha: acaba comanda perdida e o tempo de cada pedido fica medido.",
    });
  }
  if (s.cuponsAtivos === 0 && site >= L.CUPONS_SITE_MIN) {
    adocao({
      chave: "CUPONS", produto: "Cupons", prioridade: 40,
      motivo: `${n(site)} vendas/mês pelo site e nenhum cupom ativo.`,
      argumento: "Cupom de primeira compra e de volta faz o cliente do marketplace experimentar o canal próprio.",
    });
  }
  if (s.mesas === 0 && !s.soDelivery && balcao >= L.MESAS_BALCAO_MIN) {
    adocao({
      chave: "MESAS", produto: "Mesas com QR e garçom", prioridade: 36,
      motivo: `${n(balcao)} vendas de balcão/mês e nenhuma mesa cadastrada.`,
      argumento: "O cliente pede pelo QR da mesa ou pelo garçom no celular, e a conta fecha certa no caixa.",
    });
  }

  return lista.sort((a, b) => b.prioridade - a.prioridade || a.chave.localeCompare(b.chave));
}

// ═════════════════════════════════════════════════════════════════════════════
// ATIVAÇÃO (loja em teste)
// ═════════════════════════════════════════════════════════════════════════════

/** O que a loja em teste já fez e o que falta para estar usando de verdade. */
export function passosDaAtivacao(s: SinaisDaLoja, agora: Date): PassoDaAtivacao[] {
  const tot = totalDasJanelas(s.vendasPorCanal);
  const vendas = tot.d30.vendas;
  const assistente = diasDesde(s.assistenteVistoEm, agora);
  const temIntegracao = Object.values(s.integracoes).some(Boolean);
  return [
    { chave: "cardapio", texto: "Cardápio montado", feito: cardapioPuxado(s.produtos), detalhe: cardapioPuxado(s.produtos) ? plural(s.produtos, "produto", "produtos") : s.produtos === 0 ? "nenhum produto" : `só ${plural(s.produtos, "produto", "produtos")}` },
    { chave: "canal", texto: "Canal de pedido ligado (robô ou iFood/99)", feito: s.roboConfigurado || temIntegracao, detalhe: [s.roboConfigurado && "robô", s.integracoes.ifood && "iFood", s.integracoes.food99 && "99Food"].filter(Boolean).join(", ") || "nenhum" },
    { chave: "impressao", texto: "Assistente de impressão instalado", feito: assistente !== null, detalhe: assistente === null ? "não instalou" : assistente <= 2 ? "ligado" : `visto há ${assistente} dias` },
    { chave: "primeira", texto: "Primeira venda", feito: vendas > 0, detalhe: vendas > 0 ? plural(vendas, "venda", "vendas") : "ainda não" },
    { chave: "ativada", texto: `${VENDAS_PARA_ATIVAR} vendas no teste`, feito: vendas >= VENDAS_PARA_ATIVAR, detalhe: `${n(Math.min(vendas, VENDAS_PARA_ATIVAR))} de ${VENDAS_PARA_ATIVAR}` },
  ];
}

// ═════════════════════════════════════════════════════════════════════════════
// O PERFIL INTEIRO
// ═════════════════════════════════════════════════════════════════════════════

export function montarPerfil(s: SinaisDaLoja, precos: PrecosDeTabela, agora: Date): PerfilDaLoja {
  const tot = totalDasJanelas(s.vendasPorCanal);
  const { status, motivo } = statusDaAtividade({ criadaEm: s.criadaEm, testeAte: s.testeAte, ultimaVendaEm: s.ultimaVendaEm, ...tot }, agora);
  const teste = lojaEmTeste({ criadaEm: s.criadaEm, testeAte: s.testeAte }, agora);
  const recursos = recursosDaLoja(s, agora);
  const contagem: Record<EstadoDoRecurso, number> = { USANDO: 0, LIGADO: 0, PARADO: 0, NUNCA: 0 };
  for (const r of recursos) contagem[r.estado]++;
  const canais = s.vendasPorCanal
    .filter((c) => c.d30.vendas > 0)
    .sort((a, b) => b.d30.vendas - a.d30.vendas)
    .map((c) => ({
      canal: c.canal, nome: NOME_DO_CANAL[c.canal], vendas: c.d30.vendas, valor: c.d30.valor,
      pct: tot.d30.vendas > 0 ? Math.round((c.d30.vendas / tot.d30.vendas) * 1000) / 10 : 0,
    }));
  const servicosPagos = recursos.filter((r) => r.pago).map((r) => ({ chave: r.chave, nome: r.nome, contratado: r.pago!.contratado, valorMensal: r.pago!.valorMensal, rotuloDoValor: r.pago!.rotuloDoValor }));
  const contratados = servicosPagos.filter((p) => p.contratado);

  return {
    cardapio: { produtos: s.produtos, puxado: cardapioPuxado(s.produtos) },
    loja: {
      id: s.id, nome: s.nome, dono: s.dono, cidade: s.cidade, telefone: s.telefone, email: s.email, slug: s.slug, logo: s.logo,
      criadaEm: s.criadaEm, vendedor: s.vendedor, embaixador: s.embaixador, lojasNaConta: s.lojasNaConta,
    },
    atividade: {
      status, motivo,
      ultimaVendaEm: s.ultimaVendaEm,
      diasSemVenda: diasDesde(s.ultimaVendaEm, agora),
      d7: tot.d7, d30: tot.d30, d30Anterior: tot.d30Anterior,
      tendenciaPct: tendencia(tot.d30.vendas, tot.d30Anterior.vendas),
      ticketMedio30: tot.d30.vendas > 0 ? Math.round((tot.d30.valor / tot.d30.vendas) * 100) / 100 : 0,
      canais,
      emTeste: teste.emTeste,
      diasDeTeste: teste.dias,
    },
    recursos,
    contagem,
    servicosPagos,
    financeiro: {
      isenta: s.isenta,
      motivoDaIsencao: s.motivoDaIsencao,
      clienteDesde: s.criadaEm,
      testeAte: s.testeAte,
      mensalidadeDoMes: { mes: s.mensalidade.mes, valor: s.mensalidade.valorDoMes, situacao: s.mensalidade.situacaoDoMes },
      emAberto: s.mensalidade.emAberto,
      servicosContratados: contratados.length,
      totalDosServicos: Math.round(contratados.reduce((t, p) => t + (p.valorMensal || 0), 0) * 100) / 100,
    },
    oportunidades: oportunidadesDaLoja(s, status, recursos, precos),
    ativacao: status === "NOVA" ? passosDaAtivacao(s, agora) : null,
    ultimoSinalDoPainel: s.ultimoSinalDoPainel,
    geradoEm: agora.toISOString(),
  };
}

export function resumirPerfil(p: PerfilDaLoja): ResumoDoPerfil {
  return {
    id: p.loja.id,
    produtos: p.cardapio.produtos,
    cardapioPuxado: p.cardapio.puxado,
    nome: p.loja.nome,
    cidade: p.loja.cidade,
    telefone: p.loja.telefone,
    vendedor: p.loja.vendedor,
    criadaEm: p.loja.criadaEm,
    status: p.atividade.status,
    motivo: p.atividade.motivo,
    diasSemVenda: p.atividade.diasSemVenda,
    vendas30: p.atividade.d30.vendas,
    valor30: p.atividade.d30.valor,
    valor30Anterior: p.atividade.d30Anterior.valor,
    tendenciaPct: p.atividade.tendenciaPct,
    canalPrincipal: p.atividade.canais[0]?.nome ?? null,
    usando: p.contagem.USANDO,
    totalDeRecursos: p.recursos.length,
    oportunidades: p.oportunidades.map(({ chave, produto, tipo, prioridade, motivo, valorMensal }) => ({ chave, produto, tipo, prioridade, motivo, valorMensal })),
    emTeste: p.atividade.emTeste,
    diasDeTeste: p.atividade.diasDeTeste,
    ativacaoFalta: (p.ativacao || []).filter((x) => !x.feito).map((x) => x.texto),
    emAberto: p.financeiro.emAberto?.valor ?? 0,
    isenta: p.financeiro.isenta,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// RELATÓRIO DA CARTEIRA
// ═════════════════════════════════════════════════════════════════════════════

export type RelatorioDaCarteira = {
  total: number;
  porStatus: Record<StatusDaAtividade, number>;
  faturamento30: number;
  faturamento30Anterior: number;
  tendenciaPct: number | null;
  /** ESFRIANDO e PARADA que já venderam, a maior perda primeiro. Nunca vendeu fica no fim. */
  emRisco: ResumoDoPerfil[];
  /** Por produto: quantas lojas, potencial mensal (serviço pago) e as lojas, por prioridade. */
  oportunidadesPorProduto: {
    chave: ChaveDaOportunidade; produto: string; tipo: "VENDA" | "ADOCAO"; lojas: number; potencialMensal: number;
    itens: { id: string; nome: string; motivo: string; prioridade: number }[];
  }[];
  ranking: ResumoDoPerfil[];
  novas: ResumoDoPerfil[];
  /** Lojas abaixo do critério do cardápio (CRITERIO_DO_CARDAPIO). */
  semCardapio: number;
};

export function relatorioDaCarteira(lojas: ResumoDoPerfil[]): RelatorioDaCarteira {
  const porStatus: Record<StatusDaAtividade, number> = { ATIVA: 0, ESFRIANDO: 0, PARADA: 0, NOVA: 0 };
  let f30 = 0, fAnt = 0;
  const grupos = new Map<ChaveDaOportunidade, RelatorioDaCarteira["oportunidadesPorProduto"][number]>();
  for (const l of lojas) {
    porStatus[l.status]++;
    f30 += l.valor30;
    fAnt += l.valor30Anterior;
    for (const o of l.oportunidades) {
      const g = grupos.get(o.chave) || { chave: o.chave, produto: o.produto, tipo: o.tipo, lojas: 0, potencialMensal: 0, itens: [] };
      g.lojas++;
      g.potencialMensal += o.valorMensal || 0;
      g.itens.push({ id: l.id, nome: l.nome, motivo: o.motivo, prioridade: o.prioridade });
      grupos.set(o.chave, g);
    }
  }
  const perda = (l: ResumoDoPerfil) => Math.max(0, l.valor30Anterior - l.valor30) + (l.status === "PARADA" ? l.valor30Anterior : 0);
  const emRisco = lojas
    .filter((l) => l.status === "ESFRIANDO" || l.status === "PARADA")
    .sort((a, b) => {
      const nuncaA = a.diasSemVenda === null ? 1 : 0, nuncaB = b.diasSemVenda === null ? 1 : 0;
      return nuncaA - nuncaB || perda(b) - perda(a) || b.valor30Anterior - a.valor30Anterior || a.nome.localeCompare(b.nome);
    });
  const oportunidadesPorProduto = [...grupos.values()]
    .map((g) => ({ ...g, potencialMensal: Math.round(g.potencialMensal * 100) / 100, itens: g.itens.sort((a, b) => b.prioridade - a.prioridade) }))
    .sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "VENDA" ? -1 : 1) || b.lojas - a.lojas || b.potencialMensal - a.potencialMensal);
  const ranking = lojas.filter((l) => l.valor30 > 0).sort((a, b) => b.valor30 - a.valor30);
  const novas = lojas.filter((l) => l.status === "NOVA").sort((a, b) => a.diasDeTeste - b.diasDeTeste || a.nome.localeCompare(b.nome));
  return {
    total: lojas.length, porStatus,
    faturamento30: Math.round(f30 * 100) / 100,
    faturamento30Anterior: Math.round(fAnt * 100) / 100,
    tendenciaPct: tendencia(f30, fAnt),
    emRisco, oportunidadesPorProduto, ranking, novas,
    semCardapio: lojas.filter((l) => !l.cardapioPuxado).length,
  };
}

/** A carteira em CSV (separador ";" e vírgula decimal — abre direto no Excel em pt-BR). */
export function csvDaCarteira(lojas: ResumoDoPerfil[]): string {
  const esc = (v: unknown) => {
    const t = String(v ?? "");
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const num = (v: number) => (Math.round(v * 100) / 100).toFixed(2).replace(".", ",");
  const cab = ["Loja", "Cidade", "Telefone", "Vendedor", "Status", "Motivo", "Dias sem venda", "Vendas 30d", "Faturamento 30d", "Faturamento 30d anteriores", "Tendência %", "Canal principal", "Recursos em uso", "Cardápio", "Oportunidades", "Em teste (dias)", "Falta para ativar", "Mensalidade em aberto"];
  const linhas = lojas.map((l) => [
    l.nome, l.cidade, l.telefone, l.vendedor?.nome, ROTULO_DO_STATUS[l.status], l.motivo, l.diasSemVenda ?? "nunca vendeu",
    l.vendas30, num(l.valor30), num(l.valor30Anterior), l.tendenciaPct ?? "", l.canalPrincipal, `${l.usando} de ${l.totalDeRecursos}`,
    l.cardapioPuxado ? `puxado (${l.produtos} itens)` : `SEM cardápio (${l.produtos} itens)`,
    l.oportunidades.map((o) => o.produto).join(" | "), l.emTeste ? l.diasDeTeste : "", l.ativacaoFalta.join(" | "), num(l.emAberto),
  ].map(esc).join(";"));
  return "﻿" + [cab.join(";"), ...linhas].join("\r\n");
}

export const ROTULO_DO_STATUS: Record<StatusDaAtividade, string> = { ATIVA: "Ativa", ESFRIANDO: "Esfriando", PARADA: "Parada", NOVA: "Nova (em teste)" };
export const ROTULO_DO_ESTADO: Record<EstadoDoRecurso, string> = { USANDO: "Usando", LIGADO: "Ligado", PARADO: "Configurado, parado", NUNCA: "Nunca usou" };
