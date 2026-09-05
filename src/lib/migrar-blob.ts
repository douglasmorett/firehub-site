/**
 * src/lib/migrar-blob.ts
 * Tira do Vercel Blob as imagens que ainda estão referenciadas no banco.
 *
 * ── Por que isto é uma lib do app, e não um script ───────────────────────────
 *
 * O arquivo tem que acabar no MESMO disco que o site serve — o volume do
 * Coolify montado em public/uploads. Rodar de fora (na máquina de alguém, ou
 * num agente na nuvem) grava no lugar errado e o site devolve 404 com o arquivo
 * existindo em algum outro canto.
 *
 * Quem já está no lugar certo, com o DATABASE_URL certo e o volume montado, é o
 * próprio app em produção. Por isso a migração mora aqui e é disparada pela
 * rota /api/admin/migrar-blob: não depende de ninguém ter acesso a shell no
 * servidor.
 *
 * ── Por que não repete a lógica de gravação ──────────────────────────────────
 *
 * A primeira versão disto era um script que recopiava de storage.ts o
 * saneamento de nome, a checagem de magic number e a compressão com sharp —
 * três coisas que iam divergir do original no primeiro ajuste. Aqui o download
 * vira um `File` e vai para o `saveUploadedFile` de sempre, que é exatamente o
 * caminho de um upload feito pelo lojista. Uma implementação só.
 */
import { prisma } from "@/lib/prisma";
import { saveUploadedFile } from "@/lib/storage";

/** O que caracteriza uma URL que ainda mora na Vercel. */
const MARCA = "blob.vercel-storage";

type Alvo = {
  model: string;
  campo: string;
  pasta: string;
  /** Coluna usada só para dar nome à linha no relatório. */
  rotulo: string | null;
};

/**
 * Toda coluna do schema que guarda imagem. Model que não existir no client
 * gerado é pulado — o try/catch de cada varredura cuida disso.
 */
const ALVOS: Alvo[] = [
  { model: "user", campo: "storeLogo", pasta: "lojas", rotulo: "storeName" },
  { model: "user", campo: "storeBanner", pasta: "lojas", rotulo: "storeName" },
  { model: "menuProduct", campo: "imageUrl", pasta: "produtos", rotulo: "name" },
  { model: "menuCategory", campo: "imageUrl", pasta: "produtos", rotulo: "name" },
  { model: "product", campo: "imageUrl", pasta: "produtos", rotulo: "name" },
  { model: "purchaseInvoice", campo: "imageUrl", pasta: "invoices", rotulo: null },
  { model: "stockInvoice", campo: "imageUrl", pasta: "invoices", rotulo: null },
  // MetaAdsCampaign não tem coluna `name` — sai pelo id.
  { model: "metaAdsCampaign", campo: "adImageUrl", pasta: "marketing", rotulo: null },
];

export type ItemMigracao = {
  model: string;
  campo: string;
  id: string;
  nome: string;
  urlAntiga: string;
  urlNova?: string;
  bytesAntes?: number;
  bytesDepois?: number;
  erro?: string;
};

export type RelatorioMigracao = {
  aplicado: boolean;
  encontrados: number;
  migrados: number;
  falhas: number;
  restam: number;
  itens: ItemMigracao[];
};

/**
 * Tipo real pelos primeiros bytes.
 *
 * O Blob guarda arquivo sem extensão e o `content-type` da resposta nem sempre
 * vem. O `saveUploadedFile` confere os bytes por conta própria e recusa o que
 * não bater com o tipo declarado — então o que é declarado aqui tem que sair do
 * conteúdo, não do cabeçalho.
 */
function mimePelosBytes(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (b.subarray(0, 4).toString("ascii") === "%PDF") return "application/pdf";
  return null;
}

async function baixarEGravar(url: string, pasta: string) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar do Blob`);

  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("arquivo vazio no Blob");

  const mime = mimePelosBytes(buffer);
  if (!mime) throw new Error("conteúdo não é imagem nem PDF reconhecível");

  // Vira um File e segue o mesmo caminho de um upload do lojista: checagem de
  // magic number, compressão com sharp e nome seguro, tudo em storage.ts.
  const arquivo = new File([new Uint8Array(buffer)], "migrado-do-blob", { type: mime });
  const salvo = await saveUploadedFile(arquivo, pasta);

  return { urlNova: salvo.url, bytesAntes: buffer.length, bytesDepois: salvo.size };
}

/**
 * Varre o banco e (se `aplicar`) traz as imagens para o disco do VPS.
 *
 * Sem `aplicar` é ensaio: baixa para provar que o arquivo ainda existe e é
 * válido, mas não grava arquivo nem toca no banco. Com `aplicar` é idempotente
 * — rodar de novo não acha mais nada.
 */
export async function migrarImagensDoBlob(aplicar: boolean): Promise<RelatorioMigracao> {
  const itens: ItemMigracao[] = [];
  let migrados = 0;
  let falhas = 0;

  for (const alvo of ALVOS) {
    // Acesso dinâmico ao model: a lista de alvos é dados, não código, para não
    // repetir o mesmo bloco oito vezes.
    const delegate = (prisma as any)[alvo.model];
    if (!delegate) continue;

    let linhas: any[];
    try {
      linhas = await delegate.findMany({
        where: { [alvo.campo]: { contains: MARCA } },
        select: { id: true, [alvo.campo]: true, ...(alvo.rotulo ? { [alvo.rotulo]: true } : {}) },
      });
    } catch {
      continue; // model sem essa coluna neste schema
    }

    for (const linha of linhas) {
      const urlAntiga: string = linha[alvo.campo];
      const nome = (alvo.rotulo && linha[alvo.rotulo]) || String(linha.id).slice(-6);
      const item: ItemMigracao = { model: alvo.model, campo: alvo.campo, id: linha.id, nome, urlAntiga };

      try {
        const r = await baixarEGravar(urlAntiga, alvo.pasta);
        item.urlNova = r.urlNova;
        item.bytesAntes = r.bytesAntes;
        item.bytesDepois = r.bytesDepois;

        if (aplicar) {
          await delegate.update({ where: { id: linha.id }, data: { [alvo.campo]: r.urlNova } });
        }
        migrados++;
      } catch (err: any) {
        item.erro = err?.message || String(err);
        falhas++;
      }

      itens.push(item);
    }
  }

  // Quantas linhas AINDA apontam para a Vercel depois de tudo.
  let restam = 0;
  for (const alvo of ALVOS) {
    const delegate = (prisma as any)[alvo.model];
    if (!delegate) continue;
    try {
      restam += await delegate.count({ where: { [alvo.campo]: { contains: MARCA } } });
    } catch {
      /* model sem a coluna */
    }
  }

  return { aplicado: aplicar, encontrados: itens.length, migrados, falhas, restam, itens };
}
