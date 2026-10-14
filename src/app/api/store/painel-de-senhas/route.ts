import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { lerConfigDoPainel, novoCodigo, type ConfigDoPainel } from "@/lib/painel-de-senhas";

/**
 * Configuração do Painel de senhas (`User.painelDeSenhas`) e da numeração
 * sorteada (`User.numeracaoAleatoria`), na linha da loja — o funcionário mexe
 * na loja do dono.
 *
 * A numeração muda o número em TUDO (quadro, KDS, comanda, WhatsApp do
 * cliente, app do motoboy), então só o dono ou quem tem a caixinha "Minha
 * loja" troca o modo. O resto da tela segue a permissão da própria tela.
 */
async function quemEsta() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return null;
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, role: true, permissions: true },
  });
  if (!user) return null;
  const funcionario = user.role === "STAFF" && !!user.ownerId;
  const podeNumeracao = !funcionario || String(user.permissions || "").split(",").map((p) => p.trim()).includes("minha_loja");
  return { lojaId: funcionario ? user.ownerId! : user.id, podeNumeracao };
}

/** Código que nenhuma outra loja usa. */
async function codigoLivre(): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const c = novoCodigo();
    const usado = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "User" WHERE "painelDeSenhas"->>'codigo' = ${c} LIMIT 1`;
    if (usado.length === 0) return c;
  }
  throw new Error("Não deu para gerar um código livre");
}

async function lerDaLoja(lojaId: string) {
  const loja = await prisma.user.findUnique({
    where: { id: lojaId },
    select: { storeName: true, name: true, storeLogo: true, slug: true, painelDeSenhas: true, numeracaoAleatoria: true },
  });
  if (!loja) return null;
  let config = lerConfigDoPainel(loja.painelDeSenhas);
  // A primeira visita já sai com o código: a tela é "abra na TV e digite isto".
  if (!config.codigo) {
    config = { ...config, codigo: await codigoLivre() };
    await prisma.user.update({ where: { id: lojaId }, data: { painelDeSenhas: config } });
  }
  return {
    lojaId,
    nome: loja.storeName || loja.name || "",
    logo: loja.storeLogo || null,
    slug: loja.slug || null,
    config,
    numeracaoAleatoria: loja.numeracaoAleatoria === true,
  };
}

export async function GET() {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const dados = await lerDaLoja(quem.lojaId);
  if (!dados) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });
  return NextResponse.json({ ...dados, podeNumeracao: quem.podeNumeracao }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Corpo: os campos de ConfigDoPainel que mudaram, e/ou `numeracaoAleatoria`,
 * e/ou `novoCodigo: true` (desconecta as TVs que estão com o código antigo).
 */
export async function PUT(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const bruto = await req.json().catch(() => null);
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) {
    return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
  }

  const atual = await lerDaLoja(quem.lojaId);
  if (!atual) return NextResponse.json({ error: "Loja não encontrada" }, { status: 404 });

  // Junta com o gravado: a tela manda só o que mudou. O código nunca vem da
  // tela — ou fica, ou é sorteado de novo aqui.
  const { codigo: _ignorado, ...enviado } = bruto as Partial<ConfigDoPainel> & { novoCodigo?: boolean; numeracaoAleatoria?: boolean };
  const config = lerConfigDoPainel({ ...atual.config, ...enviado, codigo: atual.config.codigo });
  if ((bruto as any).novoCodigo === true) config.codigo = await codigoLivre();

  const data: { painelDeSenhas: ConfigDoPainel; numeracaoAleatoria?: boolean } = { painelDeSenhas: config };
  if (typeof (bruto as any).numeracaoAleatoria === "boolean" && (bruto as any).numeracaoAleatoria !== atual.numeracaoAleatoria) {
    if (!quem.podeNumeracao) {
      return NextResponse.json({ error: "Só o dono ou quem tem a permissão \"Minha loja\" muda a numeração dos pedidos." }, { status: 403 });
    }
    data.numeracaoAleatoria = (bruto as any).numeracaoAleatoria;
    console.log(`[Painel de senhas] Loja ${quem.lojaId}: numeração ${data.numeracaoAleatoria ? "SORTEADA" : "1, 2, 3"} a partir do próximo pedido.`);
  }

  await prisma.user.update({ where: { id: quem.lojaId }, data });
  return NextResponse.json({
    ...atual,
    config,
    numeracaoAleatoria: data.numeracaoAleatoria ?? atual.numeracaoAleatoria,
    podeNumeracao: quem.podeNumeracao,
  });
}
