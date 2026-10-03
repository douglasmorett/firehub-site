/**
 * As chamadas ao FireHub. Toda chamada leva a sessão assinada (Bearer): é dela
 * que o servidor tira quem é o entregador e de qual loja — nunca do corpo.
 *
 * Falha nunca é silenciosa. A página web já aprendeu isso do jeito ruim: o
 * botão de entrega devolvia 405 há meses e o entregador só via o spinner.
 * Aqui toda falha vira um ErroDaApi com a mensagem que vai para a tela.
 */
import { API_URL } from "./config";

export class ErroDaApi extends Error {
  constructor(
    message: string,
    /** "rede": não chegou ao servidor. "sessao": precisa entrar de novo. */
    readonly tipo: "rede" | "sessao" | "servidor" | "recusado",
    readonly status: number,
    readonly corpo: Record<string, any> = {},
  ) {
    super(message);
  }
}

type Opcoes = {
  metodo?: "GET" | "POST" | "PATCH" | "DELETE";
  corpo?: unknown;
  token?: string | null;
  /** Em ms. A baixa na porta do cliente não pode ficar pendurada no 4G. */
  limite?: number;
};

export async function chamar<T = any>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (opcoes.corpo !== undefined) headers["Content-Type"] = "application/json";
  if (opcoes.token) headers.Authorization = `Bearer ${opcoes.token}`;

  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), opcoes.limite ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${caminho}`, {
      method: opcoes.metodo ?? "GET",
      headers,
      body: opcoes.corpo !== undefined ? JSON.stringify(opcoes.corpo) : undefined,
      signal: controle.signal,
    });
  } catch {
    throw new ErroDaApi("Sem conexão com a internet.", "rede", 0);
  } finally {
    clearTimeout(relogio);
  }

  const dados = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (res.ok) return dados as T;

  const mensagem = String(dados?.error || `Erro ${res.status} no servidor.`);
  if (res.status === 401 && (dados?.precisaLogin || dados?.precisaRelogar)) {
    throw new ErroDaApi(mensagem, "sessao", 401, dados);
  }
  if (res.status >= 500) throw new ErroDaApi(mensagem, "servidor", res.status, dados);
  throw new ErroDaApi(mensagem, "recusado", res.status, dados);
}

// ── Tipos do que o servidor manda (api/motoboys/orders?formato=app) ──────────

export type Cobranca = {
  metodo: string;
  valor: number;
  trocoPara?: number | null;
  levarDeTroco?: number | null;
};

export type LinhaDaSacola = {
  quantidade: number;
  nome: string;
  bebida: boolean;
  escolhas: { nome: string; quantidade: number; bebida: boolean }[];
  obs: string;
};

export type Pedido = {
  id: string;
  numero: string;
  refDaPlataforma: string | null;
  status: string;
  source: string | null;
  createdAt: string;
  customerName: string;
  customerPhone: string | null;
  endereco: string;
  destino: { texto: string; ponto: { lat: number; lng: number } | null } | null;
  observacao: string;
  paymentMethod: string | null;
  totalAmount: number;
  changeAmount: number | null;
  cobrarNaEntrega: Cobranca | null;
  formaDoPedido: string | null;
  pedeCodigoEntrega: boolean;
  canalDoCodigo: "iFood" | "99Food" | null;
  sacola: { linhas: LinhaDaSacola[]; itens: number; bebidas: number; resumo: string };
  bebidasParaConferir: { name: string; quantity: number }[];
  podeDevolverAte: string | null;
  routeSequence: number | null;
  routeSchedule: { id: string; routeNumber: string | null; color: string | null } | null;
};

export type ListaDePedidos = {
  orders: Pedido[];
  formasDePagamento: string[];
  appConfig: { lembrarBebidas: boolean; cobrarNaEntrega: boolean; pedirCodigoEntrega: boolean; pedirCodigo99Food: boolean };
};

export type RespostaDaBaixa = {
  success?: boolean;
  jaEntregue?: boolean;
  avisoCodigo?: string;
};
