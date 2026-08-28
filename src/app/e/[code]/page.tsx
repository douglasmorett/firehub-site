import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { temEstruturaDeLotes } from "@/lib/garantir-colunas";
import { normalizarCodigo, codigoPlausivel, estadoDePrazo, textoDePrazo } from "@/lib/lote";
import ScanDoLoteClient from "./ScanDoLoteClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Etiqueta — FireHub" };

/**
 * O endereço que o QR da etiqueta abre.
 *
 * Curto de propósito (/e/CODIGO): cabe no modo alfanumérico do QR, o que
 * permite imprimir um símbolo de 20 mm legível num rolo de 60 mm.
 *
 * Quem chega aqui veio da câmera nativa do celular, sem app e sem ter o FireHub
 * aberto. Se a sessão tiver expirado — o caso mais comum no celular de cozinha —
 * o login precisa VOLTAR para cá depois, senão a pessoa escaneia, entra, e
 * aterrissa na home sem nenhuma pista de qual etiqueta ela leu.
 */
export default async function PaginaDoLote({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const codigo = normalizarCodigo(code);

  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/e/${codigo}`)}`);
  }

  const eu = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, ownerId: true, storeName: true, name: true },
  });
  if (!eu) redirect("/login");

  const franchiseeId = eu.ownerId || eu.id;
  const loja = eu.ownerId
    ? await prisma.user.findUnique({ where: { id: franchiseeId }, select: { storeName: true, name: true } })
    : { storeName: eu.storeName, name: eu.name };
  const nomeDaLoja = loja?.storeName || loja?.name || "sua loja";

  // ── Resolve o estado aqui no servidor ────────────────────────────────────
  // A tela abre JÁ no estado certo, sem piscar "carregando" na frente de quem
  // está de pé na câmara fria com a tela embaçando.
  let estado = "NAO_ENCONTRADA";
  let lote: any = null;
  let ultima: any = null;

  if (!(await temEstruturaDeLotes())) {
    estado = "RECURSO_INDISPONIVEL";
  } else if (!codigoPlausivel(codigo)) {
    estado = "CODIGO_INVALIDO";
  } else {
    const achado = await prisma.stockLot.findUnique({
      where: { code: codigo },
      include: { stockItem: { select: { id: true, name: true, unit: true, quantity: true } } },
    });

    // NÃO filtra por loja de propósito. `franchiseeId` é quem IMPRIMIU a
    // etiqueta — na franquia, a fábrica. A loja que RECEBE lê o QR, e é nesse
    // momento que o insumo entra no estoque dela. Filtrar por loja bloquearia
    // exatamente o caso principal.
    if (achado && achado.active) {
      lote = {
        id: achado.id,
        code: achado.code,
        productName: achado.productName,
        loteRef: achado.loteRef,
        fabricadoEm: achado.fabricadoEm ? achado.fabricadoEm.toISOString() : null,
        validoAte: achado.validoAte ? achado.validoAte.toISOString() : null,
        unit: achado.unit,
        quantidadeRestante: achado.quantidadeRestante,
        quantidadeInicial: achado.quantidadeInicial,
        estadoDePrazo: estadoDePrazo(achado.validoAte),
        textoDePrazo: textoDePrazo(achado.validoAte),
        insumo: achado.stockItem,
      };

      if (!achado.recebidoPorId) {
        // Primeira leitura: a mercadoria chegou e ainda não entrou em estoque
        // nenhum. Qualquer loja da rede pode receber.
        estado = "A_RECEBER";
      } else if (achado.recebidoPorId !== franchiseeId) {
        // Erro honesto, e não "não encontrada": a etiqueta existe, só entrou no
        // estoque de outro lugar. Dizer isso é o que evita a mesma caixa ser
        // lançada duas vezes em duas lojas.
        estado = "RECEBIDA_POR_OUTRA";
        const outra = await prisma.user.findUnique({
          where: { id: achado.recebidoPorId },
          select: { storeName: true, name: true },
        });
        lote.recebidaPor = outra?.storeName || outra?.name || "outra loja";
      } else if (!achado.stockItemId || !achado.stockItem) {
        estado = "SEM_INSUMO_VINCULADO";
      } else {
        const recente = await prisma.stockTransaction.findFirst({
          where: {
            stockLotId: achado.id,
            userId: eu.id,
            createdAt: { gte: new Date(Date.now() - 2 * 60 * 1000) },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, quantity: true, createdAt: true },
        });
        if (recente) {
          estado = "JA_MOVIMENTADO";
          ultima = {
            quantidade: Math.abs(recente.quantity),
            quando: recente.createdAt.toISOString(),
          };
        } else if (achado.quantidadeRestante <= 0) {
          estado = "LOTE_ZERADO";
        } else {
          estado = "OK";
        }
      }
    }
  }

  return (
    <ScanDoLoteClient
      codigo={codigo}
      estado={estado}
      lote={lote}
      ultima={ultima}
      nomeDaLoja={nomeDaLoja}
    />
  );
}
