import { NextRequest, NextResponse } from "next/server";
import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { quemEsta, NAO_AUTORIZADO } from "@/lib/crm/acesso";
import { configDoAtendimento, salvarConfigDoAtendimento } from "@/lib/atendimento/config";
import { sincronizarConexao } from "@/lib/atendimento/entrada";
import {
  desconectarNoGateway, estadoNoGateway, pedirCodigoDePareamento, pedirQrCode, reiniciarNoGateway,
} from "@/lib/atendimento/whatsapp";

export const dynamic = "force-dynamic";

/** GET: o número do FireHub está conectado? Pergunta ao gateway agora (a tela consulta enquanto o QR está aberto). */
export async function GET() {
  const quem = await quemEsta();
  if (!quem || quem.tipo !== "ADMIN") return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });
  const estado = await estadoNoGateway();
  const config = await sincronizarConexao(estado);
  return NextResponse.json({ estado, conexao: config.conexao });
}

/**
 * POST { acao }: qr · codigo { numero } · reiniciar · desconectar.
 * Desconectar pede { confirmar: "DESCONECTAR" }: derruba o atendimento inteiro.
 */
export async function POST(req: NextRequest) {
  const quem = await quemEsta();
  if (!quem || quem.tipo !== "ADMIN") return NextResponse.json(NAO_AUTORIZADO, { status: 401 });
  if (!(await garantirEstruturaDoCrm())) return NextResponse.json({ error: "O banco do CRM ainda não está pronto." }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  switch (b.acao) {
    case "qr": {
      const r = await pedirQrCode();
      if (r.conectado) await sincronizarConexao({ conectado: true, telefone: null });
      return NextResponse.json(r, { status: r.erro && !r.qr && !r.conectado ? 502 : 200 });
    }
    case "codigo": {
      const r = await pedirCodigoDePareamento(String(b.numero || ""));
      return NextResponse.json(r, { status: r.erro ? 400 : 200 });
    }
    case "reiniciar": {
      const ok = await reiniciarNoGateway();
      return NextResponse.json({ ok }, { status: ok ? 200 : 502 });
    }
    case "desconectar": {
      if (b.confirmar !== "DESCONECTAR") return NextResponse.json({ error: "Confirme digitando DESCONECTAR." }, { status: 400 });
      const ok = await desconectarNoGateway();
      const config = await configDoAtendimento();
      await salvarConfigDoAtendimento({ conexao: { ...config.conexao, conectado: false, desconectadoDesde: new Date().toISOString(), jaConectou: false } });
      return NextResponse.json({ ok });
    }
    default:
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  }
}
