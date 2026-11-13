/**
 * POST { valorCentavos } — o Pix na tela do caixa: BR Code estático com valor e
 * txid, na chave Pix da loja (a do robô — Chatbot IA › "Chave Pix da loja").
 * Sem Asaas e sem taxa. Quem confirma o recebimento é o operador (a venda
 * grava o nome dele — lib/caixa-mercado/venda.ts).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contextoDoCaixa, ehResposta } from "@/lib/caixa-mercado/rota";
import { pixDoCaixa } from "@/lib/caixa-mercado/assinatura";
import { cidadeDoCadastro, montarBrCode, novoTxid } from "@/lib/caixa-mercado/pix-brcode";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ctx = await contextoDoCaixa({ exigirTerminal: true });
  if (ehResposta(ctx)) return ctx;
  const corpo: any = await req.json().catch(() => ({}));
  const valorCentavos = Math.round(Number(corpo?.valorCentavos));
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0 || valorCentavos > 10_000_000) {
    return NextResponse.json({ error: "Valor do Pix inválido." }, { status: 400 });
  }
  const loja = await prisma.user.findUnique({ where: { id: ctx.quem.lojaId }, select: { chatbotConfig: true, storeName: true, city: true } });
  const pix = await pixDoCaixa(ctx.quem.lojaId, loja?.chatbotConfig);
  if (!pix) {
    return NextResponse.json({ error: "A loja não tem chave Pix cadastrada. Cadastre em Chatbot IA › Chave Pix da loja.", codigo: "SEM_CHAVE_PIX" }, { status: 409 });
  }
  const txid = novoTxid();
  const brcode = montarBrCode({
    chave: pix.chave,
    nome: pix.titular || loja?.storeName || "Loja",
    cidade: cidadeDoCadastro(loja?.city) || "Brasil",
    valorCentavos,
    txid,
    pontoDeIniciacao: "11",
  });
  return NextResponse.json({ brcode, txid, titular: pix.titular, banco: pix.banco, valorCentavos });
}
