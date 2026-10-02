/**
 * /api/admin/tutoriais — envio dos arquivos dos tutoriais em vídeo para o
 * volume de uploads do servidor. Só ADMIN.
 *
 * GET  → o que já chegou, tutorial por tutorial (versão atual de cada um).
 * POST ?id=&versao=&arquivo=&inicio=&tamanho=  (corpo: os bytes do pedaço)
 *
 * Vai em pedaços porque o proxy do Next corta corpo acima de 10 MB sem avisar
 * (o maior vídeo tem 14 MB). Cada pedaço diz onde começa; se não emendar com o
 * que já está gravado, a resposta é 409 com o tamanho certo, e quem envia
 * recomeça dali. O arquivo só troca de nome para o definitivo quando o último
 * byte chega: um envio pela metade nunca vira botão na tela.
 *
 * O destino nunca vem de quem envia: só a versão ATUAL de um tutorial que
 * existe em tutoriais-fichas.json, e só video.mp4, capa.jpg e legendas.vtt.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { appendFile, mkdir, rename, stat, writeFile } from "fs/promises";
import path from "path";
import { authOptions } from "@/lib/auth";
import fichas from "@/lib/tutoriais-fichas.json";
import { ARQUIVOS_DO_TUTORIAL } from "@/lib/tutoriais";
import { caminhoDoArquivoDoTutorial, esquecerTutoriaisEnviados, tutoriaisEnviados } from "@/lib/tutoriais-no-servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PEDACO_MAXIMO = 6 * 1024 * 1024;
const ARQUIVO_MAXIMO = 60 * 1024 * 1024;

async function ehAdmin() {
  const sessao = await getServerSession(authOptions);
  return (sessao?.user as { role?: string } | undefined)?.role === "ADMIN";
}

const tamanhoDe = (caminho: string) => stat(caminho).then((s) => s.size, () => null);

export async function GET() {
  if (!(await ehAdmin())) return NextResponse.json({ error: "Só admin" }, { status: 403 });
  esquecerTutoriaisEnviados();
  const lista = await Promise.all(Object.values(fichas as Record<string, { id: string; versao: string }>).map(async (f) => {
    const arquivos: Record<string, number | null> = {};
    for (const a of ARQUIVOS_DO_TUTORIAL) {
      const caminho = caminhoDoArquivoDoTutorial(f.id, f.versao, a);
      arquivos[a] = caminho ? await tamanhoDe(caminho) : null;
    }
    return { id: f.id, versao: f.versao, arquivos };
  }));
  return NextResponse.json({ enviados: tutoriaisEnviados(), tutoriais: lista });
}

export async function POST(req: NextRequest) {
  if (!(await ehAdmin())) return NextResponse.json({ error: "Só admin" }, { status: 403 });
  const q = req.nextUrl.searchParams;
  const destino = caminhoDoArquivoDoTutorial(q.get("id") || "", q.get("versao") || "", q.get("arquivo") || "");
  if (!destino) return NextResponse.json({ error: "Tutorial, versão ou arquivo desconhecido" }, { status: 400 });

  const inicio = Number(q.get("inicio"));
  const tamanho = Number(q.get("tamanho"));
  if (!Number.isInteger(inicio) || inicio < 0 || !Number.isInteger(tamanho) || tamanho <= 0 || tamanho > ARQUIVO_MAXIMO) {
    return NextResponse.json({ error: "inicio/tamanho inválidos" }, { status: 400 });
  }
  const pedaco = Buffer.from(await req.arrayBuffer());
  if (!pedaco.length || pedaco.length > PEDACO_MAXIMO) return NextResponse.json({ error: "Pedaço vazio ou grande demais" }, { status: 413 });
  if (inicio + pedaco.length > tamanho) return NextResponse.json({ error: "Pedaço passa do tamanho do arquivo" }, { status: 400 });

  const parcial = `${destino}.parcial`;
  await mkdir(path.dirname(destino), { recursive: true });
  if (inicio === 0) {
    await writeFile(parcial, pedaco);
  } else {
    const jaTem = await tamanhoDe(parcial);
    if (jaTem !== inicio) return NextResponse.json({ error: "Pedaço fora de ordem", recomecarDe: jaTem ?? 0 }, { status: 409 });
    await appendFile(parcial, pedaco);
  }

  const recebido = inicio + pedaco.length;
  if (recebido < tamanho) return NextResponse.json({ recebido });
  await rename(parcial, destino);
  esquecerTutoriaisEnviados();
  return NextResponse.json({ recebido, pronto: true });
}
