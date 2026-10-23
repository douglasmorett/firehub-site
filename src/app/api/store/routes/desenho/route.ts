/**
 * POST /api/store/routes/desenho — o caminho PELA RUA das pernas das rotas
 * que a Roteirização está mostrando no mapa.
 *
 *   corpo:    { pernas: [[latDe, lngDe, latPara, lngPara], …] }   (até 12)
 *   resposta: { pernas: ([lat, lng][] | null)[] }   (null = sem desenho: fica a reta)
 *
 * Douglas, 22/10/2026 21h15: a linha da rota no mapa era reta, "passando por
 * cima de muros e casas"; tem que seguir as ruas como o Google. A tela manda
 * as pernas da linha que já desenha (loja → 1ª parada → …, na ordem gravada da
 * rota, lib/rotas-no-mapa.ts) e só das rotas visíveis — as que ainda não
 * saíram e a que o lojista pediu para ver.
 *
 * A cota grátis do roteador é da cotação de frete dos clientes: cada perna é
 * desenhada uma vez e fica na memória (`desenhoDaPerna`, lib/distancia-por-
 * rota.ts); a tela também guarda o que recebeu. Um pedido a cada 2 s por
 * conta, e 8 s no máximo por pedido — o que não deu tempo volta null e a
 * tela pede de novo depois.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { desenhoDaPerna } from "@/lib/distancia-por-rota";
import { PERNAS_POR_PEDIDO_DE_DESENHO } from "@/lib/rotas-no-mapa";

export const dynamic = "force-dynamic";

const ultimoPedido = new Map<string, number>();
const INTERVALO_MS = 2000;
const TEMPO_POR_PEDIDO_MS = 8000;
/** Perna mais longa que isto não é entrega de moto: ponto errado, não se pergunta. */
const PERNA_MAXIMA_KM = 60;

const coordenada = (v: unknown, limite: number) => {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= limite ? n : null;
};

/** Linha reta grosseira só para barrar perna absurda (sem importar o Haversine do servidor). */
const kmAproximado = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) =>
  Math.hypot((a.lat - b.lat) * 111.32, (a.lng - b.lng) * 111.32 * Math.cos((a.lat * Math.PI) / 180));

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const quem = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true } });
  if (!quem) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const agora = Date.now();
  if (agora - (ultimoPedido.get(quem.id) || 0) < INTERVALO_MS) {
    return NextResponse.json({ error: "Calma: um desenho a cada 2 s." }, { status: 429 });
  }
  ultimoPedido.set(quem.id, agora);
  if (ultimoPedido.size > 5000) ultimoPedido.clear();

  const corpo = await req.json().catch(() => null);
  const lista: unknown[] = Array.isArray(corpo?.pernas) ? corpo.pernas : [];
  if (lista.length === 0) return NextResponse.json({ pernas: [] });
  if (lista.length > PERNAS_POR_PEDIDO_DE_DESENHO) {
    return NextResponse.json({ error: `No máximo ${PERNAS_POR_PEDIDO_DE_DESENHO} pernas por vez.` }, { status: 400 });
  }

  const fim = agora + TEMPO_POR_PEDIDO_MS;
  const pernas: ([number, number][] | null)[] = [];
  // Uma por vez: o limitador do roteador é de todas as lojas, e a cotação de
  // frete do cliente espera na mesma fila.
  for (const item of lista) {
    const v = Array.isArray(item) ? item : [];
    const latDe = coordenada(v[0], 90), lngDe = coordenada(v[1], 180), latPara = coordenada(v[2], 90), lngPara = coordenada(v[3], 180);
    if (latDe == null || lngDe == null || latPara == null || lngPara == null) { pernas.push(null); continue; }
    const de = { lat: latDe, lng: lngDe }, para = { lat: latPara, lng: lngPara };
    if (kmAproximado(de, para) > PERNA_MAXIMA_KM) { pernas.push(null); continue; }
    pernas.push(await desenhoDaPerna(de, para, fim));
  }
  return NextResponse.json({ pernas }, { headers: { "Cache-Control": "no-store" } });
}
