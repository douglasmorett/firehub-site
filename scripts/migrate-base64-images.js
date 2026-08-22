#!/usr/bin/env node
/**
 * Migra as imagens que estão gravadas em base64 DENTRO do banco para arquivos.
 *
 * Por que existe: o formulário do cardápio gravava `data:image/png;base64,...`
 * direto na coluna imageUrl. O cardápio público de uma loja chegou a 18,7 MB,
 * sendo 18,5 MB só de 10 fotos (~1,8 MB cada, PNG 1024x1024 sem compressão).
 * Toda tela que lista produto baixava tudo isso — por isso balcão, mesa e
 * cardápio demoravam a abrir.
 *
 * O que faz: acha todo MenuProduct/User com imagem embutida, grava o arquivo em
 * public/uploads/ (redimensionando e comprimindo se `sharp` estiver disponível)
 * e troca a coluna pela URL.
 *
 * ── COMO RODAR ──────────────────────────────────────────────────────────────
 *   1) SEMPRE comece pelo dry-run (não escreve nada):
 *        node scripts/migrate-base64-images.js
 *   2) Conferindo a lista, aplique:
 *        node scripts/migrate-base64-images.js --apply
 *
 * ⚠️ ONDE RODAR: os arquivos precisam acabar no MESMO disco que o site serve.
 *    Se você já configurou o volume persistente no Coolify
 *    (host /data/firehub/uploads -> container /app/public/uploads), rode DENTRO
 *    do container, senão os arquivos ficam na sua máquina e o site devolve 404:
 *        docker exec -it firehub-app node scripts/migrate-base64-images.js --apply
 *
 *    Rodando local, use UPLOADS_DIR para apontar para onde quiser.
 */

const { PrismaClient } = require("@prisma/client");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const APPLY = process.argv.includes("--apply");
const UPLOADS_ROOT = process.env.UPLOADS_DIR || path.join(process.cwd(), "public", "uploads");

const EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// sharp é opcional: sem ele o arquivo é gravado como está (ainda assim sai do
// banco e para de inflar toda listagem), com ele encolhe ~95%.
let sharp = null;
try {
  sharp = require("sharp");
} catch {
  /* segue sem otimizar */
}

const mb = (n) => (n / 1024 / 1024).toFixed(2) + " MB";
const kb = (n) => Math.round(n / 1024) + " KB";

async function gravar(dataUrl, folder, rotulo) {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error("data URI inválido");

  const mime = m[1].toLowerCase();
  let ext = EXT[mime];
  if (!ext) throw new Error(`tipo não suportado: ${mime}`);

  let buffer = Buffer.from(m[2], "base64");
  const original = buffer.length;

  if (sharp) {
    try {
      buffer = await sharp(buffer)
        .rotate()
        .resize(900, 900, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      ext = "webp";
    } catch (e) {
      console.warn(`    (sharp falhou em ${rotulo}, gravando original: ${e.message})`);
    }
  }

  const nome = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-migrado.${ext}`;
  const destDir = path.join(UPLOADS_ROOT, folder);

  if (APPLY) {
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(path.join(destDir, nome), buffer);
  }

  return { url: `/uploads/${folder}/${nome}`, original, final: buffer.length };
}

async function main() {
  const prisma = new PrismaClient();
  console.log(APPLY ? "MODO APLICAR — vai gravar arquivos e alterar o banco\n" : "DRY-RUN — nada será alterado. Use --apply para valer.\n");
  console.log("destino dos arquivos:", UPLOADS_ROOT);
  console.log("otimização com sharp:", sharp ? "sim" : "NÃO (instale com `npm i sharp` para encolher ~95%)");
  console.log();

  let totalAntes = 0;
  let totalDepois = 0;
  let convertidos = 0;
  let falhas = 0;

  // ── Produtos ──
  const produtos = await prisma.menuProduct.findMany({
    where: { imageUrl: { startsWith: "data:" } },
    select: { id: true, name: true, imageUrl: true, franchiseeId: true },
  });
  console.log(`Produtos com imagem embutida: ${produtos.length}`);

  for (const p of produtos) {
    const rotulo = `${p.name} (${p.id.slice(-6)})`;
    try {
      const r = await gravar(p.imageUrl, "produtos", rotulo);
      totalAntes += r.original;
      totalDepois += r.final;
      convertidos++;
      console.log(`  ✔ ${rotulo}: ${kb(r.original)} -> ${kb(r.final)}  ${r.url}`);
      if (APPLY) {
        await prisma.menuProduct.update({ where: { id: p.id }, data: { imageUrl: r.url } });
      }
    } catch (e) {
      falhas++;
      console.log(`  ✖ ${rotulo}: ${e.message}`);
    }
  }

  // ── Logo / banner de loja ──
  for (const campo of ["storeLogo", "storeBanner"]) {
    let lojas = [];
    try {
      lojas = await prisma.user.findMany({
        where: { [campo]: { startsWith: "data:" } },
        select: { id: true, name: true, [campo]: true },
      });
    } catch {
      continue; // campo não existe no schema
    }
    if (lojas.length) console.log(`\n${campo} embutido: ${lojas.length}`);
    for (const l of lojas) {
      const rotulo = `${l.name || l.id.slice(-6)} / ${campo}`;
      try {
        const r = await gravar(l[campo], "lojas", rotulo);
        totalAntes += r.original;
        totalDepois += r.final;
        convertidos++;
        console.log(`  ✔ ${rotulo}: ${kb(r.original)} -> ${kb(r.final)}`);
        if (APPLY) {
          await prisma.user.update({ where: { id: l.id }, data: { [campo]: r.url } });
        }
      } catch (e) {
        falhas++;
        console.log(`  ✖ ${rotulo}: ${e.message}`);
      }
    }
  }

  console.log("\n──────────────────────────────────────────");
  console.log(`convertidos: ${convertidos}   falhas: ${falhas}`);
  console.log(`peso antes:  ${mb(totalAntes)}`);
  console.log(`peso depois: ${mb(totalDepois)}`);
  if (totalAntes > 0) {
    console.log(`redução:     ${(100 - (totalDepois / totalAntes) * 100).toFixed(1)}%`);
  }
  if (!APPLY) console.log("\nNada foi alterado. Rode de novo com --apply para aplicar.");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
