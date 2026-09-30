/**
 * As etapas do funil do CRM e os rótulos que as telas mostram.
 *
 * Sem import de servidor: a tela do admin, a do vendedor e as rotas leem a
 * MESMA lista — é o que impede o funil de uma tela ter uma coluna que a outra
 * não conhece.
 */

export const ETAPAS = ["NOVO", "CONVERSANDO", "DEMO_MARCADA", "EM_TESTE", "CLIENTE", "PERDIDO"] as const;
export type Etapa = (typeof ETAPAS)[number];

export const ROTULO_DA_ETAPA: Record<Etapa, string> = {
  NOVO: "Novo",
  CONVERSANDO: "Conversando",
  DEMO_MARCADA: "Demonstração marcada",
  EM_TESTE: "Em teste grátis",
  CLIENTE: "Cliente",
  PERDIDO: "Perdido",
};

/** Cor de fundo e do texto do selo de cada etapa (tema claro do admin). */
export const COR_DA_ETAPA: Record<Etapa, { fundo: string; texto: string }> = {
  NOVO: { fundo: "#E0F2FE", texto: "#075985" },
  CONVERSANDO: { fundo: "#FEF3C7", texto: "#92400E" },
  DEMO_MARCADA: { fundo: "#EDE9FE", texto: "#5B21B6" },
  EM_TESTE: { fundo: "#FFEDD5", texto: "#9A3412" },
  CLIENTE: { fundo: "#DCFCE7", texto: "#166534" },
  PERDIDO: { fundo: "#F1F5F9", texto: "#475569" },
};

export function etapaValida(v: unknown): Etapa | null {
  return typeof v === "string" && (ETAPAS as readonly string[]).includes(v) ? (v as Etapa) : null;
}

export const ORIGENS = ["WHATSAPP", "INSTAGRAM", "SITE", "INDICACAO", "CADASTRO", "MANUAL", "EVENTO"] as const;
export type Origem = (typeof ORIGENS)[number];

export const ROTULO_DA_ORIGEM: Record<Origem, string> = {
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
  SITE: "Site",
  INDICACAO: "Indicação",
  CADASTRO: "Cadastro no site",
  MANUAL: "Cadastrado à mão",
  EVENTO: "Evento / palestra",
};

export function origemValida(v: unknown): Origem | null {
  return typeof v === "string" && (ORIGENS as readonly string[]).includes(v) ? (v as Origem) : null;
}

/** Quem escreveu a mensagem, como a conversa mostra. */
export const ROTULO_DO_AUTOR: Record<string, string> = {
  CLIENTE: "Contato",
  ROBO: "Robô",
  ADMIN: "Admin",
  VENDEDOR: "Vendedor",
  CELULAR: "Pelo celular",
  SISTEMA: "Sistema",
};

export const TIPOS_DE_REUNIAO = ["DEMONSTRACAO", "ACOMPANHAMENTO", "TREINAMENTO", "BLOQUEIO"] as const;
export type TipoDeReuniao = (typeof TIPOS_DE_REUNIAO)[number];

export const ROTULO_DO_TIPO_DE_REUNIAO: Record<TipoDeReuniao, string> = {
  DEMONSTRACAO: "Demonstração",
  ACOMPANHAMENTO: "Acompanhamento",
  TREINAMENTO: "Treinamento",
  BLOQUEIO: "Bloqueado (folga, compromisso)",
};

export const STATUS_DE_REUNIAO = ["MARCADA", "REALIZADA", "FALTOU", "CANCELADA"] as const;
export type StatusDeReuniao = (typeof STATUS_DE_REUNIAO)[number];

export const ROTULO_DO_STATUS_DE_REUNIAO: Record<StatusDeReuniao, string> = {
  MARCADA: "Marcada",
  REALIZADA: "Realizada",
  FALTOU: "Não compareceu",
  CANCELADA: "Cancelada",
};
