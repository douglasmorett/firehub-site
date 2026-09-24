import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, PERMISSAO_AVISOS } from "@/lib/api-key";
import { avisarDono } from "@/lib/alertas-do-dono";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/avisos — uma ferramenta de fora manda um aviso, e o robô da
 * loja entrega no WhatsApp do dono.
 *
 * Nasceu em 24/09/2026 para o Instagram do Douglas: o ManyChat atende quem
 * comenta PALESTRA ou pede demonstração do FireHub, e o "Notificar
 * responsáveis" dele só avisa por e-mail — que o dono não lê. Aqui o ManyChat
 * ("Fazer uma consulta externa") chama esta rota, e o aviso sai pelo mesmo
 * WhatsApp que o robô já usa, para o "WhatsApp do Proprietário" da loja
 * (lib/alertas-do-dono.ts, tipo "aviso_externo").
 *
 * ── Quem pode chamar ─────────────────────────────────────────────────────────
 * Só chave de API com a permissão de avisos (criada em Minha Loja → API Aberta,
 * opção "Avisos no WhatsApp do dono"). Essa chave não abre pedido nem cardápio,
 * e a chave de pedidos não abre esta rota (lib/api-key.ts).
 *
 * ── Para quem vai ────────────────────────────────────────────────────────────
 * Nunca para um número que venha no corpo: o destino é sempre o dono da loja
 * dona da chave. Uma chave vazada, no pior caso, manda aviso para o próprio
 * dono — e o limite por hora abaixo segura até isso.
 *
 * Corpo (JSON), todos os campos são texto:
 *   titulo     — "Pedido de palestra"            (até 80 caracteres)
 *   mensagem   — o que aconteceu                  (até 600)
 *   nome       — nome da pessoa                   (até 80)
 *   instagram  — @ da pessoa, com ou sem arroba
 */

const LIMITE_POR_HORA = 20;
const UMA_HORA_MS = 60 * 60 * 1000;

/**
 * Envios da última hora, por loja. Fica na memória do processo: o site roda
 * num contêiner só, e o limite existe para uma automação que disparou em
 * laço (ou uma chave vazada) não inundar o WhatsApp do dono — o que também
 * marcaria o número do robô como spam.
 */
const enviosRecentes = new Map<string, number[]>();

function cabeNoLimite(lojaId: string): boolean {
  const agora = Date.now();
  const naJanela = (enviosRecentes.get(lojaId) || []).filter((t) => agora - t < UMA_HORA_MS);
  if (naJanela.length >= LIMITE_POR_HORA) {
    enviosRecentes.set(lojaId, naJanela);
    return false;
  }
  naJanela.push(agora);
  enviosRecentes.set(lojaId, naJanela);
  return true;
}

/** Texto de uma linha: sem controle, sem quebra, sem os sinais de negrito e itálico do WhatsApp. */
function linha(valor: unknown, max: number): string {
  return String(valor ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Texto livre: quebras de linha ficam, o resto do controle sai. */
function paragrafo(valor: unknown, max: number): string {
  return String(valor ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** "@douglasmorett", "douglasmorett" ou vazio. Só aceita o formato de usuário do Instagram. */
function usuarioDoInstagram(valor: unknown): string {
  const u = String(valor ?? "").trim().replace(/^@+/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(u) ? u : "";
}

export async function POST(req: NextRequest) {
  const auth = await authenticateApiKey(req, PERMISSAO_AVISOS);
  if (!auth) {
    return NextResponse.json(
      {
        error: "Não autorizado. Use uma chave de API de avisos (Minha Loja → API Aberta → Nova Chave → Avisos no WhatsApp do dono).",
        code: "UNAUTHORIZED",
      },
      { status: 401 }
    );
  }

  let corpo: any;
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido: envie JSON.", code: "INVALID_BODY" }, { status: 400 });
  }

  const titulo = linha(corpo?.titulo, 80) || "Aviso";
  const mensagem = paragrafo(corpo?.mensagem, 600);
  const nome = linha(corpo?.nome, 80);
  const instagram = usuarioDoInstagram(corpo?.instagram);

  if (!mensagem && !nome && !instagram) {
    return NextResponse.json(
      { error: "Mande pelo menos a mensagem, o nome ou o Instagram da pessoa.", code: "EMPTY" },
      { status: 400 }
    );
  }

  if (!cabeNoLimite(auth.franchiseeId)) {
    return NextResponse.json(
      { error: `Limite de ${LIMITE_POR_HORA} avisos por hora atingido.`, code: "RATE_LIMITED" },
      { status: 429 }
    );
  }

  const quem = [nome ? `*${nome}*` : "", instagram ? `instagram.com/${instagram}` : ""].filter(Boolean).join(" · ");
  const texto =
    `📣 *${titulo}*\n\n` +
    (quem ? `${quem}\n` : "") +
    (mensagem ? `${mensagem}\n` : "") +
    `\n_via ${linha(auth.keyName, 60) || "API Aberta"}_`;

  const enviado = await avisarDono(auth.franchiseeId, "aviso_externo", texto);

  // 200 mesmo quando não sai: quem chama (o ManyChat) não tem o que fazer com
  // o erro, e a conversa com a pessoa segue. O motivo fica aqui para quem
  // testa a integração, e no log do servidor (lib/alertas-do-dono.ts).
  return NextResponse.json({
    ok: true,
    enviado,
    ...(enviado
      ? {}
      : {
          motivo:
            "Não saiu. Confira o WhatsApp do Proprietário em Minha Loja, o alerta \"Avisos de fora do FireHub\" em Chatbot IA → Alertas e se o robô está conectado.",
        }),
  });
}
