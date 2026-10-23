/**
 * Cópia inicial do volume de uploads para o bucket (Cloudflare R2) — a fase 3
 * do plano de duas instâncias (src/lib/arquivos-no-bucket.ts).
 *
 * Depois que o bucket está ligado, toda gravação nova já sobe sozinha; isto
 * aqui leva o que estava no disco ANTES (fotos, logos, vídeos, tutoriais e o
 * cofre fiscal). Idempotente: lista o bucket primeiro e só sobe o que falta
 * (ou o que tem tamanho diferente). Pode rodar de novo quantas vezes quiser —
 * por exemplo, se o log mostrar "[bucket] não subiu" de alguma gravação.
 *
 *   - public/uploads/<x>          → uploads/<x>
 *   - public/uploads/_fiscal/<x>  → fiscal/<x>   (o cofre: já cifrado, fora do
 *                                    prefixo que a rota /uploads consulta)
 *
 * Sem dependência nenhuma (só node:crypto e fetch), para rodar DENTRO do
 * container, que tem as variáveis R2_* e o volume montado:
 *
 *   docker cp scripts/copiar-uploads-para-o-bucket.mjs <container>:/tmp/copiar.mjs
 *   docker exec <container> node /tmp/copiar.mjs --simular   (só conta)
 *   docker exec <container> node /tmp/copiar.mjs
 *
 * A pasta é UPLOADS_DIR, ou public/uploads da pasta atual (no container, /app),
 * ou o primeiro argumento que não começa com "--". FH_FISCAL_DIR, se existir e
 * estiver fora dela, também vai para fiscal/.
 *
 * A assinatura (SigV4) é a mesma de src/lib/arquivos-no-bucket.ts, copiada
 * porque o container não tem o TypeScript; scripts/teste-arquivos-no-bucket.ts
 * roda este arquivo contra o bucket falso, que confere cada assinatura.
 */
import { createHash, createHmac } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const simular = process.argv.includes("--simular");
const pastaDoArgumento = process.argv.slice(2).find((a) => !a.startsWith("--"));
const RAIZ = path.resolve(pastaDoArgumento || process.env.UPLOADS_DIR || path.join(process.cwd(), "public", "uploads"));
const COFRE_A_PARTE = process.env.FH_FISCAL_DIR ? path.resolve(process.env.FH_FISCAL_DIR) : null;

const conta = (process.env.R2_ACCOUNT_ID || "").trim();
const chaveId = (process.env.R2_ACCESS_KEY_ID || "").trim();
const segredo = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
const bucket = (process.env.R2_BUCKET || "").trim();
if (!conta || !chaveId || !segredo || !bucket) {
  console.error("Faltam variáveis: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_BUCKET.");
  process.exit(2);
}
const endpoint = ((process.env.R2_ENDPOINT || "").trim() || `https://${conta}.r2.cloudflarestorage.com`).replace(/\/+$/, "");

// ─── Assinatura (igual a src/lib/arquivos-no-bucket.ts) ───────────────────
const codificar = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const sha256 = (d) => createHash("sha256").update(d).digest("hex");
const hmac = (k, d) => createHmac("sha256", k).update(d, "utf8").digest();
const dataDaAws = (q) => q.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function assinar({ metodo, url, cabecalhos, hashDoCorpo, quando }) {
  const caminho = url.pathname.split("/").map((p) => codificar(decodeURIComponent(p))).join("/") || "/";
  const consulta = url.search.slice(1).split("&").filter(Boolean)
    .map((par) => {
      const i = par.indexOf("=");
      return [codificar(decodeURIComponent(i < 0 ? par : par.slice(0, i))), codificar(decodeURIComponent(i < 0 ? "" : par.slice(i + 1)))];
    })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join("&");
  const todos = { host: url.host };
  for (const [n, v] of Object.entries(cabecalhos)) todos[n.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  const nomes = Object.keys(todos).sort();
  const canonico = [metodo, caminho, consulta, nomes.map((n) => `${n}:${todos[n]}\n`).join(""), nomes.join(";"), hashDoCorpo].join("\n");
  const q = dataDaAws(quando);
  const dia = q.slice(0, 8);
  const escopo = `${dia}/auto/s3/aws4_request`;
  const chave = hmac(hmac(hmac(hmac(`AWS4${segredo}`, dia), "auto"), "s3"), "aws4_request");
  const assinatura = createHmac("sha256", chave).update(["AWS4-HMAC-SHA256", q, escopo, sha256(canonico)].join("\n"), "utf8").digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${chaveId}/${escopo}, SignedHeaders=${nomes.join(";")}, Signature=${assinatura}`;
}

async function pedir(metodo, chave, { corpo, consulta, tipo } = {}) {
  const url = new URL(`${endpoint}/${codificar(bucket)}${chave ? "/" + chave.split("/").map(codificar).join("/") : ""}${consulta ? "?" + consulta : ""}`);
  const hashDoCorpo = sha256(corpo ?? "");
  const agora = new Date();
  const cabecalhos = { "x-amz-content-sha256": hashDoCorpo, "x-amz-date": dataDaAws(agora), ...(tipo ? { "content-type": tipo } : {}) };
  const authorization = assinar({ metodo, url, cabecalhos, hashDoCorpo, quando: agora });
  return fetch(url, { method: metodo, headers: { ...cabecalhos, authorization }, body: corpo ? new Uint8Array(corpo) : undefined, signal: AbortSignal.timeout(120_000) });
}

const desfazerXml = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

async function listar(prefixo) {
  const tamanhos = new Map();
  let continuacao = "";
  for (;;) {
    const r = await pedir("GET", "", { consulta: `list-type=2&prefix=${codificar(prefixo)}${continuacao ? `&continuation-token=${codificar(continuacao)}` : ""}` });
    if (!r.ok) throw new Error(`listar ${prefixo}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    const xml = await r.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const k = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1];
      if (k) tamanhos.set(desfazerXml(k), Number(/<Size>(\d+)<\/Size>/.exec(m[1])?.[1] ?? 0));
    }
    const seguinte = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !seguinte) return tamanhos;
    continuacao = desfazerXml(seguinte);
  }
}

const TIPOS = {
  ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".pdf": "application/pdf", ".mp4": "video/mp4", ".webm": "video/webm", ".vtt": "text/vtt",
};

/** Arquivo pela metade (envio em pedaços, gravação atômica, descida do bucket) não sobe. */
const ehTemporario = (nome) => nome.startsWith(".") || /\.(tmp|parcial|baixando)$/i.test(nome);

async function* arquivos(pasta) {
  let itens;
  try {
    itens = await readdir(pasta, { withFileTypes: true });
  } catch {
    return;
  }
  for (const item of itens) {
    const caminho = path.join(pasta, item.name);
    if (item.isDirectory()) yield* arquivos(caminho);
    else if (item.isFile() && !ehTemporario(item.name)) yield caminho;
  }
}

async function main() {
  console.log(`pasta: ${RAIZ}${COFRE_A_PARTE ? ` + cofre em ${COFRE_A_PARTE}` : ""}`);
  console.log(`bucket: ${bucket} em ${endpoint}${simular ? " (simulando: nada sobe)" : ""}`);
  const noBucket = new Map([...(await listar("uploads/")), ...(await listar("fiscal/"))]);
  console.log(`já no bucket: ${noBucket.size} arquivo(s)`);

  const fila = [];
  for await (const caminho of arquivos(RAIZ)) {
    const rel = path.relative(RAIZ, caminho).split(path.sep).join("/");
    const chave = /^_fiscal\//i.test(rel) ? `fiscal/${rel.slice("_fiscal/".length)}` : `uploads/${rel}`;
    fila.push({ caminho, chave });
  }
  if (COFRE_A_PARTE && !COFRE_A_PARTE.startsWith(RAIZ + path.sep)) {
    for await (const caminho of arquivos(COFRE_A_PARTE)) {
      fila.push({ caminho, chave: `fiscal/${path.relative(COFRE_A_PARTE, caminho).split(path.sep).join("/")}` });
    }
  }

  let iguais = 0, subiram = 0, bytes = 0;
  const falhas = [];
  const faltam = [];
  for (const item of fila) {
    const tamanho = (await stat(item.caminho)).size;
    if (noBucket.get(item.chave) === tamanho) iguais++;
    else faltam.push({ ...item, tamanho });
  }
  console.log(`no disco: ${fila.length}; iguais no bucket: ${iguais}; faltam: ${faltam.length} (${(faltam.reduce((s, f) => s + f.tamanho, 0) / 1024 / 1024).toFixed(1)} MB)`);
  if (simular) return;

  // Quatro de cada vez: rápido o bastante para ~180 MB e sem afogar a CPU do servidor no ar.
  let proximo = 0;
  async function trabalhador() {
    while (proximo < faltam.length) {
      const item = faltam[proximo++];
      try {
        const corpo = await readFile(item.caminho);
        const tipo = item.chave.startsWith("fiscal/") ? "application/octet-stream" : TIPOS[path.extname(item.caminho).toLowerCase()] || "application/octet-stream";
        const r = await pedir("PUT", item.chave, { corpo, tipo });
        if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
        subiram++;
        bytes += corpo.length;
        if (subiram % 50 === 0) console.log(`  ${subiram}/${faltam.length}…`);
      } catch (e) {
        falhas.push(`${item.chave}: ${e?.message || e}`);
      }
    }
  }
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);

  console.log(`subiram: ${subiram} (${(bytes / 1024 / 1024).toFixed(1)} MB); falharam: ${falhas.length}`);
  for (const f of falhas.slice(0, 30)) console.log(`  ✖ ${f}`);
  if (falhas.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("Parou:", e?.message || e);
  process.exit(1);
});
