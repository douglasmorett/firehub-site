/**
 * DELETE /api/store/tablet-na-mesa/chamados { tableId } — "atendido".
 *
 * Quem atende é quem está nas Mesas: o painel ou o garçom pelo link
 * (resolverOperadorDaMesa), por isso não é só o dono.
 */
import { NextResponse } from "next/server";
import { resolverOperadorDaMesa } from "@/lib/garcom-auth";
import { atenderChamado } from "@/lib/tablet-da-mesa/tablets";

export async function DELETE(req: Request) {
  const operador = await resolverOperadorDaMesa();
  if (!operador) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const corpo: any = await req.json().catch(() => ({}));
  const tableId = String(corpo?.tableId || "");
  if (tableId) await atenderChamado(operador.franchiseeId, tableId);
  return NextResponse.json({ ok: true });
}
