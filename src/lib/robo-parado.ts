/**
 * Robô de loja parada desliga sozinho (Douglas, 15/11/2026: "loja 7 dias sem
 * usar o robô desativa sozinho").
 *
 * Em 15/11 eram 92 lojas com o robô ligado e só 67 vendendo: 22 tinham parado
 * de usar o FireHub, fora do teste, e o robô seguia respondendo (e gastando IA)
 * no WhatsApp delas.
 *
 * A regra: robô ligado + fora do teste + cadastro com mais de 7 dias + nenhum
 * pedido (CustomerOrder, qualquer canal) nos últimos 7 dias → `active: false` e
 * `desligadoPorInatividadeEm` no chatbotConfig, para o atendimento saber por
 * que desligou. Não religa sozinho: a loja liga de novo em Chatbot IA.
 */
export const DIAS_SEM_PEDIDO = 7;

export const SQL_ROBOS_PARADOS = `
  SELECT u.id, u."storeName"
  FROM "User" u
  WHERE u.role = 'FRANCHISEE'
    AND u."isFireHubSystem" = false
    AND (u."chatbotConfig"->>'active')::boolean IS TRUE
    AND (u."trialEndsAt" IS NULL OR u."trialEndsAt" < now())
    AND u."createdAt" < now() - interval '${DIAS_SEM_PEDIDO} days'
    AND NOT EXISTS (
      SELECT 1 FROM "CustomerOrder" o
      WHERE o."franchiseeId" = u.id AND o."createdAt" > now() - interval '${DIAS_SEM_PEDIDO} days'
    )`;

export const SQL_DESLIGAR_ROBO = `
  UPDATE "User"
  SET "chatbotConfig" = "chatbotConfig" || jsonb_build_object('active', false, 'desligadoPorInatividadeEm', to_jsonb(now()))
  WHERE id = $1 AND ("chatbotConfig"->>'active')::boolean IS TRUE`;
