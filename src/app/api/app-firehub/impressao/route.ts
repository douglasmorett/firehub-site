/**
 * GET  /api/app-firehub/impressao?largura=58mm&aparelho=<id>&abertoHaSeg=<n>
 * POST /api/app-firehub/impressao  { ids: string[] }
 *
 * O celular com a impressora Bluetooth (app FireHub) puxa aqui, a cada poucos
 * segundos, as comandas já em bytes ESC/POS (lib/app-firehub/impressao.ts), e
 * confirma no POST o que saiu no papel.
 *
 * Por baixo é a MESMA fila do Assistente do PC (api/store/print-queue, GET e
 * /ack), chamada aqui dentro com a loja da sessão do app — nunca com uma loja
 * vinda do celular. Cada aparelho entra na fila com um endereço próprio
 * ("celular-<id>"): o teto zero da abertura, a volta depois de fechado e o
 * dono de cada impressora (lib/dono-da-impressora.ts) contam o celular à
 * parte do PC da mesma rede.
 */
import { NextRequest, NextResponse } from "next/server";
import { exigirUsuarioDoApp } from "@/lib/app-firehub/sessao";
import { trabalhosParaOCelular, type LarguraDoCelular } from "@/lib/app-firehub/impressao";
import { GET as filaDoAssistente } from "@/app/api/store/print-queue/route";
import { POST as confirmarNaFila } from "@/app/api/store/print-queue/ack/route";

export const dynamic = "force-dynamic";

const SESSAO_EXPIRADA = { error: "Sessão expirada. Entre de novo.", precisaLogin: true };

function enderecoDoAparelho(req: NextRequest): string {
  const id = (new URL(req.url).searchParams.get("aparelho") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return `celular-${id || "sem-id"}`;
}

export async function GET(req: NextRequest) {
  const u = await exigirUsuarioDoApp(req);
  if (!u) return NextResponse.json(SESSAO_EXPIRADA, { status: 401 });

  const q = new URL(req.url).searchParams;
  const largura: LarguraDoCelular = q.get("largura") === "80mm" ? "80mm" : "58mm";
  const url = new URL("/api/store/print-queue", req.url);
  url.searchParams.set("franchiseeId", u.lojaId);
  const aberto = Number(q.get("abertoHaSeg"));
  if (Number.isFinite(aberto) && aberto >= 0) url.searchParams.set("abertoHaSeg", String(Math.floor(aberto)));

  const resposta = await filaDoAssistente(
    new NextRequest(url, { headers: { "x-forwarded-for": enderecoDoAparelho(req) } }),
  );
  if (!resposta.ok) return NextResponse.json({ error: "Fila indisponível agora." }, { status: 503 });
  const corpo = await resposta.json().catch(() => null);
  const jobs = Array.isArray(corpo?.jobs) ? corpo.jobs : [];
  return NextResponse.json({ trabalhos: trabalhosParaOCelular(jobs, largura) });
}

export async function POST(req: NextRequest) {
  const u = await exigirUsuarioDoApp(req);
  if (!u) return NextResponse.json(SESSAO_EXPIRADA, { status: 401 });
  const body = await req.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.slice(0, 200) : [];
  if (ids.length === 0) return NextResponse.json({ ok: true });
  return confirmarNaFila(
    new NextRequest(new URL("/api/store/print-queue/ack", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ franchiseeId: u.lojaId, ids }),
    }),
  );
}
