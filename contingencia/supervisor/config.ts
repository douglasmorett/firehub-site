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
import dgram from "node:dgram";

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

// ── Os IPs da rede da loja ───────────────────────────────────────────────────
//
// A TV e o service worker vão só para o PRIMEIRO endereço do bilhete
// (troca.ts, sw-contingencia.js). Num PC com VPN (Tailscale 100.64/10, Radmin
// 26.x, Hamachi 25.x), Hyper-V/WSL (vEthernet 172.x) ou VirtualBox
// (192.168.56.x), a ordem do os.networkInterfaces() podia pôr o IP virtual na
// frente: a TV pulava para um endereço que ela não alcança e parava no erro do
// Chrome. Agora vem primeiro o IP da placa da ROTA PADRÃO (a que sai para o
// roteador da loja), as placas virtuais e as faixas de VPN saem, e o resto vai
// na ordem das redes de loja (192.168, 10, 172.16-31).

/** Nomes de placa que não são a rede da loja. */
const PLACA_VIRTUAL = /vEthernet|Hyper-V|WSL|VirtualBox|VMware|VMnet|Tailscale|ZeroTier|Radmin|Hamachi|OpenVPN|WireGuard|TAP-|Npcap|Docker|\bVPN\b/i;

function octetos(ip: string): number[] {
  return ip.split(".").map((n) => Number(n));
}

/** Faixas de VPN: CGNAT/Tailscale (100.64.0.0/10), Radmin (26/8) e Hamachi (25/8). */
export function faixaDeVpn(ip: string): boolean {
  const [a, b] = octetos(ip);
  return (a === 100 && b >= 64 && b <= 127) || a === 26 || a === 25;
}

/** Ordem das redes de loja: 192.168 (menos a 192.168.56 do VirtualBox), 10, 172.16-31, o resto. */
function ordemDaRede(ip: string): number {
  const [a, b, c] = octetos(ip);
  if (a === 192 && b === 168) return c === 56 ? 3 : 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 2;
  return 4;
}

type Placa = { family: string | number; internal: boolean; address: string };

/**
 * A regra, sem rede de verdade (scripts/teste-ips-da-rede.ts). `ipDaRota` é o
 * IP da placa que sai para a internet, quando se sabe; ele vem primeiro mesmo
 * numa placa de nome "virtual" (o switch externo do Hyper-V põe o IP da loja
 * numa "vEthernet"), desde que não seja faixa de VPN.
 */
export function escolherIpsDaRede(placas: Record<string, Placa[] | undefined>, ipDaRota: string | null): string[] {
  const todos: { ip: string; virtual: boolean }[] = [];
  for (const [nome, lista] of Object.entries(placas)) {
    for (const p of lista || []) {
      if ((p.family !== "IPv4" && p.family !== 4) || p.internal) continue;
      if (p.address.startsWith("169.254.")) continue; // sem DHCP: não é a rede da loja
      if (faixaDeVpn(p.address)) continue;
      todos.push({ ip: p.address, virtual: PLACA_VIRTUAL.test(nome) });
    }
  }
  const daLoja = todos.filter((x) => !x.virtual);
  // Só placa "virtual": melhor um endereço duvidoso do que nenhum.
  const candidatos = (daLoja.length ? daLoja : todos).map((x) => x.ip);
  const ordenados = candidatos
    .map((ip, i) => ({ ip, i }))
    .sort((a, b) => ordemDaRede(a.ip) - ordemDaRede(b.ip) || a.i - b.i)
    .map((x) => x.ip);
  const daRota = ipDaRota && todos.some((x) => x.ip === ipDaRota) ? [ipDaRota] : [];
  return [...new Set([...daRota, ...ordenados])];
}

let ipDaRotaPadrao: string | null = null;
let rotaConferidaEm = 0;

/**
 * Qual IP local sai para a internet: um socket UDP "conectado" a 8.8.8.8 —
 * connect em UDP não manda pacote nenhum, só pergunta a rota ao Windows. Sem
 * rota (cabo fora), fica sem. Assíncrono: vale a partir da próxima chamada.
 */
function conferirRotaPadrao(): void {
  if (Date.now() - rotaConferidaEm < 30_000) return;
  rotaConferidaEm = Date.now();
  try {
    const s = dgram.createSocket("udp4");
    s.unref();
    const fechar = () => {
      try {
        s.close();
      } catch {
        /* já fechado */
      }
    };
    s.on("error", () => {
      ipDaRotaPadrao = null;
      fechar();
    });
    s.connect(53, "8.8.8.8", (err?: Error | null) => {
      try {
        ipDaRotaPadrao = err ? null : s.address().address;
      } catch {
        ipDaRotaPadrao = null;
      }
      fechar();
    });
  } catch {
    ipDaRotaPadrao = null;
  }
}

/** Os IPs deste computador na rede da loja (para a TV e o garçom chegarem), o da rota padrão primeiro. */
export function ipsDaRede(): string[] {
  conferirRotaPadrao();
  return escolherIpsDaRede(os.networkInterfaces(), ipDaRotaPadrao);
}
