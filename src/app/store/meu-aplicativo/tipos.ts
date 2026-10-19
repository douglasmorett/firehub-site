/**
 * O formato do GET /api/store/meu-aplicativo, do lado da tela, e os
 * formatadores. As contas moram no servidor (lib/app-da-loja/painel.ts):
 * a tela só desenha.
 */
export type CanalDoApp = "APP" | "SITE" | "WHATSAPP" | "LOJA" | "MARKETPLACE" | "OUTRO";
export type Periodo = "7d" | "30d" | "90d" | "mes" | "mesAnterior";
export type TipoDeSegmento = "todos" | "ativosAgora" | "ativos30" | "sumidos30" | "sumidos60" | "fieis" | "ticketAlto" | "nuncaPediuNoApp" | "produto" | "categoria" | "aniversariantes";

export type NumerosDoCanal = {
  canal: CanalDoApp; pedidos: number; faturamento: number; ticketMedio: number; participacao: number;
  clientes: number; frequencia: number | null; recorrencia: number | null; recorrenciaBase: number;
};
export type DiaDaSerie = { dia: string; app: number; appPedidos: number; total: number; porCanal: Record<CanalDoApp, number>; aberturas: number };
export type Destaque = { tipo: "ganha" | "perde" | "neutro"; titulo: string; detalhe: string; acao?: string };
export type Envio = {
  id: string; titulo: string; mensagem: string; caminho: string | null; produtoNome: string | null;
  segmento: TipoDeSegmento; segmentoValor: string | null; segmentoRotulo: string | null;
  status: "AGENDADO" | "ENVIANDO" | "ENVIADO" | "CANCELADO" | "FALHOU";
  dia: string; agendadoPara: string | null; criadoEm: string; enviadoEm: string | null;
  alvo: number; aceitos: number; errosNoEnvio: number; entregues: number; errosNaEntrega: number; removidos: number;
  abertos: number; pedidos: number; faturamento: number; desligaram: number; apuradoEm: string | null;
  motivo: string | null; quem: string | null; custoNoWhatsApp: number;
};
export type Sugestao = { objetivo: string; titulo: string; mensagem: string; segmento: TipoDeSegmento; produtoId: string | null; porque: string };
export type Painel = {
  periodo: { chave: Periodo; de: string; ate: string; dias: number; anteriorDe: string; anteriorAte: string };
  base: { instalacoes: number; ativosAgora: number; ativos7: number; ativos30: number; novosNoMes: number; recebemNotificacao: number; recusaramNaTelaAntiga: number; semPermissao: number; aguardandoTermo: number; versaoAntiga: number };
  canais: NumerosDoCanal[];
  canaisAnterior: NumerosDoCanal[];
  total: { pedidos: number; faturamento: number; ticketMedio: number };
  totalAnterior: { pedidos: number; faturamento: number; ticketMedio: number };
  destaques: Destaque[];
  serie: DiaDaSerie[];
  serieAnterior: DiaDaSerie[];
  semanal: { inicio: string; app: number; total: number; participacao: number }[];
  antesDepois: { clientes: number; novos: number; janelaMediaDias: number; pedidosMesAntes: number; pedidosMesDepois: number; gastoMesAntes: number; gastoMesDepois: number; variacaoPedidos: number | null; variacaoGasto: number | null };
  calor: number[][];
  horario: { pico: number; enviar: number; diaForte: string; diaFraco: string } | null;
  porUnidade: { id: string; nome: string; pedidosApp: number; faturamentoApp: number; faturamentoTotal: number }[];
  notificacoes: {
    envios: Envio[];
    quantosHoje: number;
    titulosRecentes: string[];
    resumo30: { envios: number; entregues: number; abertos: number; pedidos: number; faturamento: number; desligaram: number };
    aprendizado: { aprendendo: boolean; faltam: number; achados: { texto: string; melhor: string; pior: string; vezes: number }[] };
    melhores: string[];
    segmentos: Partial<Record<TipoDeSegmento, number>>;
    alcanceProdutos: Record<string, number>;
    alcanceCategorias: Record<string, number>;
    sugestoes: Sugestao[];
    precoWhatsApp: number;
  };
  temAberturas: boolean;
};
export type Dados = {
  loja: { nome: string; slug: string | null; logo: string | null };
  plano: { plataformas: string | null; rotulo: string | null; valor: number; ativoDesde: string | null };
  unidades: string[];
  painel: Painel;
  regras: {
    avisarAPartirDe: number; tituloMax: number; mensagemMax: number; ativoAgoraMin: number; taxaMarketplacePadrao: number;
    segmentos: { tipo: TipoDeSegmento; rotulo: string; explica: string; comValor?: "produto" | "categoria" }[];
    objetivos: { id: string; rotulo: string; emoji: string }[];
  };
  produtos: { id: string; nome: string; preco: number; foto: string | null; categoria: string }[];
};

export const CANAIS: CanalDoApp[] = ["APP", "SITE", "LOJA", "WHATSAPP", "MARKETPLACE", "OUTRO"];
export const ROTULO_DO_CANAL: Record<CanalDoApp, string> = {
  APP: "Aplicativo", SITE: "Site (navegador)", WHATSAPP: "WhatsApp (robô)", LOJA: "Balcão, mesa e totem", MARKETPLACE: "Marketplaces", OUTRO: "Outros",
};
/** Paleta validada (dataviz: faixa de luminosidade, croma e daltonismo entre vizinhos). O app é o amarelo-ouro do produto. */
export const COR_DO_CANAL: Record<CanalDoApp, string> = {
  APP: "#CA8A04", SITE: "#2563EB", LOJA: "#0D9488", WHATSAPP: "#C026D3", MARKETPLACE: "#DC2626", OUTRO: "#94A3B8",
};
export const ROTULO_DO_PERIODO: Record<Periodo, string> = { "7d": "7 dias", "30d": "30 dias", "90d": "90 dias", mes: "Este mês", mesAnterior: "Mês anterior" };

export const reais = (v: number) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const reaisCurto = (v: number) => {
  const a = Math.abs(v || 0);
  if (a >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (a >= 10_000) return `R$ ${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return reais(v).replace(/,00$/, "");
};
export const inteiro = (n: number) => (n || 0).toLocaleString("pt-BR");
export const pct = (x: number | null | undefined, casas = 0) => (x == null ? "—" : `${(x * 100).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas })}%`);
export const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
export const dataHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
export const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
export const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Variação de b (anterior) para a (atual). Null quando não há base. */
export const variacao = (a: number, b: number) => (b > 0 ? a / b - 1 : null);
