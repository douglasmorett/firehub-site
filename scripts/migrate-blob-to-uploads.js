#!/usr/bin/env node
/**
 * Tira as ultimas imagens do Vercel Blob e traz para o disco do VPS.
 *
 * Por que existe: o codigo ja nao usa @vercel/blob (src/lib/storage.ts grava em
 * /uploads e a rota src/app/uploads/[...path] entrega), mas o BANCO ainda tem
 * linhas apontando para https://<store>.public.blob.vercel-storage.com/...
 * Enquanto UMA linha dessas existir, apagar o Blob quebra a imagem da loja — e
 * e por isso que a conta da Vercel nao pode ser cancelada.
 *
 * O que faz: varre toda coluna de imagem do schema, baixa o que ainda aponta
 * para o Blob, regrava em public/uploads/ (comprimido igual ao upload normal) e
 * troca a coluna pela URL /uploads/... Idempotente: rodar de novo nao acha nada.
 *
 * ── COMO RODAR ──────────────────────────────────────────────────────────────
 *   1) SEMPRE comece pelo dry-run (baixa e mostra, nao grava nada):
 *        node scripts/migrate-blob-to-uploads.js
 *   2) Conferindo a lista, aplique:
 *        node scripts/migrate-blob-to-uploads.js --apply
 *
 * ⚠️ ONDE RODAR: DENTRO do container, senao os arquivos ficam na sua maquina e
 *    o site devolve 404. O volume do Coolify
 *    (binibyxzlgkm4qhfcydy6ocj-firehub-uploads) esta montado em public/uploads:
 *        docker exec -it <container-firehub> node scripts/migrate-blob-to-uploads.js
 *        docker exec -it <container-firehub> node scripts/migrate-blob-to-uploads.js --apply
 *
 * A raiz padrao e public/uploads porque e ali que src/lib/storage.ts grava e a
 * rota le. NAO mudar para ./uploads: o arquivo existe no disco e mesmo assim a
 * imagem some.
 *
 * Depois que este script sair com "restam: 0", ai sim da para apagar o Blob
 * Store, desligar o auto-deploy do repo na Vercel e derrubar o plano Pro.
 */

const { PrismaClient } = require("@prisma/client");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const APPLY = process.argv.includes("--apply");

// Mesma raiz de src/lib/storage.ts. Ver o comentario la sobre o volume.
const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(process.cwd(), "public", "uploads");

/** O que caracteriza uma URL que ainda mora na Vercel. */
const MARCA = "blob.vercel-storage";

/**
 * Toda coluna do schema que guarda imagem. Se um model nao existir no client
 * gerado, o try/catch abaixo pula sem derrubar a migracao.
 */
const ALVOS = [
  { model: "user", campo: "storeLogo", pasta: "lojas", rotulo: "storeName" },
  { model: "user", campo: "storeBanner", pasta: "lojas", rotulo: "storeName" },
  { model: "menuProduct", campo: "imageUrl", pasta: "produtos", rotulo: "name" },
  { model: "menuCategory", campo: "imageUrl", pasta: "produtos", rotulo: "name" },
  { model: "product", campo: "imageUrl", pasta: "produtos", rotulo: "name" },
  { model: "purchaseInvoice", campo: "imageUrl", pasta: "invoices", rotulo: null },
  { model: "stockInvoice", campo: "imageUrl", pasta: "invoices", rotulo: null },
  // MetaAdsCampaign nao tem coluna `name` — fica sem rotulo, sai pelo id.
  { model: "metaAdsCampaign", campo: "adImageUrl", pasta: "marketing", rotulo: null },
];

// sharp e opcional: sem ele grava o arquivo como veio (ja resolve o problema da
// Vercel), com ele encolhe como o upload normal encolhe.
let sharp = null;
try {
  sharp = require("sharp");
} catch {
  /* segue sem otimizar */
}

const kb = (n) => Math.round(n / 1024) + " KB";

const EXT_POR_MIME = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
};

/** Baixa a URL do Blob. Devolve o buffer e o tipo declarado pelo servidor. */
async function baixar(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("arquivo vazio");
  const mime = (res.headers.get("content-type") || "").split(";")[0].toLowerCase();
  return { buffer, mime };
}

/**
 * Extensao pelo conteudo, nao pelo nome: o Blob guarda arquivo sem extensao e o
 * content-type nem sempre vem. Os bytes nao mentem (mesma checagem de storage.ts).
 */
function extPelosBytes(b) {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b.slice(0, 4).toString("ascii") === "RIFF" && b.slice(8, 12).toString("ascii") === "WEBP") return "webp";
  if (b.slice(0, 4).toString("ascii") === "%PDF") return "pdf";
  return null;
}

async function regravar(url, pasta, rotulo) {
  const { buffer: original, mime } = await baixar(url);

  let ext = extPelosBytes(original) || EXT_POR_MIME[mime];
  if (!ext) throw new Error(`tipo nao reconhecido (content-type: ${mime || "vazio"})`);

  let buffer = original;
  if (sharp && ext !== "pdf") {
    try {
      const otimizada = await sharp(original)
        .rotate()
        .resize(900, 900, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      // Se "otimizar" engordou (imagem ja minuscula), fica com a original.
      if (otimizada.length < original.length) {
        buffer = otimizada;
        ext = "webp";
      }
    } catch (e) {
      console.warn(`    (sharp falhou em ${rotulo}, gravando original: ${e.message})`);
    }
  }

  const nome = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-migrado.${ext}`;
  const destDir = path.join(UPLOADS_ROOT, pasta);

  if (APPLY) {
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(path.join(destDir, nome), buffer);
  }

  return { novaUrl: `/uploads/${pasta}/${nome}`, antes: original.length, depois: buffer.length };
}

async function main() {
  const prisma = new PrismaClient();

  console.log(
    APPLY
      ? "MODO APLICAR — vai gravar arquivos e alterar o banco\n"
      : "DRY-RUN — baixa para conferir, nada e alterado. Use --apply para valer.\n"
  );
  console.log("destino dos arquivos:", UPLOADS_ROOT);
  console.log("otimizacao com sharp:", sharp ? "sim" : "NAO (grava o original)");
  console.log();

  let migrados = 0;
  let falhas = 0;
  const pendentes = [];

  for (const alvo of ALVOS) {
    const delegate = prisma[alvo.model];
    if (!delegate) continue; // model nao existe neste schema

    let linhas;
    try {
      linhas = await delegate.findMany({
        where: { [alvo.campo]: { contains: MARCA } },
        select: { id: true, [alvo.campo]: true, ...(alvo.rotulo ? { [alvo.rotulo]: true } : {}) },
      });
    } catch (e) {
      console.log(`(pulando ${alvo.model}.${alvo.campo}: ${e.message.split("\n")[0]})`);
      continue;
    }

    if (!linhas.length) continue;
    console.log(`${alvo.model}.${alvo.campo} apontando para o Blob: ${linhas.length}`);

    for (const linha of linhas) {
      const nome = (alvo.rotulo && linha[alvo.rotulo]) || linha.id.slice(-6);
      const rotulo = `${nome} / ${alvo.campo}`;
      try {
        const r = await regravar(linha[alvo.campo], alvo.pasta, rotulo);
        migrados++;
        console.log(`  ok ${rotulo}: ${kb(r.antes)} -> ${kb(r.depois)}  ${r.novaUrl}`);
        if (APPLY) {
          await delegate.update({ where: { id: linha.id }, data: { [alvo.campo]: r.novaUrl } });
        }
      } catch (e) {
        falhas++;
        pendentes.push(`${alvo.model}.${alvo.campo} ${rotulo}: ${e.message}`);
        console.log(`  FALHOU ${rotulo}: ${e.message}`);
        console.log(`         ${linha[alvo.campo]}`);
      }
    }
    console.log();
  }

  // Confere quantas linhas AINDA apontam para a Vercel depois de tudo.
  let restam = 0;
  for (const alvo of ALVOS) {
    const delegate = prisma[alvo.model];
    if (!delegate) continue;
    try {
      restam += await delegate.count({ where: { [alvo.campo]: { contains: MARCA } } });
    } catch {
      /* model sem a coluna */
    }
  }

  console.log("------------------------------------------");
  console.log(`migrados: ${migrados}   falhas: ${falhas}`);
  console.log(`restam apontando para o Blob: ${APPLY ? restam : restam + " (dry-run: nada foi trocado)"}`);

  if (pendentes.length) {
    console.log("\nPrecisam de decisao manual (o arquivo sumiu do Blob ou nao e imagem):");
    for (const p of pendentes) console.log("  -", p);
    console.log("Nestes casos a imagem JA esta quebrada hoje — limpe a coluna ou reenvie pelo painel.");
  }

  if (APPLY && restam === 0 && !pendentes.length) {
    console.log("\nZerado. Agora da para apagar o Blob Store e derrubar o plano Pro da Vercel.");
  }
  if (!APPLY) console.log("\nNada foi alterado. Rode de novo com --apply para aplicar.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
