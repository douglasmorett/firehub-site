/**
 * src/lib/storage.ts
 * Armazenamento de arquivos enviados (fotos de produto, imagens de loja, notas).
 *
 * Substitui o @vercel/blob. Grava em disco, dentro de public/uploads, servido
 * estaticamente pelo proprio Next — sem servico externo e sem credencial.
 *
 * ⚠️ EM PRODUCAO O DIRETORIO PRECISA SER UM VOLUME PERSISTENTE DO COOLIFY.
 * O Dockerfile copia public/ para dentro da imagem, entao sem volume o que for
 * enviado se perde no proximo deploy. Mapear no Coolify:
 *     host  /data/firehub/uploads   ->   container  /app/public/uploads
 * O container roda como o usuario `nextjs` (uid 1001), entao o diretorio no
 * host precisa ser gravavel por ele:  chown -R 1001:1001 /data/firehub/uploads
 */
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import crypto from "crypto";

/** Raiz dos uploads no disco. UPLOADS_DIR permite apontar para outro caminho. */
const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(process.cwd(), "public", "uploads");

/** Prefixo publico correspondente. */
const PUBLIC_PREFIX = "/uploads";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB por arquivo

/** Tipos aceitos. SVG fica de fora de proposito: e vetor de XSS quando servido inline. */
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

/** Pastas permitidas — evita path traversal via o campo `type` do formulario. */
const FOLDERS = new Set(["produtos", "lojas", "invoices", "marketing"]);

export type SavedFile = { url: string; pathname: string; size: number };

function sanitizeFolder(folder?: string | null): string {
  const f = (folder || "").toLowerCase().trim();
  return FOLDERS.has(f) ? f : "produtos";
}

function safeBaseName(name: string, ext: string): string {
  const base = path
    .basename(name || "arquivo")
    .replace(/\.[^.]*$/, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60) || "arquivo";
  // Sufixo aleatorio evita colisao e impede adivinhar a URL de outra loja.
  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${base}.${ext}`;
}

/**
 * Grava um File (do FormData) no disco e devolve a URL publica.
 * Lanca Error com mensagem amigavel quando o arquivo e invalido.
 */
/**
 * Reduz a imagem NO SERVIDOR. Isto nao e otimizacao opcional — e a garantia.
 *
 * Nao ha controle sobre o que o lojista envia: fotos geradas por IA chegam como
 * PNG 1024x1024 de ~1,8 MB. No modal de combo elas sao exibidas em 42x42 pixels.
 * Medido em producao: o cardapio do balcao chegou a 14,63 MB e 38 segundos.
 * A compressao no navegador ajuda, mas pode ser burlada (outro cliente, API
 * direta); aqui e o ponto onde nada passa grande.
 *
 * Sai em WebP: comprime melhor que JPEG e, ao contrario dele, preserva
 * transparencia — logo de loja costuma ter fundo transparente.
 */
async function otimizarImagem(buffer: Buffer, mime: string): Promise<{ buffer: Buffer; ext: string }> {
  if (mime === "application/pdf") return { buffer, ext: "pdf" };

  try {
    const sharp = (await import("sharp")).default;
    const otimizada = await sharp(buffer)
      .rotate() // respeita EXIF, senao foto de celular sai deitada
      .resize(900, 900, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    // Se a "otimizacao" engordou (imagem ja minuscula), fica com a original.
    if (otimizada.length < buffer.length) return { buffer: otimizada, ext: "webp" };
  } catch (err) {
    console.warn("[storage] sharp falhou, gravando original:", (err as Error)?.message);
  }

  return { buffer, ext: ALLOWED[mime] || "bin" };
}

export async function saveUploadedFile(file: File, folder?: string | null): Promise<SavedFile> {
  const mime = (file.type || "").toLowerCase();
  if (!ALLOWED[mime]) {
    throw new Error(`Tipo de arquivo nao suportado: ${file.type || "desconhecido"}. Use JPG, PNG, WEBP, GIF ou PDF.`);
  }
  if (file.size > MAX_BYTES) {
    throw new Error(`Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)} MB). O limite e 8 MB.`);
  }

  const original = Buffer.from(await file.arrayBuffer());
  const { buffer, ext } = await otimizarImagem(original, mime);

  const dir = sanitizeFolder(folder);
  const fileName = safeBaseName(file.name, ext);
  const destDir = path.join(UPLOADS_ROOT, dir);

  await mkdir(destDir, { recursive: true });
  await writeFile(path.join(destDir, fileName), buffer);

  return {
    url: `${PUBLIC_PREFIX}/${dir}/${fileName}`,
    pathname: `${dir}/${fileName}`,
    size: buffer.length,
  };
}

/**
 * Grava um data URI base64 como arquivo. Usado pela migracao das imagens que
 * hoje estao dentro do banco (ver scripts/migrate-base64-images.js).
 */
export async function saveDataUrl(dataUrl: string, folder?: string | null): Promise<SavedFile> {
  const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(dataUrl);
  if (!m) throw new Error("Nao e um data URI base64 valido");

  const mime = m[1].toLowerCase();
  const ext = ALLOWED[mime];
  if (!ext) throw new Error(`Tipo nao suportado no data URI: ${mime}`);

  const original = Buffer.from(m[2], "base64");
  if (original.length > MAX_BYTES) {
    throw new Error(`Imagem embutida muito grande: ${(original.length / 1024 / 1024).toFixed(1)} MB`);
  }

  // Mesma otimizacao do upload normal: a migracao das imagens que hoje estao no
  // banco tem que sair pequena, senao troca base64 gigante por arquivo gigante.
  const { buffer, ext: finalExt } = await otimizarImagem(original, mime);

  const dir = sanitizeFolder(folder);
  const fileName = safeBaseName("imagem", finalExt);
  const destDir = path.join(UPLOADS_ROOT, dir);

  await mkdir(destDir, { recursive: true });
  await writeFile(path.join(destDir, fileName), buffer);

  return {
    url: `${PUBLIC_PREFIX}/${dir}/${fileName}`,
    pathname: `${dir}/${fileName}`,
    size: buffer.length,
  };
}

/** true se o valor guardado e uma imagem embutida em base64 (o problema a migrar). */
export function isDataUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("data:");
}
