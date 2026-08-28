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

    // Compara a loja DEPOIS de achar: código de outra loja responde igual a
    // código inexistente, para não confirmar que aquele código existe.
    if (achado && achado.franchiseeId === franchiseeId && achado.active) {
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

      if (!achado.stockItemId || !achado.stockItem) {
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
