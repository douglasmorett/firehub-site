/**
 * Configuração e estado do supervisor da contingência (computador da loja).
 *
 * Quem liga o supervisor é o Assistente de impressão, passando por ambiente o
 * que recebeu na ativação (a chave nunca vai para arquivo em texto puro: o
 * Assistente guarda cifrada com o cofre do Windows e entrega aqui ao subir).
 *
 *   CONTINGENCIA_NUVEM               https://firehubfood.com.br
 *   CONTINGENCIA_CHAVE               a chave da loja (lib/contingencia/chave.ts)
 *   CONTINGENCIA_SEGREDO_DO_BILHETE  para o FireHub local aceitar o bilhete
 *   CONTINGENCIA_LOJA                o id da loja
 *   CONTINGENCIA_APP                 a pasta do FireHub (server.js do build)
 *   CONTINGENCIA_PG_BIN              a pasta bin do Postgres
 *   CONTINGENCIA_PASTA               onde moram banco, estado e registros
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const PORTAS = {
  /** O Postgres da cópia — só no próprio computador. */
  banco: Number(process.env.CONTINGENCIA_PORTA_BANCO) || 54329,
  /** O FireHub local, atrás da porta da loja — só no próprio computador. */
  firehub: Number(process.env.CONTINGENCIA_PORTA_FIREHUB) || 7895,
  /** A porta da loja: a TV, o garçom e o navegador do caixa chegam por ela. */
  loja: Number(process.env.CONTINGENCIA_PORTA_LOJA) || 7890,
};

export type Config = {
  nuvem: string;
  chave: string;
  segredoDoBilhete: string;
  loja: string;
  appDir: string;
  pgBin: string;
  node: string;
  pasta: string;
  /** Banco da cópia (o padrão é "firehub"; a prova usa outro nome no mesmo Postgres). */
  nomeDoBanco: string;
};

function obrigatorio(nome: string): string {
  const v = (process.env[nome] || "").trim();
  if (!v) throw new Error(`Falta ${nome} no ambiente do supervisor.`);
  return v;
}

export function lerConfig(): Config {
  const pasta = process.env.CONTINGENCIA_PASTA || path.join(process.env.APPDATA || os.homedir(), "FireHub", "contingencia");
  fs.mkdirSync(pasta, { recursive: true });
  return {
    nuvem: obrigatorio("CONTINGENCIA_NUVEM").replace(/\/+$/, ""),
    chave: obrigatorio("CONTINGENCIA_CHAVE"),
    segredoDoBilhete: obrigatorio("CONTINGENCIA_SEGREDO_DO_BILHETE"),
    loja: obrigatorio("CONTINGENCIA_LOJA"),
    appDir: obrigatorio("CONTINGENCIA_APP"),
    pgBin: obrigatorio("CONTINGENCIA_PG_BIN"),
    node: process.env.CONTINGENCIA_NODE || process.execPath,
    pasta,
    nomeDoBanco: process.env.CONTINGENCIA_NOME_DO_BANCO || "firehub",
  };
}

/** O que o supervisor lembra entre um boot e outro. */
export type EstadoGuardado = {
  /** Até onde a cópia leu o diário da nuvem ("0" = precisa de foto). */
  cursor: string;
  /** Hash do esquema aplicado no banco local. */
  esquema: string;
  /** Segredo das sessões do FireHub local (nunca o da nuvem). */
  segredoLocal: string;
  /** Loja da cópia: trocou de loja (reativação noutra conta), refaz tudo. */
  loja: string;
  /** Quando a foto foi feita. */
  fotoEm: string | null;
  /** A queda em andamento (para registrar o episódio na subida). */
  episodio: { inicio: string; fim: string | null } | null;
  /**
   * Em que endereço o painel deste computador usa o FireHub (com ou sem
   * "www": cada um guarda a própria entrada). É o que o atalho da área de
   * trabalho abre. Vem da tela do painel (TrocaDeContingencia).
   */
  origemDoPainel?: string | null;
};

export function arquivoDoEstado(cfg: Config): string {
  return path.join(cfg.pasta, "estado.json");
}

export function lerEstado(cfg: Config): EstadoGuardado {
  let e: Partial<EstadoGuardado> = {};
  try {
    e = JSON.parse(fs.readFileSync(arquivoDoEstado(cfg), "utf8"));
  } catch {
    /* primeiro boot */
  }
  const estado: EstadoGuardado = {
    cursor: e.cursor || "0",
    esquema: e.esquema || "",
    segredoLocal: e.segredoLocal || crypto.randomBytes(32).toString("base64url"),
    loja: e.loja || "",
    fotoEm: e.fotoEm || null,
    episodio: e.episodio || null,
    origemDoPainel: e.origemDoPainel || null,
  };
  if (estado.loja && estado.loja !== cfg.loja) {
    // Outra loja neste computador: nada da cópia anterior vale.
    estado.cursor = "0";
    estado.esquema = "";
    estado.fotoEm = null;
    estado.episodio = null;
  }
  estado.loja = cfg.loja;
  return estado;
}

export function gravarEstado(cfg: Config, estado: EstadoGuardado): void {
  const destino = arquivoDoEstado(cfg);
  const temporario = `${destino}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(estado, null, 2));
  fs.renameSync(temporario, destino);
}

/** Os IPs deste computador na rede da loja (para a TV e o garçom chegarem). */
export function ipsDaRede(): string[] {
  const ips: string[] = [];
  for (const placas of Object.values(os.networkInterfaces())) {
    for (const p of placas || []) {
      if (p.family !== "IPv4" || p.internal) continue;
      if (p.address.startsWith("169.254.")) continue; // sem DHCP: não é a rede da loja
      ips.push(p.address);
    }
  }
  return ips;
}
