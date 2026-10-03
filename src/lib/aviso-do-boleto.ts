/**
 * src/lib/aviso-do-boleto.ts — O BOLETO DA MENSALIDADE CHEGA NO WHATSAPP, UMA VEZ.
 *
 * Quem manda é o Asaas, do número dele — nunca o WhatsApp do FireHub nem o de
 * uma loja (ver numero-do-firehub-so-responde e aviso-ao-lojista-nao-sai-pela-hakim
 * no vault).
 *
 * O Asaas cobra R$ 0,55 por mensagem de WhatsApp entregue; e-mail e SMS saem
 * no R$ 0,99 por cobrança paga, quantos avisos forem. Dono, 02/10/2026: o
 * WhatsApp vai assim que o boleto é gerado e só — nada de lembrete de
 * vencimento, atraso ou "pagamento confirmado" por ele. Por isso o WhatsApp
 * fica ligado apenas no evento PAYMENT_CREATED, e a ligação (robô de voz,
 * também R$ 0,55) sai de todos. E-mail e SMS ficam como estão.
 *
 * O fechamento cadastrava o cliente só com nome, e-mail e CPF/CNPJ: no
 * primeiro fechamento com boleto (01/10/2026) nenhum dos 8 clientes tinha
 * celular no Asaas, e o WhatsApp não teria para onde ir.
 *
 * Tem de rodar ANTES do POST /payments — o aviso de criação sai na hora em que
 * a cobrança nasce, com os canais que o cliente tem naquele momento.
 */
import { numerosDoDono } from "./numeros-do-dono";
import { mesmoTelefone } from "./telefone";

type LojaDoBoleto = {
  notificationPhone?: string | null;
  storePhone?: string | null;
  chatbotConfig?: unknown;
};

/**
 * O celular que vai para o cliente do Asaas: DDD + 9 dígitos, sem o 55.
 *
 * Primeiro o "WhatsApp do Proprietário" (e os outros números do dono); na
 * falta dele, o telefone da loja — menos quando é o número do próprio robô,
 * que responderia ao Asaas como se fosse um cliente. Fixo não serve: o
 * WhatsApp do Asaas não entrega em linha que não é celular.
 */
export function celularDoBoleto(loja: LojaDoBoleto): string | null {
  const robo = String((loja.chatbotConfig as any)?.phone || "");
  const candidatos = [
    ...numerosDoDono(loja.notificationPhone, loja.chatbotConfig),
    ...(loja.storePhone && !mesmoTelefone(loja.storePhone, robo) ? [loja.storePhone] : []),
  ];

  for (const bruto of candidatos) {
    let d = String(bruto).replace(/\D/g, "");
    if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
    d = d.replace(/^0+/, "");
    // Celular gravado sem o nono dígito (8 dígitos começando em 6–9).
    if (d.length === 10 && /^[6-9]/.test(d.slice(2))) d = d.slice(0, 2) + "9" + d.slice(2);
    if (d.length === 11 && d[2] === "9" && Number(d.slice(0, 2)) >= 11) return d;
  }
  return null;
}

/**
 * Põe o celular no cliente do Asaas (se ele ainda não tiver um) e deixa o
 * WhatsApp ligado só no aviso de criação da cobrança.
 *
 * Nunca derruba o boleto: qualquer falha aqui vira log e o boleto sai com os
 * avisos que o cliente já tinha (o e-mail).
 */
export async function prepararAvisoDoBoleto(
  base: string,
  chave: string,
  customerId: string,
  loja: LojaDoBoleto,
): Promise<{ celular: string | null; whatsapp: boolean }> {
  const headers = { "Content-Type": "application/json", access_token: chave };
  try {
    const cliente = await fetch(`${base}/customers/${customerId}`, { headers }).then((r) => r.json());

    // O celular que alguém pôs à mão no Asaas vale mais que o do cadastro.
    let celular: string | null = cliente?.mobilePhone ? String(cliente.mobilePhone) : null;
    if (!celular) {
      const doCadastro = celularDoBoleto(loja);
      if (doCadastro) {
        const r = await fetch(`${base}/customers/${customerId}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ mobilePhone: doCadastro }),
        });
        if (r.ok) celular = doCadastro;
        else console.error(`[Boleto] Asaas recusou o celular ${doCadastro} do cliente ${customerId}: ${await r.text()}`);
      }
    }
    if (!celular) {
      console.warn(`[Boleto] Cliente ${customerId} sem celular — o boleto vai só por e-mail.`);
      return { celular: null, whatsapp: false };
    }

    const lista = await fetch(`${base}/customers/${customerId}/notifications`, { headers }).then((r) => r.json());
    const mudar = (lista?.data || [])
      .filter((n: any) => !n.deleted)
      .flatMap((n: any) => {
        const criacao = n.event === "PAYMENT_CREATED";
        const certo = {
          enabled: criacao ? true : n.enabled,
          whatsappEnabledForCustomer: criacao,
          phoneCallEnabledForCustomer: false,
        };
        const igual = n.enabled === certo.enabled
          && !!n.whatsappEnabledForCustomer === certo.whatsappEnabledForCustomer
          && !n.phoneCallEnabledForCustomer;
        return igual ? [] : [{ id: n.id, ...certo }];
      });

    if (mudar.length > 0) {
      const r = await fetch(`${base}/notifications/batch`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ customer: customerId, notifications: mudar }),
      });
      if (!r.ok) {
        console.error(`[Boleto] Asaas recusou os avisos do cliente ${customerId}: ${await r.text()}`);
        return { celular, whatsapp: false };
      }
    }
    return { celular, whatsapp: true };
  } catch (e) {
    console.error(`[Boleto] Falha ao preparar o aviso do cliente ${customerId}:`, e);
    return { celular: null, whatsapp: false };
  }
}
