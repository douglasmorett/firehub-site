import { NextResponse } from "next/server";
import { lojaDasReservasDaSessao } from "@/lib/reservas/sessao";
import { reservasDaLoja } from "@/lib/reservas/assinatura";
import { agoraNaLoja, criarReserva, fusoDaLoja, mudarReserva, type AcaoNaReserva } from "@/lib/reservas/no-banco";
import { dataValida } from "@/lib/reservas/regras";

/**
 * Uma reserva, pelo painel (/store/reservas).
 * POST  { nome, telefone, data, hora, pessoas, observacao, mesaId, encaixar } — reserva manual.
 *       Não coube: 409 com o motivo e os horários livres mais perto; `encaixar`
 *       grava mesmo assim (o dono decide apertar mais uma mesa).
 * PATCH { id, acao: chegou|nao_veio|cancelar|confirmar|mesa|editar|mover, ... }
 */
async function porta() {
  const s = await lojaDasReservasDaSessao();
  if (!s) return { erro: NextResponse.json({ error: "Seu acesso não abre as reservas. Peça ao dono da loja." }, { status: 403 }) };
  if (!(await reservasDaLoja(s.franchiseeId)).ligado) {
    return { erro: NextResponse.json({ error: "O módulo Reservas está desligado. Ative em Reservas para gerenciar." }, { status: 403 }) };
  }
  return { s, agora: agoraNaLoja(await fusoDaLoja(s.franchiseeId)) };
}

export async function POST(req: Request) {
  const p = await porta();
  if ("erro" in p) return p.erro;
  let c: any = {};
  try { c = await req.json(); } catch {}
  if (!dataValida(String(c?.data || ""))) return NextResponse.json({ error: "Escolha o dia." }, { status: 400 });
  const r = await criarReserva(p.s.franchiseeId, {
    nome: String(c.nome || ""), telefone: c.telefone ? String(c.telefone) : null, data: String(c.data), hora: String(c.hora || ""),
    pessoas: Number(c.pessoas), observacao: c.observacao ? String(c.observacao) : null, mesaId: c.mesaId ? String(c.mesaId) : null,
    origem: "PAINEL", criadaPor: p.s.quem,
  }, p.agora, { encaixar: c.encaixar === true });
  if (!r.ok) return NextResponse.json({ error: r.explicacao, motivo: r.motivo, sugestoes: r.sugestoes }, { status: 409 });
  return NextResponse.json({ ok: true, reserva: r.reserva, ocupacao: r.ocupacao });
}

const ACOES = new Set(["chegou", "nao_veio", "cancelar", "confirmar", "mesa", "editar", "mover"]);

export async function PATCH(req: Request) {
  const p = await porta();
  if ("erro" in p) return p.erro;
  let c: any = {};
  try { c = await req.json(); } catch {}
  const id = String(c?.id || "");
  if (!id || !ACOES.has(c?.acao)) return NextResponse.json({ error: "Informe a reserva e a ação." }, { status: 400 });
  if (c.acao === "mover" && !dataValida(String(c.data || ""))) return NextResponse.json({ error: "Escolha o dia." }, { status: 400 });
  const r = await mudarReserva(p.s.franchiseeId, id, c as AcaoNaReserva, p.agora);
  if (!r.ok) return NextResponse.json({ error: r.explicacao, motivo: r.motivo, sugestoes: r.sugestoes }, { status: r.motivo === "nao_achou" ? 404 : 409 });
  return NextResponse.json({ ok: true, reserva: r.reserva });
}
