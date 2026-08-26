import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/embaixador/inscricao — pública.
 *
 * O influenciador demonstra interesse em ser embaixador do FireHub. NÃO cria
 * embaixador: cria uma inscrição para a equipe analisar. Quem vira embaixador
 * de verdade é cadastrado à mão no admin, com código, comissão e carteira Asaas
 * — nada disso pode nascer de um formulário aberto na internet.
 *
 * ── Por que SQL cru e não um modelo do Prisma ──────────────────────────────
 *
 * O `schema.prisma` está com alteração em andamento de outra frente (preço por
 * canal), e declarar um modelo aqui exigiria commitar aquele trabalho junto.
 * São três consultas simples e isoladas nesta tabela; o SQL fixo custa menos do
 * que arrastar mudança alheia para dentro deste deploy.
 *
 * A tabela nasce em /api/admin/tabela-inscricoes-embaixador?criar=sim.
 */

/** Só o @usuario, sem URL, sem arroba duplicado. É o que a equipe vai procurar. */
function normalizarInstagram(bruto: string): string {
  return String(bruto || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .replace(/\/+$/, "")
    .replace(/^@+/, "")
    .split(/[?#/]/)[0]
    .slice(0, 60);
}

/** "12,5 mil", "12.500", "12500" → 12500. Texto livre vira número ou zero. */
function normalizarSeguidores(bruto: unknown): number {
  if (typeof bruto === "number" && Number.isFinite(bruto)) return Math.max(0, Math.floor(bruto));
  const txt = String(bruto ?? "").toLowerCase().trim();
  const mult = /\b(mil|k)\b|k$/.test(txt) ? 1000 : /\b(mi|m|milh(ão|ões|oes))\b/.test(txt) ? 1_000_000 : 1;
  const num = parseFloat(txt.replace(/[^\d,.]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num * mult));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));

    const fullName = String(body.fullName ?? "").trim().slice(0, 120);
    const instagram = normalizarInstagram(body.instagram);
    const followers = normalizarSeguidores(body.followers);
    const whatsapp = String(body.whatsapp ?? "").replace(/\D/g, "").slice(0, 15) || null;
    const email = String(body.email ?? "").trim().slice(0, 160) || null;
    const message = String(body.message ?? "").trim().slice(0, 1000) || null;

    if (fullName.length < 3) {
      return NextResponse.json({ error: "Escreva seu nome completo." }, { status: 400 });
    }
    if (!instagram) {
      return NextResponse.json({ error: "Informe seu @ do Instagram." }, { status: 400 });
    }

    // Mesmo @ mandado duas vezes não vira duas inscrições na mesa da equipe. A
    // janela de 24h existe porque quem clica duas vezes clica na mesma hora;
    // quem volta semanas depois com mais seguidores é inscrição nova de novo.
    const jaTem = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "AmbassadorApplication"
      WHERE lower("instagram") = ${instagram.toLowerCase()}
        AND "createdAt" > NOW() - INTERVAL '24 hours'
      LIMIT 1
    `;
    if (Array.isArray(jaTem) && jaTem.length > 0) {
      return NextResponse.json({
        ok: true,
        jaInscrito: true,
        mensagem: "Já recebemos sua inscrição. Nossa equipe entra em contato em breve.",
      });
    }

    const id = randomUUID();
    await prisma.$executeRaw`
      INSERT INTO "AmbassadorApplication"
        ("id","fullName","instagram","followers","whatsapp","email","message","status","createdAt","updatedAt")
      VALUES
        (${id}, ${fullName}, ${instagram}, ${followers}, ${whatsapp}, ${email}, ${message}, 'NOVO', NOW(), NOW())
    `;

    console.log(`[Embaixador] Inscrição de @${instagram} (${followers} seguidores) — ${fullName}`);

    return NextResponse.json({
      ok: true,
      mensagem: "Inscrição enviada! Nossa equipe vai analisar e entrar em contato com você.",
    });
  } catch (err: any) {
    // Tabela ainda não criada é o erro esperado de um deploy novo, e a mensagem
    // precisa dizer isso em vez de "erro interno" — senão vira caça ao fantasma.
    const faltaTabela = /AmbassadorApplication/i.test(err?.message || "") && /exist/i.test(err?.message || "");
    console.error("[Embaixador] Erro ao gravar inscrição:", err?.message);
    return NextResponse.json(
      {
        error: faltaTabela
          ? "A tabela de inscrições ainda não foi criada. Admin: abra /api/admin/tabela-inscricoes-embaixador?criar=sim"
          : "Não consegui registrar sua inscrição agora. Tente de novo em instantes.",
      },
      { status: 500 }
    );
  }
}
