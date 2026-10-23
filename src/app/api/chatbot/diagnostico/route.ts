import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ehAdminNoBanco } from "@/lib/permissoes-da-equipe";
import { verifyCronAuth } from "@/lib/cron-auth";
import { lerTrace } from "@/lib/webhook-trace";
import { loopGuardBackend } from "@/lib/loop-guard";

export const dynamic = "force-dynamic";

/**
 * Aceita dois caminhos: sessão de ADMIN ou CRON_SECRET.
 *
 * A sessão existe para que dê para abrir a URL no navegador já logado, na hora
 * em que o cliente reclama. Exigir só o token empurraria quem está depurando a
 * copiar segredo de produção para o terminal — é a hora em que segredo vaza.
 *
 * O rastro é de TODAS as lojas (instância, final do telefone, trecho da
 * reclamação): aceitava qualquer login, e o cadastro de loja é aberto. Agora só
 * o ADMIN, com o papel lido do banco (o do cookie é o do dia do login). Nenhuma
 * tela de loja chama esta rota.
 */
async function autorizado(req: NextRequest): Promise<boolean> {
  const session = await getServerSession(authOptions).catch(() => null);
  if (await ehAdminNoBanco(session)) return true;
  return verifyCronAuth(req);
}

/**
 * Onde as últimas mensagens do WhatsApp pararam.
 *
 * Serve para responder "mandei áudio e o robô não respondeu" sem precisar das
 * telas do Coolify e do Railway abertas ao mesmo tempo. Cada entrada diz o
 * estágio que a mensagem alcançou; o primeiro estágio que não for "enviado"
 * aponta o culpado:
 *
 *   loja-nao-encontrada → a instância não casa com nenhuma loja
 *   audio-sem-bytes     → o áudio chegou vazio (download falhou no gateway)
 *   robo-desativado     → chatbotConfig.active está false nessa loja
 *   guard-ignorou       → anti-loop calou (o detalhe diz por quê)
 *   ia-timeout          → o Gemini passou do prazo; o cliente leu "só um instante"
 *   ia-tardia           → a resposta chegou depois do prazo e foi entregue assim mesmo
 *   envio-falhou        → a resposta existia mas o gateway recusou mandar
 *
 * Ausência de QUALQUER entrada para o telefone significa que a mensagem nem
 * chegou ao webhook — aí o problema está no gateway, antes daqui.
 *
 * Expõe apenas telefone mascarado e estágio, mas não é informação para ficar
 * aberta — exige sessão logada ou CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  if (!(await autorizado(req))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const rastro = lerTrace();

  return NextResponse.json({
    agora: new Date().toISOString(),
    estadoDoAntiLoop: loopGuardBackend(),
    totalRegistrado: rastro.length,
    ultimas: rastro,
  });
}
