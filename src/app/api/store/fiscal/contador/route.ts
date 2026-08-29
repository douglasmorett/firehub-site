import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET/POST /api/store/fiscal/contador
 *
 * O e-mail do contador e quando o pacote mensal deve sair.
 *
 * Fica dentro de `fiscalConfig` (que já é JSON) de propósito: o projeto não usa
 * migrations — coluna nova exige DDL no boot em lib/garantir-colunas — e este
 * dado é configuração de uma tela só, não algo que se consulte por índice.
 */

export type QuandoEnviar =
  | "DIA_1" // todo dia 1º, com o mês anterior fechado
  | "ULTIMO_DIA" // no último dia do mês corrente
  | "DIA_FIXO" // num dia escolhido (1 a 28)
  | "DATA_CERTA"; // numa data específica, uma vez

export type ConfigDoContador = {
  email: string | null;
  /** Cópia para o próprio lojista, para ele ver o que o contador recebeu. */
  copiaParaLoja: boolean;
  automatico: boolean;
  quando: QuandoEnviar;
  /** Só para DIA_FIXO: 1 a 28. */
  dia: number;
  /** Só para DATA_CERTA: "YYYY-MM-DD". */
  data: string | null;
  ultimoEnvioEm: string | null;
  ultimoEnvioResultado: string | null;
};

export const CONTADOR_PADRAO: ConfigDoContador = {
  email: null,
  copiaParaLoja: true,
  automatico: false,
  quando: "DIA_1",
  // 28 é o teto de propósito: dia 29, 30 ou 31 simplesmente não existe em
  // fevereiro, e o envio "todo dia 30" sumiria um mês por ano sem avisar.
  dia: 5,
  data: null,
  ultimoEnvioEm: null,
  ultimoEnvioResultado: null,
};

async function resolverLoja(email: string) {
  const u = await prisma.user.findUnique({
    where: { email },
    select: { id: true, ownerId: true, fiscalConfig: true },
  });
  if (!u) return null;
  const lojaId = u.ownerId || u.id;
  if (lojaId === u.id) return { lojaId, fiscalConfig: (u.fiscalConfig as any) || {} };
  const dono = await prisma.user.findUnique({ where: { id: lojaId }, select: { fiscalConfig: true } });
  return { lojaId, fiscalConfig: (dono?.fiscalConfig as any) || {} };
}

export function lerConfigDoContador(fiscalConfig: any): ConfigDoContador {
  const c = (fiscalConfig?.contador as Partial<ConfigDoContador>) || {};
  return {
    ...CONTADOR_PADRAO,
    ...c,
    dia: Math.min(28, Math.max(1, Number(c.dia ?? CONTADOR_PADRAO.dia) || CONTADOR_PADRAO.dia)),
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const loja = await resolverLoja(session.user.email);
  if (!loja) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  return NextResponse.json({ contador: lerConfigDoContador(loja.fiscalConfig) });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const loja = await resolverLoja(session.user.email);
  if (!loja) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const atual = lerConfigDoContador(loja.fiscalConfig);

  const email = body.email === null ? null : String(body.email ?? atual.email ?? "").trim() || null;
  // Validação simples e explicada: e-mail errado aqui não dá erro nenhum na
  // hora — só um envio mensal que nunca chega, e ninguém descobre por meses.
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return NextResponse.json(
      { error: "email_invalido", mensagem: `"${email}" não parece um e-mail válido.` },
      { status: 400 }
    );
  }

  const quando = ["DIA_1", "ULTIMO_DIA", "DIA_FIXO", "DATA_CERTA"].includes(body.quando)
    ? body.quando
    : atual.quando;

  const automatico = body.automatico === undefined ? atual.automatico : Boolean(body.automatico);
  if (automatico && !email) {
    return NextResponse.json(
      { error: "sem_email", mensagem: "Informe o e-mail do contador antes de ligar o envio automático." },
      { status: 400 }
    );
  }

  const data = body.data === undefined ? atual.data : (String(body.data || "").trim() || null);
  if (quando === "DATA_CERTA" && automatico && !/^\d{4}-\d{2}-\d{2}$/.test(String(data))) {
    return NextResponse.json(
      { error: "sem_data", mensagem: "Escolha a data do envio." },
      { status: 400 }
    );
  }

  const novo: ConfigDoContador = {
    ...atual,
    email,
    copiaParaLoja: body.copiaParaLoja === undefined ? atual.copiaParaLoja : Boolean(body.copiaParaLoja),
    automatico,
    quando,
    dia: Math.min(28, Math.max(1, Number(body.dia ?? atual.dia) || atual.dia)),
    data,
  };

  await prisma.user.update({
    where: { id: loja.lojaId },
    data: { fiscalConfig: { ...(loja.fiscalConfig || {}), contador: novo } },
  });

  return NextResponse.json({ success: true, contador: novo });
}
