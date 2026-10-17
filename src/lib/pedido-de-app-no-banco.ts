/**
 * src/lib/pedido-de-app-no-banco.ts — ler e gravar `Motoboy.pedidoDeApp`, a
 * escolha "pagar diferente nos pedidos de app" do cadastro de cada entregador
 * (a regra mora em lib/repasse-do-entregador.ts, `PedidoDeAppDoEntregador`).
 *
 * ── Por que SQL cru, se a coluna está no schema.prisma ──────────────────────
 *
 * A coluna nasceu em 17/10/2026 e o boot a cria (lib/garantir-colunas.ts). O
 * cliente do Prisma é gerado no build, mas o das pastas de trabalho é
 * compartilhado e pode ser de antes dela: com `select: { pedidoDeApp: true }`
 * ou `data: { pedidoDeApp }` o código nem compila ali, e com um cliente velho
 * em execução a gravação daria erro de campo desconhecido. Pelo SQL a escolha
 * funciona com qualquer cliente — e, sem a coluna, a leitura volta vazia e o
 * acerto sai como era antes (a regra da loja), em vez de derrubar o caixa.
 *
 * Onde a busca é um `findMany` sem `select` (relatório do entregador, tela
 * Motoboys), o cliente gerado no build já traz o campo junto.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { lerPedidoDeAppDoEntregador, type PedidoDeAppDoEntregador } from "./repasse-do-entregador";

/** A escolha de cada entregador, por id. Sem a coluna (ou erro), mapa vazio. */
export async function pedidoDeAppDosEntregadores(ids: string[]): Promise<Map<string, PedidoDeAppDoEntregador | null>> {
  const mapa = new Map<string, PedidoDeAppDoEntregador | null>();
  if (!ids.length) return mapa;
  try {
    const linhas = await prisma.$queryRaw<{ id: string; pedidoDeApp: unknown }[]>(Prisma.sql`
      SELECT "id", "pedidoDeApp" FROM "Motoboy" WHERE "id" IN (${Prisma.join(ids)})`);
    for (const l of linhas) mapa.set(l.id, lerPedidoDeAppDoEntregador(l.pedidoDeApp));
  } catch (e: any) {
    console.error("[Motoboy] Não consegui ler a escolha dos pedidos de app:", e?.message);
  }
  return mapa;
}

/** Grava a escolha (nulo = volta a seguir a regra da loja). */
export async function gravarPedidoDeApp(motoboyId: string, escolha: PedidoDeAppDoEntregador | null): Promise<void> {
  const json = escolha ? JSON.stringify(escolha) : null;
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "Motoboy" SET "pedidoDeApp" = ${json}::jsonb WHERE "id" = ${motoboyId}`);
}
