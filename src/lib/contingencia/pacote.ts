/**
 * O PACOTE do computador da loja (Modo Contingência): os arquivos do PRÓPRIO
 * deploy que está no ar — o FireHub (server.js, .next, node_modules) e o
 * supervisor —, listados por hash. O Assistente baixa só o hash que ainda
 * não tem: com vários deploys por dia, cada atualização traz poucos MB.
 *
 * Servir o pacote daqui (e não de um build separado) garante que o
 * computador roda exatamente a versão da nuvem: a cópia, a subida e as telas
 * falam a mesma língua.
 *
 * Fica de fora o que não roda no Windows ou não serve à loja: os binários de
 * Linux (o Windows usa o motor do Prisma de `binaryTargets = windows`), o
 * cache do build, os instaladores e os uploads.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type ArquivoDoPacote = { caminho: string; hash: string; tamanho: number };
export type Pacote = { versao: string; arquivos: ArquivoDoPacote[]; total: number };

const RAIZ = process.cwd();

/** O que não entra no pacote (caminho relativo, com "/"). */
export function ficaDeFora(rel: string): boolean {
  if (rel.startsWith(".next/cache/")) return true;
  if (rel.startsWith("public/downloads/") || rel.startsWith("public/uploads/")) return true;
  if (rel.startsWith("uploads/") || rel.startsWith("scripts/") || rel.startsWith("prisma/")) return true;
  if (rel.startsWith(".git/")) return true;
  // Binário nativo de outro sistema: o Windows não carrega.
  if (/\.(node|so(\.\d+)*)$/.test(rel) && /(linux|musl|darwin|debian|rhel|openssl-1)/i.test(rel)) return true;
  if (/libquery_engine-(?!windows)/.test(rel)) return true;
  return false;
}

function listar(dir: string, base: string, saida: string[]): void {
  for (const nome of fs.readdirSync(dir)) {
    const cheio = path.join(dir, nome);
    const rel = path.relative(base, cheio).split(path.sep).join("/");
    let st: fs.Stats;
    try {
      st = fs.lstatSync(cheio);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (ficaDeFora(`${rel}/`)) continue;
      listar(cheio, base, saida);
    } else if (st.isFile() && !ficaDeFora(rel) && st.size < 80 * 1024 * 1024) {
      saida.push(rel);
    }
  }
}

function hashDoArquivo(cheio: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(cheio)).digest("hex");
}

let emCache: { pacote: Pacote; porHash: Map<string, string> } | null = null;

/** O pacote desta versão (calculado uma vez por processo: os arquivos do deploy não mudam). */
export function pacoteDaVersao(): { pacote: Pacote; porHash: Map<string, string> } {
  if (emCache) return emCache;
  let versao = "dev";
  try {
    versao = fs.readFileSync(path.join(RAIZ, ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    /* fora do build */
  }
  const caminhos: string[] = [];
  listar(RAIZ, RAIZ, caminhos);
  const arquivos: ArquivoDoPacote[] = [];
  const porHash = new Map<string, string>();
  let total = 0;
  for (const rel of caminhos.sort()) {
    const cheio = path.join(RAIZ, rel);
    const tamanho = fs.statSync(cheio).size;
    const hash = hashDoArquivo(cheio);
    arquivos.push({ caminho: rel, hash, tamanho });
    if (!porHash.has(hash)) porHash.set(hash, cheio);
    total += tamanho;
  }
  emCache = { pacote: { versao, arquivos, total }, porHash };
  return emCache;
}
