/**
 * AS FOTOS DO CARDÁPIO NA CÓPIA (pedido de 12/11/2026: "o sistema completo
 * no PC"). Antes, na queda, o balcão e o garçom mostravam o espaço vazio no
 * lugar de cada foto: as imagens moram em /uploads na nuvem e o pacote deixa
 * public/uploads de fora.
 *
 * Com a nuvem de pé, o supervisor olha na cópia os endereços de imagem
 * (catalogo.ts → FOTOS_DA_COPIA), e baixa da nuvem as que ainda não tem para
 * <pasta>/fotos/<o mesmo caminho de /uploads>. O FireHub local serve dessa
 * pasta (UPLOADS_DIR, firehub-local.ts) pela rota /uploads de sempre.
 *
 * Devagar de propósito: poucas por rodada, uma rodada por minuto, nada na
 * queda; tamanho máximo por foto e no total. A foto é pública (o cardápio
 * online mostra), então vai sem a chave da loja.
 */
import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import { caminhoDaFoto, FOTOS_DA_COPIA } from "../../src/lib/contingencia/catalogo";

const q = (nome: string) => `"${nome.replace(/"/g, '""')}"`;

/** Por rodada: quantas fotos no máximo, e quantas de uma vez. */
export const FOTOS_POR_RODADA = 40;
const DE_UMA_VEZ = 2;
/** Foto maior que isto não desce (foto de produto tem ~50–300 KB). */
export const MAIOR_FOTO = 5 * 1024 * 1024;
/** A pasta de fotos não passa disto. */
export const TODAS_AS_FOTOS = 500 * 1024 * 1024;
/** Foto que deu 404 na nuvem: não tenta de novo antes disto. */
const ESPERA_DO_QUE_FALTOU_MS = 6 * 60 * 60_000;

export function pastaDasFotos(pastaDaCopia: string): string {
  return path.join(pastaDaCopia, "fotos");
}

/** Os caminhos (dentro de /uploads) de todas as fotos que a cópia usa, sem repetir. */
export async function fotosDaCopia(pool: pg.Pool): Promise<string[]> {
  const caminhos = new Set<string>();
  for (const f of FOTOS_DA_COPIA) {
    try {
      const r = await pool.query(`SELECT DISTINCT ${q(f.coluna)} AS v FROM ${q(f.tabela)} WHERE ${q(f.coluna)} LIKE '%/uploads/%'`);
      for (const linha of r.rows) {
        const c = caminhoDaFoto(linha.v);
        if (c) caminhos.add(c);
      }
    } catch {
      /* tabela ou coluna que ainda não existe na cópia: segue */
    }
  }
  return [...caminhos].sort();
}

/** As que faltam no disco (e não faltaram na nuvem há pouco). */
export function fotosQueFaltam(caminhos: string[], pasta: string, faltouNaNuvem: Map<string, number>, agora = Date.now()): string[] {
  return caminhos.filter((c) => !fs.existsSync(path.join(pasta, c)) && (faltouNaNuvem.get(c) ?? 0) <= agora);
}

function tamanhoDaPasta(pasta: string): number {
  let total = 0;
  const andar = (dir: string) => {
    let nomes: fs.Dirent[] = [];
    try {
      nomes = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const n of nomes) {
      const cheio = path.join(dir, n.name);
      if (n.isDirectory()) andar(cheio);
      else if (n.isFile()) total += fs.statSync(cheio).size;
    }
  };
  andar(pasta);
  return total;
}

/** Baixa uma foto (com o tamanho conferido) e grava sem deixar arquivo pela metade. */
async function baixarFoto(nuvem: string, rel: string, destino: string): Promise<"ok" | "faltou" | "grande" | "falhou"> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 30_000);
  try {
    const r = await fetch(`${nuvem}/uploads/${rel}`, { signal: c.signal });
    if (r.status === 404) return "faltou";
    if (!r.ok || !String(r.headers.get("content-type") || "").startsWith("image/")) return "falhou";
    if (Number(r.headers.get("content-length") || 0) > MAIOR_FOTO) return "grande";
    const dados = Buffer.from(await r.arrayBuffer());
    if (dados.length > MAIOR_FOTO) return "grande";
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const tmp = `${destino}.baixando`;
    fs.writeFileSync(tmp, dados);
    fs.renameSync(tmp, destino);
    return "ok";
  } catch {
    return "falhou";
  } finally {
    clearTimeout(t);
  }
}

/**
 * Uma rodada: baixa até FOTOS_POR_RODADA fotos que faltam. Devolve quantas
 * baixou e quantas ainda faltam (para a tela e o registro).
 */
export async function rodadaDeFotos(
  pool: pg.Pool,
  o: { nuvem: string; pasta: string; faltouNaNuvem: Map<string, number>; registro: (l: string) => void },
): Promise<{ baixadas: number; faltam: number; total: number }> {
  const todas = await fotosDaCopia(pool);
  const faltam = fotosQueFaltam(todas, o.pasta, o.faltouNaNuvem);
  if (!faltam.length) return { baixadas: 0, faltam: 0, total: todas.length };
  if (tamanhoDaPasta(o.pasta) >= TODAS_AS_FOTOS) return { baixadas: 0, faltam: faltam.length, total: todas.length };
  const desta = faltam.slice(0, FOTOS_POR_RODADA);
  let baixadas = 0;
  const fila = [...desta];
  const trabalhador = async () => {
    for (let rel = fila.shift(); rel; rel = fila.shift()) {
      const destino = path.join(o.pasta, rel);
      // caminhoDaFoto já recusa "..": aqui é a segunda trava.
      if (!path.resolve(destino).startsWith(path.resolve(o.pasta) + path.sep)) continue;
      const r = await baixarFoto(o.nuvem, rel, destino);
      if (r === "ok") baixadas++;
      else if (r === "faltou" || r === "grande") o.faltouNaNuvem.set(rel, Date.now() + ESPERA_DO_QUE_FALTOU_MS);
    }
  };
  await Promise.all(Array.from({ length: DE_UMA_VEZ }, trabalhador));
  if (baixadas) o.registro(`Fotos do cardápio: ${baixadas} baixada(s), faltam ${faltam.length - baixadas} de ${todas.length}.`);
  return { baixadas, faltam: faltam.length - baixadas, total: todas.length };
}
