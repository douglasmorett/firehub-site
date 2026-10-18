/**
 * CLUBE × ASAAS DA LOJA — assinar, ler o status e cancelar (com banco).
 * As regras e as chamadas HTTP moram em lib/clube/asaas.ts.
 *
 * A conta Asaas é a da loja principal da marca (`chave`, a mesma do app e do
 * clube): é ela que recebe a mensalidade e o aviso (/api/webhooks/asaas-loja/<chave>).
 */
import { prisma } from "@/lib/prisma";
import { ambienteDaChave } from "@/lib/asaas-da-loja";
import { chaveDaLoja, siteDoFireHub } from "@/lib/pix-online-pedido";
import { cpfValido } from "@/lib/fiscal-validacao";
import {
  avisoDoClube,
  cancelarNoAsaas,
  clienteDoSocio,
  criarCheckout,
  lerAssinaturaDoSocio,
  reconciliar,
  type Reconciliado,
} from "@/lib/clube/asaas";
import {
  gravarLeituraDoAsaas,
  ligarSocioAoAsaas,
  marcarLeitura,
  paraAssinatura,
  prepararAssinatura,
  socioDoAviso,
  type ClubeDaConta,
  type LinhaDoAssinante,
} from "@/lib/clube/no-banco";
import { situacaoDaAssinatura } from "@/lib/clube/regras";

/** Lê a assinatura do sócio no Asaas da loja e grava o status. Nunca lança: falhou, fica como estava. */
export async function sincronizarSocio(chave: string, socio: LinhaDoAssinante, evento = "leitura"): Promise<LinhaDoAssinante> {
  if (socio.cobranca !== "asaas" || (!socio.asaasClienteId && !socio.assinaturaExterna)) return socio;
  try {
    const acesso = await chaveDaLoja(chave);
    if (!acesso) return socio;
    const r = await lerAssinaturaDoSocio(acesso.chave, { clienteId: socio.asaasClienteId, assinaturaId: socio.assinaturaExterna });
    if (!r.ok || !r.dados) {
      console.warn(`[Clube Asaas] leitura do sócio ${socio.id} falhou: ${r.erro}`);
      await marcarLeitura(socio.id);
      return socio;
    }
    let rec: Reconciliado = reconciliar(r.dados.assinatura, r.dados.cobrancas);
    // A assinatura sumiu da conta (ou veio sem cobrança nenhuma) de quem já
    // pagou: não apaga o que estava pago — só marca cancelado.
    if (socio.pagamentos > 0 && r.dados.cobrancas.length === 0) {
      rec = { ...rec, status: r.dados.assinatura && rec.status !== "CANCELADO" ? socio.status : "CANCELADO", pagoAte: socio.pagoAte, pagamentos: socio.pagamentos, desde: socio.desde };
    }
    return await gravarLeituraDoAsaas(socio, rec, { evento });
  } catch (e: any) {
    console.error(`[Clube Asaas] sincronizar ${socio.id}:`, e?.message);
    return socio;
  }
}

/**
 * Lê de novo se a última leitura tem mais de `segundos` — para quem não está
 * em dia (voltou do checkout, o cartão da renovação foi aceito numa nova
 * tentativa e o aviso não chegou). Quem está ativo não gasta chamada.
 */
export async function sincronizarSeVelho(chave: string, socio: LinhaDoAssinante | null, segundos = 20): Promise<LinhaDoAssinante | null> {
  if (!socio || socio.cobranca !== "asaas") return socio;
  const situacao = situacaoDaAssinatura(paraAssinatura(socio));
  if (situacao === "ativo" && socio.status === "ATIVO") return socio;
  const ultima = socio.sincronizadoEm ? new Date(socio.sincronizadoEm).getTime() : 0;
  if (Date.now() - ultima < segundos * 1000) return socio;
  return sincronizarSocio(chave, socio, "leitura no app");
}

export type ResultadoDeAssinar =
  | { ok: true; checkout: string }
  | { ok: false; erro: string; precisaCpf?: boolean; jaSocio?: boolean };

/**
 * "Assinar" no app: acha (ou cria) o sócio, o cliente dele no Asaas da loja e
 * abre o checkout recorrente. O CPF só é pedido na primeira vez (o Asaas
 * exige para criar o cliente) e não fica guardado no FireHub.
 */
export async function assinarNoAsaas(
  clube: ClubeDaConta,
  cliente: { id: string; name: string | null; phone: string },
  o: { cpf: string | null; lojaId: string; nomeDoClube: string },
): Promise<ResultadoDeAssinar> {
  const acesso = await chaveDaLoja(clube.chave);
  if (!acesso) return { ok: false, erro: "A loja ainda não ligou a cobrança no cartão. Tente mais tarde." };

  let socio = await prepararAssinatura(clube.chave, { clienteId: cliente.id, telefone: cliente.phone, nome: cliente.name });
  socio = (await sincronizarSeVelho(clube.chave, socio, 0)) || socio;
  if (socio.status === "ATIVO" && situacaoDaAssinatura(paraAssinatura(socio)) === "ativo" && socio.cobranca === "asaas") {
    return { ok: false, erro: "Você já é sócio: o desconto já entra nos seus pedidos.", jaSocio: true };
  }

  // O cartão da renovação foi recusado: a assinatura velha sai (com a cobrança
  // vencida) e o checkout novo pega o cartão que funciona.
  if (socio.cobranca === "asaas" && socio.status === "PENDENTE" && socio.assinaturaExterna) {
    const c = await cancelarNoAsaas(acesso.chave, socio.assinaturaExterna);
    if (!c.ok && c.status !== 404) return { ok: false, erro: c.erro || "Não deu para trocar o cartão agora. Tente de novo." };
  }

  let clienteId = socio.cobranca === "asaas" ? socio.asaasClienteId : null;
  if (!clienteId) {
    const cpf = String(o.cpf || "").replace(/\D/g, "");
    if (!cpfValido(cpf)) return { ok: false, erro: "Informe o seu CPF: o Asaas pede para cobrar no cartão.", precisaCpf: true };
    const c = await clienteDoSocio(acesso.chave, { assinanteId: socio.id, nome: cliente.name || "Cliente", cpf, telefone: cliente.phone });
    if (!c.ok || !c.dados) return { ok: false, erro: c.erro || "O Asaas não aceitou o cadastro. Confira o CPF.", precisaCpf: /cpf/i.test(String(c.erro)) };
    clienteId = c.dados.id;
  }

  const loja = await prisma.user.findUnique({ where: { id: o.lojaId }, select: { slug: true } });
  const voltarPara = `${siteDoFireHub()}/loja/${encodeURIComponent(loja?.slug || "")}`;
  const ck = await criarCheckout(acesso.chave, ambienteDaChave(acesso.chave), {
    clienteId,
    assinanteId: socio.id,
    nomeDoClube: o.nomeDoClube,
    valor: clube.config.valor,
    percentual: clube.config.percentual,
    voltarPara,
    siteDaConta: acesso.conexao.site ?? null,
  });
  // Guarda o cliente mesmo se o checkout falhar: na próxima não pede o CPF de novo.
  await ligarSocioAoAsaas(socio.id, { asaasClienteId: clienteId, checkoutId: ck.ok ? ck.dados!.id : null });
  if (!ck.ok || !ck.dados) return { ok: false, erro: ck.erro || "Não deu para abrir o pagamento agora. Tente de novo." };
  return { ok: true, checkout: ck.dados.link };
}

/**
 * Cancela a assinatura no Asaas (cliente pelo app ou loja pelo painel). O que
 * já foi pago vale até acabar (`pagoAte`); nenhuma cobrança nova sai.
 */
export async function cancelarSocio(chave: string, socio: LinhaDoAssinante, quem: "cliente" | "loja"): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (socio.cobranca !== "asaas") return { ok: false, erro: "Esta assinatura é cobrada pela Cakto: o cancelamento é feito lá." };
  const acesso = await chaveDaLoja(chave);
  if (!acesso) return { ok: false, erro: "O Asaas da loja não está conectado." };
  let assinaturaId = socio.assinaturaExterna;
  if (!assinaturaId && socio.asaasClienteId) {
    const r = await lerAssinaturaDoSocio(acesso.chave, { clienteId: socio.asaasClienteId, assinaturaId: null });
    assinaturaId = r.dados?.assinatura?.id ?? null;
  }
  if (assinaturaId) {
    const c = await cancelarNoAsaas(acesso.chave, assinaturaId);
    if (!c.ok && c.status !== 404) return { ok: false, erro: c.erro || "O Asaas não cancelou agora. Tente de novo." };
  }
  await prisma.$executeRawUnsafe(
    `UPDATE "ClubeAssinatura" SET "status" = 'CANCELADO', "canceladoEm" = COALESCE("canceladoEm", CURRENT_TIMESTAMP),
       "assinaturaExterna" = COALESCE($2, "assinaturaExterna"), "ultimoEvento" = $3, "atualizadoEm" = CURRENT_TIMESTAMP WHERE "id" = $1`,
    socio.id,
    assinaturaId,
    `cancelado pela ${quem === "loja" ? "loja" : "app (cliente)"} ${new Date().toISOString()}`.slice(0, 120),
  );
  return { ok: true };
}

/**
 * O aviso do Asaas da loja é do clube? Lê a assinatura e grava. null = não é
 * do clube (o webhook segue para o pagamento dos pedidos).
 */
export async function aoAvisoDoAsaas(lojaId: string, corpo: any): Promise<Record<string, unknown> | null> {
  const aviso = avisoDoClube(corpo);
  if (!aviso) return null;
  const socio = await socioDoAviso(lojaId, aviso);
  if (!socio) return { ok: true, clube: true, ignorado: "assinatura que não é de sócio do clube" };
  const depois = await sincronizarSocio(lojaId, socio, aviso.evento);
  console.log(`[Clube Asaas] marca=${lojaId} evento=${aviso.evento} sócio=${socio.id} ${socio.status}→${depois.status}`);
  return { ok: true, clube: true, status: depois.status, pagoAte: depois.pagoAte };
}
