import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * A configuração do atendimento do número do FireHub — uma linha só em
 * `CrmConfig` (id "geral"), lida pelo webhook a cada mensagem e pela tela.
 *
 * O ROBÔ NASCE DESLIGADO. Conectar o número passa a gravar as conversas; quem
 * decide que o robô começa a responder é o dono, pelo interruptor da tela.
 * Ninguém quer descobrir no dia seguinte que um robô recém-escrito conversou a
 * noite inteira com os leads dele.
 */

export const INSTANCIA_DO_ATENDIMENTO = (process.env.ATENDIMENTO_INSTANCIA || "firehub_atendimento").trim();

/** O evento do gateway é do número do FireHub (e não de uma loja)? Sem banco: roda no topo do webhook. */
export function ehInstanciaDoAtendimento(instancia: unknown): boolean {
  return typeof instancia === "string" && instancia === INSTANCIA_DO_ATENDIMENTO;
}

export type EstadoDaConexao = {
  conectado: boolean | null;
  telefone: string | null;
  /** Quando passou a estar conectado (ISO). */
  desde: string | null;
  /** Quando caiu (ISO), enquanto não volta. */
  desconectadoDesde: string | null;
  /** Já conectou alguma vez — só aí a queda merece aviso e reconexão. */
  jaConectou: boolean;
};

export type ConfigDoAtendimento = {
  roboLigado: boolean;
  /** Nome que o robô usa para se apresentar. Vazio = "atendimento do FireHub", sem inventar nome. */
  nomeDoAtendente: string;
  /** WhatsApp pessoal do dono para os avisos (pediu pessoa, número caiu) — sai pelo canal de alertas internos, nunca pelo número do FireHub. */
  avisarNoWhatsApp: string | null;
  /** O que o dono quer que o robô saiba ou faça além da base (promoção, recado da semana). */
  instrucoesExtras: string;
  /** Gateway próprio para este número (ex.: o de Baileys 7). Vazio = o do ambiente. */
  evolutionUrl: string | null;
  evolutionApiKey: string | null;
  conexao: EstadoDaConexao;
};

export const CONFIG_PADRAO: ConfigDoAtendimento = {
  roboLigado: false,
  nomeDoAtendente: "",
  avisarNoWhatsApp: null,
  instrucoesExtras: "",
  evolutionUrl: null,
  evolutionApiKey: null,
  conexao: { conectado: null, telefone: null, desde: null, desconectadoDesde: null, jaConectou: false },
};

function lerConfig(bruto: unknown): ConfigDoAtendimento {
  const d = (bruto && typeof bruto === "object" ? bruto : {}) as any;
  const c = (d.conexao && typeof d.conexao === "object" ? d.conexao : {}) as any;
  const texto = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  return {
    roboLigado: d.roboLigado === true,
    nomeDoAtendente: texto(d.nomeDoAtendente, 40).trim(),
    avisarNoWhatsApp: texto(d.avisarNoWhatsApp, 30).trim() || null,
    instrucoesExtras: texto(d.instrucoesExtras, 4000),
    evolutionUrl: texto(d.evolutionUrl, 300).trim() || null,
    evolutionApiKey: texto(d.evolutionApiKey, 300).trim() || null,
    conexao: {
      conectado: typeof c.conectado === "boolean" ? c.conectado : null,
      telefone: texto(c.telefone, 30) || null,
      desde: texto(c.desde, 40) || null,
      desconectadoDesde: texto(c.desconectadoDesde, 40) || null,
      jaConectou: c.jaConectou === true,
    },
  };
}

// Lida a cada mensagem: cache curto no processo, invalidado a cada gravação.
let cache: { valor: ConfigDoAtendimento; em: number } | null = null;
const VALIDADE_MS = 15_000;

export async function configDoAtendimento(): Promise<ConfigDoAtendimento> {
  if (cache && Date.now() - cache.em < VALIDADE_MS) return cache.valor;
  try {
    const linha = await prisma.crmConfig.findUnique({ where: { id: "geral" } });
    const valor = lerConfig(linha?.dados);
    cache = { valor, em: Date.now() };
    return valor;
  } catch (err: any) {
    // Sem a tabela (boot falhou), o número grava nada e o robô fica calado.
    console.error(`[Atendimento] Config ilegível: ${err?.message}`);
    return CONFIG_PADRAO;
  }
}

export async function salvarConfigDoAtendimento(mudancas: Partial<ConfigDoAtendimento>): Promise<ConfigDoAtendimento> {
  const atual = await configDoAtendimento();
  const novo = lerConfig({ ...atual, ...mudancas, conexao: { ...atual.conexao, ...(mudancas.conexao || {}) } });
  await prisma.crmConfig.upsert({
    where: { id: "geral" },
    create: { id: "geral", dados: novo as unknown as Prisma.InputJsonValue },
    update: { dados: novo as unknown as Prisma.InputJsonValue },
  });
  cache = { valor: novo, em: Date.now() };
  return novo;
}

/** O que a tela pode ver: a chave do gateway nunca sai do servidor. */
export function configParaTela(c: ConfigDoAtendimento) {
  const { evolutionApiKey, ...resto } = c;
  return { ...resto, temChaveDoGateway: !!evolutionApiKey };
}
