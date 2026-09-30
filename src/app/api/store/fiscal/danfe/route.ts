import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { tokenDoAmbiente } from "@/lib/fiscal-credenciais";
import { normalizarConfigFiscal } from "@/lib/fiscal-config";
import { impressoraDoCaixa } from "@/lib/impressao-da-conta";
import { lerXmlFiscal } from "@/lib/nfce/armazenamento";
import { CSP_DO_DANFE, danfeHtml, viasDoDanfe } from "@/lib/nfce/danfe";
import { danfeDoPedido, notaDoEmissorProprio, type NotaNoCofre } from "@/lib/nfce/danfe-do-pedido";
import { funcionarioAbre } from "@/lib/permissao-da-tela";

export const dynamic = "force-dynamic";

/**
 * GET /api/store/fiscal/danfe?orderId=...&tipo=danfe|xml[&largura=58|80][&via=consumidor|estabelecimento][&imprimir=1]
 *
 * Abre o DANFCe (o cupom da NFC-e) ou baixa o XML da nota pelo servidor.
 *
 * ── Emissor próprio (fiscalInfo.xmlNoCofre) ─────────────────────────────────
 * A nota que o FireHub emitiu direto na SEFAZ (lib/nfce) não tem DANFE em
 * provedor nenhum: o XML autorizado mora no cofre fiscal, e o DANFE é montado
 * AQUI a partir dele (lib/nfce/danfe.ts) — HTML autocontido, com o QR em SVG,
 * pronto para a térmica pelo navegador. `largura` escolhe a bobina (padrão: a
 * da impressora do caixa); na contingência ainda pendente saem as DUAS vias na
 * mesma página ("Via do Estabelecimento" fica na loja — Ajuste SINIEF 19/16,
 * cl. 11ª, §3º), ou só a pedida em `via`. `tipo=xml` entrega o XML do cofre.
 * A nota da Focus continua pelo caminho de baixo, sem mudança.
 *
 * ── O DANFCe é HTML, não PDF ────────────────────────────────────────────────
 * Para NFC-e a Focus devolve `caminho_danfe` como
 * "/notas_fiscais_consumidor/NFe<chave>.html" (doc: consultar_nfce). Esta
 * rota servia esse HTML com `Content-Type: application/pdf` — o navegador
 * tentava abrir como PDF e mostrava "falha ao carregar documento". O lojista
 * clicava em "Imprimir cupom" e não saía nada.
 *
 * Agora o tipo segue o que a Focus mandou: HTML vai como text/html, PDF (se um
 * dia vier) como PDF. O HTML recebe um <base href> com o endereço original,
 * para que o CSS, o logo e a imagem do QR Code, que a Focus referencia por
 * caminho relativo, continuem carregando de lá — servido daqui, "/assets/…"
 * apontaria para o FireHub e o cupom sairia sem QR.
 *
 * ── Por que não redirecionar direto para a Focus ────────────────────────────
 * Sondagem de 24/09/2026: esses caminhos respondem sem autenticação (404
 * "Arquivo não encontrado" para chave inexistente, nunca 401, enquanto /v2/*
 * responde 401). Mas a doc não PROMETE que são públicos, e um redirect
 * dependeria disso. Pelo servidor funciona dos dois jeitos: se a Focus passar
 * a exigir o token, ele já vai junto — e o token nunca chega ao navegador.
 */
const HOSTS_DA_FOCUS = new Set(["api.focusnfe.com.br", "homologacao.focusnfe.com.br"]);

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, ownerId: true, role: true, permissions: true },
    });
    if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    const lojaId = user.ownerId || user.id;

    // O DANFE e o XML trazem CPF e endereço do cliente da entrega. Quem chama
    // esta rota é a tela Fiscal (o balcão imprime o cupom pela fila do
    // Assistente, não por aqui), e ela só abre para o funcionário com
    // "Financeiro" marcado — a API passa a conferir a mesma caixinha.
    if (user.role === "STAFF" && !funcionarioAbre("/store/fiscal", user.permissions)) {
      return NextResponse.json(
        { error: "Sem acesso às notas fiscais: peça ao dono da loja para marcar \"Financeiro\" no seu cadastro em Equipe." },
        { status: 403 }
      );
    }

    const url = new URL(req.url);
    const orderId = url.searchParams.get("orderId");
    const tipo = url.searchParams.get("tipo") === "xml" ? "xml" : "danfe";
    if (!orderId) return NextResponse.json({ error: "orderId obrigatório" }, { status: 400 });

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      select: { id: true, franchiseeId: true, fiscalStatus: true, fiscalInfo: true },
    });
    if (!order) return NextResponse.json({ error: "Pedido não encontrado" }, { status: 404 });
    if (order.franchiseeId !== lojaId) {
      return NextResponse.json({ error: "Este pedido não é desta loja" }, { status: 403 });
    }

    // Emissor próprio: o XML está no nosso cofre, e o DANFE nasce dele.
    const notaPropria = notaDoEmissorProprio(order.fiscalInfo);
    if (notaPropria) return await respostaDoEmissorProprio(url, lojaId, order, notaPropria, tipo);

    const fiscal = (order.fiscalInfo as any) || {};
    const alvo = String((tipo === "xml" ? fiscal.xmlUrl : fiscal.pdfUrl) ?? "");
    if (!alvo) {
      return NextResponse.json(
        { error: "sem_documento", mensagem: "Este pedido não tem nota autorizada com documento salvo." },
        { status: 404 }
      );
    }

    // O token vai junto na chamada: só para o endereço da própria Focus.
    // Um fiscalInfo adulterado não pode fazer o servidor entregar a
    // credencial fiscal da loja a outro host.
    let destino: URL;
    try {
      destino = new URL(alvo);
    } catch {
      return NextResponse.json({ error: "documento_invalido", mensagem: "Endereço do documento inválido." }, { status: 409 });
    }
    if (destino.protocol !== "https:" || !HOSTS_DA_FOCUS.has(destino.hostname)) {
      return NextResponse.json(
        { error: "documento_invalido", mensagem: "O endereço salvo para este documento não é da Focus NFe." },
        { status: 409 }
      );
    }

    const loja = await prisma.user.findUnique({
      where: { id: lojaId },
      select: { fiscalConfig: true },
    });
    const config = normalizarConfigFiscal(loja?.fiscalConfig);
    // O token é o do ambiente em que a NOTA saiu, não o da configuração de
    // hoje: nota de homologação continua abrindo depois que a loja passa para
    // produção.
    const token = tokenDoAmbiente({ ...config, ambiente: Number(fiscal.ambiente) || config.ambiente });

    const res = await fetch(destino, {
      headers: token ? { Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}` } : {},
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!res.ok) {
      if ((res.status === 401 || res.status === 403) && !token) {
        return NextResponse.json(
          { error: "nao_configurado", mensagem: "A Focus pediu o token para abrir este documento e esta loja não tem token salvo." },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "provedor_recusou", mensagem: `O provedor respondeu HTTP ${res.status} ao buscar o documento.` },
        { status: 502 }
      );
    }

    const nomeBase = `nfce-${fiscal.serie ?? "s"}-${fiscal.nfceNumber ?? order.id.slice(-6)}`;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const tipoDaFocus = (res.headers.get("content-type") || "").toLowerCase();

    if (tipo === "xml") {
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `inline; filename="${nomeBase}.xml"`,
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (tipoDaFocus.includes("pdf") || comecaComPdf(bytes)) {
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${nomeBase}.pdf"`,
          "Cache-Control": "private, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const html = htmlComBase(decodificar(bytes, tipoDaFocus), res.url || destino.toString());
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${nomeBase}.html"`,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
        // O HTML é da Focus mas é servido no domínio do FireHub. O sandbox
        // tira dele a origem do FireHub (cookies de sessão, API da loja);
        // continua podendo imprimir (allow-modals → window.print).
        "Content-Security-Policy":
          "sandbox allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (err: any) {
    console.error("[Fiscal DANFE] Erro:", String(err?.message ?? "").slice(0, 300));
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

/**
 * O DANFE (ou o XML) de uma nota do emissor próprio. Mesma autenticação da
 * rota: quem chega aqui já é da loja dona do pedido.
 */
async function respostaDoEmissorProprio(
  url: URL,
  lojaId: string,
  order: { id: string; fiscalStatus: string | null; fiscalInfo: unknown },
  nota: NotaNoCofre,
  tipo: "danfe" | "xml"
): Promise<Response> {
  if (tipo === "xml") {
    // O XML sai em qualquer estado — inclusive da cancelada: é registro da
    // loja e do contador, não cupom para o cliente.
    let xml: string;
    try {
      xml = await lerXmlFiscal(nota.caminho, nota.sha256);
    } catch (e: any) {
      console.error(`[Fiscal DANFE] pedido ${order.id}: XML ilegível no cofre:`, String(e?.message ?? e).slice(0, 200));
      return NextResponse.json({ error: "cofre", mensagem: "Não consegui ler o XML desta nota no cofre fiscal." }, { status: 500 });
    }
    const autorizada = xml.includes("<protNFe");
    const nome = `${nota.chave ?? order.id}-${autorizada ? "procNFe" : "nfce-contingencia"}.xml`;
    return new NextResponse(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Content-Disposition": `inline; filename="${nome}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const lido = await danfeDoPedido(order);
  if (!lido.ok) return NextResponse.json({ error: lido.erro, mensagem: lido.mensagem }, { status: lido.status });

  const pedida = url.searchParams.get("largura");
  const largura: 58 | 80 = pedida === "58" ? 58 : pedida === "80" ? 80 : await larguraDoCaixa(lojaId);
  // Via só existe na contingência pendente; fora dela o pedido de via é ignorado.
  const via = url.searchParams.get("via");
  const opcoesDeVia =
    lido.dados.pendenteDeAutorizacao && (via === "consumidor" || via === "estabelecimento")
      ? { via: via as "consumidor" | "estabelecimento" }
      : { vias: viasDoDanfe(lido.dados) };
  const html = danfeHtml(lido.dados, { largura, ...opcoesDeVia, imprimirAoAbrir: url.searchParams.get("imprimir") === "1" });
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `inline; filename="danfe-nfce-${lido.dados.serieFormatada}-${lido.dados.numeroFormatado}.html"`,
      // CPF e endereço do cliente da entrega: nada de cache compartilhado.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": CSP_DO_DANFE,
      "Referrer-Policy": "no-referrer",
    },
  });
}

/** A bobina da impressora do caixa (a mesma que recebe o DANFE pela fila); na dúvida, 80 mm. */
async function larguraDoCaixa(lojaId: string): Promise<58 | 80> {
  try {
    const loja = await prisma.user.findUnique({ where: { id: lojaId }, select: { printerConfig: true, printQueueEstado: true } });
    const pc = (loja?.printerConfig as any) || {};
    const printers = Array.isArray(pc.printers) ? pc.printers : [];
    const noPc = Array.isArray((loja?.printQueueEstado as any)?.impressoras) ? (loja?.printQueueEstado as any).impressoras.map(String) : [];
    const caixa = impressoraDoCaixa(printers, noPc) as { paperWidth?: string } | null;
    return (caixa?.paperWidth || pc.defaultPaperWidth) === "58mm" ? 58 : 80;
  } catch {
    return 80;
  }
}

function comecaComPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
}

/**
 * Lê o HTML no charset em que a Focus mandou (cabeçalho, senão <meta>) e
 * devolve texto — que sai daqui sempre em UTF-8. Sem isso, um DANFCe em
 * ISO-8859-1 viraria "PÃ£o de queijo" no cupom.
 */
function decodificar(bytes: Uint8Array, contentType: string): string {
  const doCabecalho = /charset=([\w-]+)/i.exec(contentType)?.[1];
  const inicio = new TextDecoder("latin1").decode(bytes.slice(0, 2048));
  const doMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(inicio)?.[1];
  const charset = (doCabecalho || doMeta || "utf-8").toLowerCase();
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Põe <base href> no HTML para os caminhos relativos resolverem na Focus. */
function htmlComBase(html: string, endereco: string): string {
  if (/<base[\s>]/i.test(html)) return html;
  const base = `<base href="${endereco.replace(/"/g, "&quot;")}">`;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const fim = head.index + head[0].length;
    return html.slice(0, fim) + base + html.slice(fim);
  }
  return base + html;
}
