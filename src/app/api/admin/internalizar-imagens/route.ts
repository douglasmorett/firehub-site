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
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { saveUploadedFile } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 54 fotos a ~1s cada cabem com folga

/**
 * QUANDO uma imagem precisa virar nossa.
 *
 * Isto já foi uma LISTA de hosts de concorrente, e a lista errou cinco vezes,
 * sempre do mesmo jeito: o host novo não estava nela e ninguém percebia. O
 * Storage do Frangoso (61 fotos, 12/09/2026), o bucket do Cardápio Web na
 * Delicias de Casa (55, 14/09), o Menu Integrado no R&D (110, 17/09), o
 * SEGUNDO CDN do iFood (7 da Brazza, nove dias no ar) e a JotaJá, que nunca
 * entrou na lista (102 fotos em 19 lojas, desde julho).
 *
 * A regra agora é ao contrário, e não tem host para manter: foto nossa mora em
 * caminho relativo (`/uploads/...`), então qualquer `http(s)://` é de fora e
 * tem que ser baixada — não importa de quem seja o servidor. Foi assim que a
 * logo e o banner da Hakim Unamar apareceram, servidos por `static.saipos.com`:
 * host de PDV concorrente, que lista nenhuma iria adivinhar.
 *
 * Uma URL que não baixa mantém a original e entra em `falhas`, e é tentada de
 * novo na rodada seguinte. Custa um timeout por rodada — é o preço de não
 * precisar mais adivinhar host, e some assim que a foto for trocada ou tirada.
 */
function hostsNossos(req: NextRequest): string[] {
  // Mesma ideia de `hostsProprios` em src/lib/imagem-enviada.ts: NEXTAUTH_URL
  // cobre produção e o header Host cobre dev e preview, sem variável nova.
  const hosts = new Set<string>();
  const configurado = (process.env.NEXTAUTH_URL || "").trim();
  if (configurado.startsWith("http")) {
    try {
      hosts.add(new URL(configurado).host.toLowerCase());
    } catch {
      // NEXTAUTH_URL mal formada não pode derrubar a rodada.
    }
  }
  const doPedido = req.headers.get("host");
  if (doPedido) hosts.add(doPedido.toLowerCase());
  return [...hosts];
}

/** Absoluto e não é nosso. URL relativa e coluna vazia ficam de fora sozinhas. */
function ehDeFora(campo: string, nossos: string[]) {
  return {
    AND: [
      { [campo]: { startsWith: "http" } },
      ...nossos.map((h) => ({ NOT: { [campo]: { contains: h } } })),
    ],
  };
}

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

/**
 * Baixa a imagem, e tenta de novo como NAVEGADOR quando levar a porta na cara.
 *
 * O CDN do iFood (static-images.ifood.com.br) responde 403 para o nosso
 * servidor e 200 para a mesma URL pedida de um computador comum — medido em
 * 18/09/2026 nas 193 fotos do Taurus, que falharam 193 de 193. Requisição sem
 * `User-Agent` vinda de faixa de datacenter é exatamente o que um WAF barra.
 *
 * Então a segunda tentativa se apresenta: User-Agent de navegador, `Accept` de
 * imagem e o Referer do próprio site de origem. Se ainda assim vier 403, o erro
 * sobe com o motivo e aparece na resposta — não some.
 */
function cabecalhoDeNavegador(url: string): Record<string, string> {
  let origem = "";
  try {
    origem = new URL(url).origin + "/";
  } catch {}
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "Accept-Language": "pt-BR,pt;q=0.9",
    ...(origem ? { Referer: origem } : {}),
  };
}

/** Levou a porta na cara? (403/401/429 é bloqueio, 404 é imagem que sumiu.) */
const barrado = (r: Response) => r.status === 403 || r.status === 401 || r.status === 429;

/**
 * O MESMO arquivo, pelo caminho que os apps do iFood usam.
 *
 * `static-images.ifood.com.br/pratos/<uuid>/<arquivo>.jpg` é o caminho cru, e é
 * o que o WAF deles barra para o nosso servidor. O mesmo arquivo também é
 * servido por `/image/upload/t_high/pratos/...`, que é a rota de transformação
 * que o app e o site deles pedem — e que costuma ter regra diferente.
 *
 * Nulo quando não é esse host, ou quando a URL já está nessa forma.
 */
function caminhoAlternativoDoIfood(url: string): string | null {
  const marca = "static-images.ifood.com.br/";
  const i = url.indexOf(marca);
  if (i < 0) return null;
  const caminho = url.slice(i + marca.length);
  if (caminho.startsWith("image/upload/")) return null;
  return `https://static-images.ifood.com.br/image/upload/t_high/${caminho}`;
}

async function baixar(url: string): Promise<Response> {
  const direto = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (direto.ok || !barrado(direto)) return direto;

  // 2ª tentativa: como navegador. Requisição sem `User-Agent` vinda de faixa de
  // datacenter é exatamente o que um WAF barra.
  const comoNavegador = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: cabecalhoDeNavegador(url),
  });
  if (comoNavegador.ok || !barrado(comoNavegador)) return comoNavegador;

  // 3ª: o caminho de transformação do iFood. As 193 fotos do Taurus respondem
  // 200 para um computador comum e 403 para o servidor no caminho cru — e o
  // outro CDN deles (static.ifood-static.com.br, as 7 da Brazza) baixa normal,
  // então não é bloqueio geral: é regra daquele host.
  const alternativo = caminhoAlternativoDoIfood(url);
  if (!alternativo) return comoNavegador;
  const porTransformacao = await fetch(alternativo, {
    signal: AbortSignal.timeout(20_000),
    headers: cabecalhoDeNavegador(alternativo),
  });
  // Se o alternativo também não veio, devolve o original: o motivo que aparece
  // na resposta tem que ser o da URL que está no cadastro, não o do contorno.
  return porTransformacao.ok ? porTransformacao : comoNavegador;
}

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
  // Cron OU um ADMIN logado.
  //
  // O caminho do admin existe porque a falha aqui era INVISÍVEL: em
  // 18/09/2026 descobrimos que nenhuma das 439 fotos de cinco lojas (Taurus
  // 193 desde 09/09, R&D 96, Frangoso 60, Delícias 55, Digão 35) tinha sido
  // internalizada — a rota só era chamada pelo cron, de dentro do container,
  // e o que ela respondia não chegava a olho nenhum. Poder disparar pelo
  // painel e LER o resultado (quantas trocaram, quais falharam e por quê) é o
  // que transforma "não funcionou" em "falhou por causa disto".
  const daCasa = verifyCronAuth(req);
  if (!daCasa) {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email;
    const quem = email
      ? await prisma.user.findUnique({ where: { email }, select: { role: true } })
      : null;
    if (quem?.role !== "ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  // Sem `dominio` no corpo, cobre TUDO que não é nosso — é assim que o cron
  // (GET, sem corpo) chama. O padrão já foi só "menudino", e as 193 fotos do
  // Taurus, importadas do iFood em 09/09/2026, ficaram apontando para
  // static-images.ifood.com.br por seis horas a fio sem nunca entrar aqui.
  // `dominio` continua existindo para a rodada cirúrgica, de uma origem só.
  const q = req.nextUrl.searchParams;
  const dePara = (chave: string) => (body as any)?.[chave] ?? q.get(chave) ?? null;

  const escolhido = dePara("dominio");
  const nossos = hostsNossos(req);
  const franchiseeId = dePara("franchiseeId") ? String(dePara("franchiseeId")) : null;

  // ── POR QUE ESTA RODADA TEM HORA PARA ACABAR ───────────────────────────
  //
  // O cron-runner derruba a conexão aos 55 s (`timeout: 55_000` em
  // scripts/cron-runner.js). Uma rodada que tenta as 439 imagens de uma vez
  // nunca chega ao fim dentro dessa janela — e uma rodada interrompida não
  // tem como dizer o que fez.
  //
  // Com orçamento, cada chamada PÁRA sozinha antes do corte, responde o que
  // conseguiu e deixa o resto para a próxima. Como cada troca é gravada na
  // hora, o progresso é sempre cumulativo: seis horas depois ela continua de
  // onde parou, e o número de pendentes só cai.
  const orcamentoMs = Math.max(5_000, Math.min(240_000, Number(dePara("orcamentoMs")) || 45_000));
  const limite = Math.max(1, Math.min(5_000, Number(dePara("limite")) || 5_000));
  const comecou = Date.now();

  let total = 0;
  let trocadas = 0;
  let pendentes = 0;
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
          ...(escolhido
            ? { [alvo.campo]: { contains: String(escolhido) } }
            : ehDeFora(alvo.campo, nossos)),
          ...(franchiseeId ? alvo.filtroDaLoja(franchiseeId) : {}),
        },
        select: { id: true, [alvo.campo]: true, ...(alvo.rotulo ? { [alvo.rotulo]: true } : {}) },
      });
    } catch {
      continue; // model sem essa coluna neste schema
    }

    total += linhas.length;
    for (const linha of linhas) {
      if (Date.now() - comecou > orcamentoMs || trocadas >= limite) {
        pendentes += 1;
        continue;
      }
      const url: string = linha[alvo.campo];
      const nome = (alvo.rotulo && linha[alvo.rotulo]) || String(linha.id).slice(-6);
      try {
        // Timeout POR IMAGEM. Sem ele, uma origem que aceita a conexão e não
        // responde segura a rodada inteira até o cron desistir — e as outras
        // imagens, que baixariam em 300 ms, nunca chegam a ser tentadas.
        const res = await baixar(url);
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

  const levou = Date.now() - comecou;
  console.log(
    `[internalizar-imagens] ${trocadas}/${total} imagem(ns) internalizada(s) em ${levou}ms` +
    (pendentes ? `; ${pendentes} ficaram para a próxima rodada` : "") +
    (falhas.length ? `; falhas: ${falhas.length} — ${falhas.slice(0, 3).join(" | ")}` : "")
  );
  return NextResponse.json({
    total,
    trocadas,
    pendentes,
    levouMs: levou,
    porColuna,
    // As falhas vão INTEIRAS na resposta: é o único lugar onde o motivo real
    // aparece para quem está olhando. Truncar aqui foi o que deixou o
    // problema invisível por nove dias.
    falhas,
  });
}
