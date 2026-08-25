/**
 * /src/lib/ifood-app.ts
 *
 * Qual aplicativo iFood usar para conectar uma loja.
 *
 * A homologação precisa ser gravada com um **aplicativo de teste** e uma **loja
 * de teste** — é exigência escrita do Suporte à Integração. Mas as lojas reais
 * do FireHub estão conectadas ao aplicativo de produção, e os tokens delas só
 * renovam com as credenciais dele.
 *
 * Trocar `IFOOD_CLIENT_ID_DISTRIBUTED` pelas credenciais de teste resolveria a
 * gravação e quebraria a operação: todo refresh_token das lojas em produção
 * deixaria de ser aceito, porque refresh é amarrado ao aplicativo que o emitiu.
 *
 * Por isso os dois aplicativos convivem. Qual entra em cada conexão é escolhido
 * aqui, e as credenciais usadas ficam gravadas na própria IfoodIntegration —
 * assim cada loja renova pelo aplicativo que a autorizou, sem depender de qual
 * variável de ambiente está valendo no momento.
 */

export type AppIfood = "producao" | "homologacao";

export type CredenciaisApp = {
  app: AppIfood;
  clientId: string;
  clientSecret: string;
  rotulo: string;
};

/** Lê a escolha de qualquer forma que ela chegue: query, corpo ou nada. */
export function appEscolhido(valor?: string | null): AppIfood {
  return valor === "homologacao" || valor === "teste" ? "homologacao" : "producao";
}

export class ErroCredencialApp extends Error {
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.name = "ErroCredencialApp";
    this.hint = hint;
  }
}

/**
 * As credenciais do aplicativo pedido.
 *
 * O aplicativo de teste é opcional: quem nunca vai gravar homologação não
 * precisa configurar nada. Mas se for pedido sem estar configurado, o erro diz
 * exatamente qual variável falta — em vez de cair silenciosamente no
 * aplicativo de produção, que geraria um código de ativação inútil para a loja
 * de teste.
 */
export function credenciaisDoApp(app: AppIfood): CredenciaisApp {
  if (app === "homologacao") {
    const clientId = process.env.IFOOD_HOMOLOG_CLIENT_ID;
    const clientSecret = process.env.IFOOD_HOMOLOG_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new ErroCredencialApp(
        "O aplicativo de teste do iFood não está configurado no servidor.",
        "Defina IFOOD_HOMOLOG_CLIENT_ID e IFOOD_HOMOLOG_CLIENT_SECRET com as credenciais do aplicativo de teste distribuído do Portal do Desenvolvedor.",
      );
    }
    return { app, clientId, clientSecret, rotulo: "aplicativo de teste (homologação)" };
  }

  const clientId = process.env.IFOOD_CLIENT_ID_DISTRIBUTED;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET_DISTRIBUTED;
  if (!clientId || !clientSecret) {
    throw new ErroCredencialApp(
      "Integração iFood indisponível no momento.",
      "As credenciais do aplicativo não estão configuradas no servidor. Avise o suporte.",
    );
  }
  return { app, clientId, clientSecret, rotulo: "aplicativo de produção" };
}

/** Só o clientId — o endpoint de userCode não aceita o secret. */
export function clientIdDoApp(app: AppIfood): string {
  return credenciaisDoApp(app).clientId;
}
