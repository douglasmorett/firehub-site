/**
 * POST /api/admin/internalizar-imagens
 *
 * Baixa para o volume da loja as imagens que ainda apontam para um servidor de
 * terceiro, e troca a URL no cadastro.
 *
 * Existe por causa da regra da casa: cardápio importado de outra plataforma
 * (MenuDino, Anota AI...) não pode continuar DEPENDENDO dela. A importação do
 * Ragnar entrou com 54 fotos servidas por files.menudino.com — funcionam hoje,
 * somem no dia em que ele cancelar o plano de lá. Esta rota faz o servidor
 * baixar cada uma para o próprio volume (o mesmo de /api/upload) e apontar o
 * cadastro para /uploads/..., cortando o vínculo.
 *
 * NÃO É SÓ FOTO DE PRODUTO. Até 17/09/2026 era, e a cópia do cardápio do R&D
 * Pizzaria (Menu Integrado) mostrou o buraco: além das 96 fotos de produto e de
 * opção, vieram 12 CAPAS DE CATEGORIA, a LOGO e o BANNER da loja — 14 imagens
 * que a varredura não olhava e que continuariam servidas pelo site do
 * concorrente. A lista de colunas agora é a mesma que `migrar-blob.ts` já
 * mantinha para a saída do Vercel Blob.
 *
 * Protegida como as rotas de cron (CRON_SECRET / localhost): é ferramenta de
 * operação, não tela de lojista. Idempotente — o que já está em /uploads é
 * pulado, e falha numa imagem não derruba as outras (no pior caso fica igual ao
 * que era: apontando para fora).
 *
 * Corpo opcional: { "franchiseeId": "..." } para limitar a uma loja;
 *                 { "dominio": "menudino" } para trocar o padrão de origem.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronAuth } from "@/lib/cron-auth";
import { saveUploadedFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 54 fotos a ~1s cada cabem com folga

/**
 * De onde um cardápio importado pode ter ficado dependendo. Cada importação
 * nova (MenuDino, iFood...) entra aqui, e o cron cuida do resto.
 */
// `firebasestorage.googleapis.com` entrou em 12/09/2026, com a cópia do
// cardápio do Frangoso vindo da Brendi: as 61 fotos apontavam para o Storage
// DELES, com token de leitura que eles podem revogar a qualquer momento. Foto
// de cardápio hospedada no concorrente é cardápio que some sem aviso.
// `prod-cardapio-web` é o bucket do Cardápio Web. Entrou com a cópia do
// cardápio da Delicias de Casa (14/09/2026): 55 fotos que ficaram apontando
// para o storage deles. Vai o caminho do BUCKET, não `storage.googleapis.com`
// puro — aquele host serve bucket de meio mundo, e o cron não tem o que fazer
// com foto que não é de cardápio importado.
// `menuintegrado` é a plataforma dos sites próprios de delivery (rdpizza.com.br
// e irmãos). Entrou com a cópia do cardápio do R&D Pizzaria (17/09/2026): 110
// imagens no total, entre fotos de produto, capas de categoria, logo e banner.
const ORIGENS_DE_FORA = [
  "menudino",
  "static-images.ifood.com.br",
  "firebasestorage.googleapis.com",
  "prod-cardapio-web",
  "menuintegrado",
  // InstaDelivery serve as fotos de um bucket da DigitalOcean; o nome da
  // plataforma está no host (instadelivery-public.nyc3.cdn.digitaloceanspaces.com),
  // então basta ele — casar "digitaloceanspaces" pegaria bucket de terceiro.
  "instadelivery",
];

/**
 * TODA coluna de imagem que uma importação pode preencher com URL de fora.
 *
 * `filtroDaLoja` existe porque "esta loja" não se escreve igual em todo model:
 * em MenuProduct é `franchiseeId`, no próprio User é `id`. Sem isso, limitar a
 * uma loja pularia justamente a logo e o banner dela.
 */
const COLUNAS_DE_IMAGEM: {
  model: string;
  campo: string;
  pasta: string;
  rotulo: string | null;
  filtroDaLoja: (id: string) => Record<string, unknown>;
}[] = [
  { model: "menuProduct", campo: "imageUrl", pasta: "produtos", rotulo: "name", filtroDaLoja: (id) => ({ franchiseeId: id }) },
  { model: "menuCategory", campo: "imageUrl", pasta: "produtos", rotulo: "name", filtroDaLoja: (id) => ({ franchiseeId: id }) },
  { model: "user", campo: "storeLogo", pasta: "lojas", rotulo: "storeName", filtroDaLoja: (id) => ({ id }) },
  { model: "user", campo: "storeBanner", pasta: "lojas", rotulo: "storeName", filtroDaLoja: (id) => ({ id }) },
];

export async function POST(req: NextRequest) {
  return internalizar(req);
}

// GET com os padrões: é o que o cron-runner (que só fala GET, de dentro do
// container, com o CRON_SECRET do ambiente) chama a cada 6 horas. Idempotente:
// sem foto apontando para fora, é uma consulta barata e nada mais. Assim a
// regra "cardápio importado não depende da plataforma de origem" vale para
// TODA importação futura, não só a de hoje.
export async function GET(req: NextRequest) {
  return internalizar(req);
}

async function internalizar(req: NextRequest) {
  if (!verifyCronAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  // Sem `dominio` no corpo, cobre TODAS as origens conhecidas — é assim que o
  // cron (GET, sem corpo) chama. O padrão era só "menudino", e as 193 fotos
  // do Taurus, importadas do iFood em 09/09/2026, ficaram apontando para
  // static-images.ifood.com.br por seis horas a fio sem nunca entrar aqui.
  const dominios: string[] = (body as any)?.dominio ? [String((body as any).dominio)] : ORIGENS_DE_FORA;
  const franchiseeId = (body as any)?.franchiseeId ? String((body as any).franchiseeId) : null;

  let total = 0;
  let trocadas = 0;
  const falhas: string[] = [];
  const porColuna: Record<string, number> = {};

  for (const alvo of COLUNAS_DE_IMAGEM) {
    // Acesso dinâmico ao model: a lista de colunas é dados, não código.
    const delegate = (prisma as any)[alvo.model];
    if (!delegate) continue;

    let linhas: any[];
    try {
      linhas = await delegate.findMany({
        where: {
          OR: dominios.map((d) => ({ [alvo.campo]: { contains: d } })),
          ...(franchiseeId ? alvo.filtroDaLoja(franchiseeId) : {}),
        },
        select: { id: true, [alvo.campo]: true, ...(alvo.rotulo ? { [alvo.rotulo]: true } : {}) },
      });
    } catch {
      continue; // model sem essa coluna neste schema
    }

    total += linhas.length;
    for (const linha of linhas) {
      const url: string = linha[alvo.campo];
      const nome = (alvo.rotulo && linha[alvo.rotulo]) || String(linha.id).slice(-6);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bruto = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get("content-type")?.split(";")[0] || "image/webp";
        // File nativo do Node 18+: é o que saveUploadedFile espera receber.
        const arquivo = new File([bruto], `${linha.id}.webp`, { type: mime });
        const salvo = await saveUploadedFile(arquivo, alvo.pasta);
        await delegate.update({ where: { id: linha.id }, data: { [alvo.campo]: salvo.url } });
        trocadas++;
        porColuna[`${alvo.model}.${alvo.campo}`] = (porColuna[`${alvo.model}.${alvo.campo}`] || 0) + 1;
      } catch (e: any) {
        falhas.push(`${alvo.model}.${alvo.campo} "${nome}": ${e?.message}`);
      }
    }
  }

  console.log(
    `[internalizar-imagens] ${trocadas}/${total} imagem(ns) internalizada(s)` +
    (falhas.length ? `; falhas: ${falhas.length}` : "")
  );
  return NextResponse.json({ total, trocadas, porColuna, falhas });
}
