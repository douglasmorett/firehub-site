/**
 * src/lib/arquivos-no-bucket.ts
 * A cópia dos arquivos no bucket (Cloudflare R2, que fala a língua do S3) —
 * para o FireHub rodar em DUAS instâncias.
 *
 * ─── Por que existe ────────────────────────────────────────────────────────
 * Foto, logo, vídeo da capa, criativo do Meta Ads, tutorial e o cofre fiscal
 * moram no disco da máquina (o volume do Coolify em public/uploads). Com duas
 * instâncias atrás do balanceador, o que uma grava a outra não tem: a logo que
 * o lojista acabou de enviar para a A abre 404 quando o cliente cai na B, e a
 * nota emitida na A não abre o XML na B.
 *
 * O disco continua sendo o primeiro lugar — é rápido e já funciona. O bucket é
 * o lugar que as duas enxergam: gravar vai ao disco E ao bucket; ler tenta o
 * disco e, se não achar, traz do bucket para o disco (lib/storage.ts,
 * lib/nfce/armazenamento.ts).
 *
 * ─── Desligado sem as variáveis ────────────────────────────────────────────
 * Só liga com R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e
 * R2_BUCKET. Sem elas nenhuma função daqui sai para a rede, e o site faz
 * exatamente o que fazia antes. R2_ENDPOINT troca o endereço (o bucket falso
 * dos testes, ou outro S3).
 *
 * ─── Nada aqui derruba a requisição ────────────────────────────────────────
 * Toda função devolve false/null quando o bucket falha (fora do ar, credencial
 * errada, demora) e só avisa no log. A gravação no disco já aconteceu antes e
 * vale sozinha — o lojista não pode perder a foto porque a Cloudflare engasgou.
 *
 * ─── Por que a assinatura é feita à mão ────────────────────────────────────
 * O @aws-sdk/client-s3 são dezenas de pacotes para quatro chamadas (PUT, GET,
 * DELETE e a listagem). A assinatura (AWS Signature Version 4) é HMAC-SHA256
 * do node:crypto, e é conferida contra os vetores oficiais da AWS em
 * scripts/teste-arquivos-no-bucket.ts.
 *
 * Só servidor.
 */
import { createHash, createHmac, randomBytes } from "crypto";
import { createWriteStream } from "fs";
import { mkdir, rename, unlink } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

type ConfigDoBucket = { endpoint: string; bucket: string; chaveId: string; segredo: string; regiao: string };

/**
 * Lida a cada chamada (é barato): assim os testes ligam e desligam o bucket
 * trocando as variáveis, sem recarregar o módulo.
 */
function configDoBucket(): ConfigDoBucket | null {
  const conta = (process.env.R2_ACCOUNT_ID || "").trim();
  const chaveId = (process.env.R2_ACCESS_KEY_ID || "").trim();
  const segredo = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucket = (process.env.R2_BUCKET || "").trim();
  if (!conta || !chaveId || !segredo || !bucket) return null;
  const endpoint = ((process.env.R2_ENDPOINT || "").trim() || `https://${conta}.r2.cloudflarestorage.com`).replace(/\/+$/, "");
  // O R2 aceita "auto" como região; é o que entra no escopo da assinatura.
  return { endpoint, bucket, chaveId, segredo, regiao: "auto" };
}

export function bucketLigado(): boolean {
  return configDoBucket() !== null;
}

// ─── Assinatura (AWS Signature Version 4) ─────────────────────────────────

/** Codificação da RFC 3986 que a AWS exige: só A-Z a-z 0-9 - . _ ~ passam crus. */
export function codificar(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

const sha256 = (dado: string | Buffer) => createHash("sha256").update(dado).digest("hex");
const hmac = (chave: string | Buffer, dado: string) => createHmac("sha256", chave).update(dado, "utf8").digest();

/** 2015-08-30T12:36:00.000Z → 20150830T123600Z */
export const dataDaAws = (quando: Date) => quando.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * Monta o cabeçalho Authorization. Assina TODOS os `cabecalhos` passados mais
 * o host; quem chama decide o que vai (x-amz-date e x-amz-content-sha256 o S3
 * exige). O caminho é codificado uma vez só, como o S3 espera.
 */
export function assinarSigV4(p: {
  metodo: string;
  url: URL;
  cabecalhos: Record<string, string>;
  hashDoCorpo: string;
  regiao: string;
  servico: string;
  chaveId: string;
  segredo: string;
  quando: Date;
}): string {
  const caminho = p.url.pathname
    .split("/")
    .map((parte) => codificar(decodeURIComponent(parte)))
    .join("/") || "/";

  // Sem URLSearchParams: ele lê "+" como espaço, e a AWS não.
  const consulta = p.url.search
    .slice(1)
    .split("&")
    .filter(Boolean)
    .map((par) => {
      const i = par.indexOf("=");
      const k = i < 0 ? par : par.slice(0, i);
      const v = i < 0 ? "" : par.slice(i + 1);
      return [codificar(decodeURIComponent(k)), codificar(decodeURIComponent(v))] as const;
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const todos: Record<string, string> = { host: p.url.host };
  for (const [nome, valor] of Object.entries(p.cabecalhos)) todos[nome.toLowerCase()] = String(valor).trim().replace(/\s+/g, " ");
  const nomes = Object.keys(todos).sort();
  const assinados = nomes.join(";");

  const pedidoCanonico = [
    p.metodo.toUpperCase(),
    caminho,
    consulta,
    nomes.map((n) => `${n}:${todos[n]}\n`).join(""),
    assinados,
    p.hashDoCorpo,
  ].join("\n");

  const quando = dataDaAws(p.quando);
  const dia = quando.slice(0, 8);
  const escopo = `${dia}/${p.regiao}/${p.servico}/aws4_request`;
  const paraAssinar = ["AWS4-HMAC-SHA256", quando, escopo, sha256(pedidoCanonico)].join("\n");

  const chave = hmac(hmac(hmac(hmac(`AWS4${p.segredo}`, dia), p.regiao), p.servico), "aws4_request");
  const assinatura = createHmac("sha256", chave).update(paraAssinar, "utf8").digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${p.chaveId}/${escopo}, SignedHeaders=${assinados}, Signature=${assinatura}`;
}

// ─── As chamadas ao bucket ───────────────────────────────────────────────

async function pedir(
  cfg: ConfigDoBucket,
  metodo: "GET" | "PUT" | "DELETE",
  chave: string,
  opcoes: { corpo?: Buffer; tipo?: string; consulta?: string; prazoMs: number }
): Promise<Response> {
  const caminho = chave ? "/" + chave.split("/").map(codificar).join("/") : "";
  const url = new URL(`${cfg.endpoint}/${codificar(cfg.bucket)}${caminho}${opcoes.consulta ? "?" + opcoes.consulta : ""}`);
  const corpo = opcoes.corpo;
  const hashDoCorpo = sha256(corpo ?? "");
  const agora = new Date();
  const cabecalhos: Record<string, string> = {
    "x-amz-content-sha256": hashDoCorpo,
    "x-amz-date": dataDaAws(agora),
    ...(opcoes.tipo ? { "content-type": opcoes.tipo } : {}),
  };
  const authorization = assinarSigV4({
    metodo, url, cabecalhos, hashDoCorpo, regiao: cfg.regiao, servico: "s3", chaveId: cfg.chaveId, segredo: cfg.segredo, quando: agora,
  });
  return fetch(url, {
    method: metodo,
    headers: { ...cabecalhos, authorization },
    body: corpo ? new Uint8Array(corpo) : undefined,
    signal: AbortSignal.timeout(opcoes.prazoMs),
  });
}

const motivo = (e: unknown) => (e as Error)?.message || String(e);

/** Tipo gravado junto no bucket (só informativo: quem serve é a rota /uploads, com os próprios cabeçalhos). */
const TIPOS: Record<string, string> = {
  ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm", ".vtt": "text/vtt",
};
export const tipoPelaExtensao = (nome: string) => TIPOS[path.extname(nome).toLowerCase()] || "application/octet-stream";

/**
 * Sobe uma cópia. Devolve false se não subiu (o arquivo continua no disco).
 * O prazo cresce com o tamanho: um tutorial de 14 MB não sobe em 15 s em
 * qualquer rede.
 */
export async function subirAoBucket(chave: string, corpo: Buffer, tipo?: string): Promise<boolean> {
  const cfg = configDoBucket();
  if (!cfg) return false;
  try {
    const prazoMs = Math.min(120_000, 15_000 + Math.ceil(corpo.length / 100_000) * 1000);
    const r = await pedir(cfg, "PUT", chave, { corpo, tipo: tipo || tipoPelaExtensao(chave), prazoMs });
    if (r.ok) return true;
    console.warn(`[bucket] não subiu ${chave}: HTTP ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
  } catch (e) {
    console.warn(`[bucket] não subiu ${chave}: ${motivo(e)}`);
  }
  return false;
}

/** Baixa inteiro para a memória (o cofre fiscal: arquivos de poucos KB). null = não tem ou falhou. */
export async function baixarDoBucket(chave: string): Promise<Buffer | null> {
  const cfg = configDoBucket();
  if (!cfg) return null;
  try {
    const r = await pedir(cfg, "GET", chave, { prazoMs: 15_000 });
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (r.status !== 404) console.warn(`[bucket] não baixou ${chave}: HTTP ${r.status}`);
  } catch (e) {
    console.warn(`[bucket] não baixou ${chave}: ${motivo(e)}`);
  }
  return null;
}

/**
 * Baixa direto para o disco, em fluxo (vídeo não passa pela memória). Grava
 * num temporário e troca de nome no fim: quem pedir o mesmo arquivo no meio da
 * descida nunca lê metade.
 */
export async function baixarDoBucketParaODisco(chave: string, destino: string, modo?: number): Promise<boolean> {
  const cfg = configDoBucket();
  if (!cfg) return false;
  const temporario = `${destino}.${randomBytes(6).toString("hex")}.baixando`;
  try {
    const r = await pedir(cfg, "GET", chave, { prazoMs: 60_000 });
    if (!r.ok || !r.body) {
      if (r.status !== 404) console.warn(`[bucket] não baixou ${chave}: HTTP ${r.status}`);
      return false;
    }
    await mkdir(/*turbopackIgnore: true*/ path.dirname(destino), { recursive: true });
    await pipeline(
      Readable.fromWeb(r.body as unknown as import("stream/web").ReadableStream),
      createWriteStream(/*turbopackIgnore: true*/ temporario, modo ? { mode: modo } : {})
    );
    await rename(/*turbopackIgnore: true*/ temporario, /*turbopackIgnore: true*/ destino);
    return true;
  } catch (e) {
    console.warn(`[bucket] não baixou ${chave}: ${motivo(e)}`);
    await unlink(/*turbopackIgnore: true*/ temporario).catch(() => {});
    return false;
  }
}

/** Apaga a cópia (o certificado substituído). Não ter o que apagar também é sucesso para o S3. */
export async function apagarDoBucket(chave: string): Promise<boolean> {
  const cfg = configDoBucket();
  if (!cfg) return false;
  try {
    const r = await pedir(cfg, "DELETE", chave, { prazoMs: 15_000 });
    if (r.ok) return true;
    console.warn(`[bucket] não apagou ${chave}: HTTP ${r.status}`);
  } catch (e) {
    console.warn(`[bucket] não apagou ${chave}: ${motivo(e)}`);
  }
  return false;
}

const desfazerXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** Lista as chaves de um prefixo (ListObjectsV2, página por página). null = falhou. */
export async function listarDoBucket(prefixo: string): Promise<{ chave: string; bytes: number }[] | null> {
  const cfg = configDoBucket();
  if (!cfg) return null;
  const lista: { chave: string; bytes: number }[] = [];
  let continuacao = "";
  try {
    for (let pagina = 0; pagina < 1000; pagina++) {
      const consulta = `list-type=2&prefix=${codificar(prefixo)}${continuacao ? `&continuation-token=${codificar(continuacao)}` : ""}`;
      const r = await pedir(cfg, "GET", "", { consulta, prazoMs: 15_000 });
      if (!r.ok) {
        console.warn(`[bucket] não listou ${prefixo}: HTTP ${r.status}`);
        return null;
      }
      const xml = await r.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const chave = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1];
        const bytes = Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0);
        if (chave) lista.push({ chave: desfazerXml(chave), bytes });
      }
      const seguinte = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !seguinte) return lista;
      continuacao = desfazerXml(seguinte);
    }
    return lista;
  } catch (e) {
    console.warn(`[bucket] não listou ${prefixo}: ${motivo(e)}`);
    return null;
  }
}
