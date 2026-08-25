/**
 * /src/lib/ifood-logistics.ts
 *
 * Logistics API v1.0 — a viagem do entregador, do momento em que ele é alocado
 * até o código que o cliente dita na porta.
 *
 * O que a homologação avalia aqui não é cada chamada isolada, é a ORDEM: o
 * texto dos critérios diz, com essas palavras, que "a sequência correta é
 * crítica". Alocar depois de despachar, ou despachar sem ter chegado à origem,
 * reprova mesmo que cada requisição individualmente devolva 202.
 *
 * Por isso a ordem não é uma convenção documentada e torcida para dar certo:
 * está codificada em ETAPAS, e `proximaEtapa` recusa o pulo antes de gastar uma
 * chamada de rede.
 *
 * Atenção a um detalhe que confunde: existe um `/dispatch` no módulo Order,
 * usado no fluxo normal de pedido, e outro aqui no Logistics. São endpoints
 * diferentes, em caminhos diferentes. Este arquivo só trata do de Logistics.
 */
import { chamarComContexto } from "./ifood-http";
import type { ContextoIfood } from "./ifood-token";

const base = (orderId: string) => `/logistics/v1.0/orders/${orderId}`;

/** Os únicos veículos que a API aceita. Mandar outro devolve 400. */
export const VEICULOS = [
  "BICYCLE", "ONFOOT", "PATINETE", "EBIKE",
  "SUPERBIKE", "CAR", "MOTORCYCLE", "MOTORBIKE",
] as const;
export type Veiculo = (typeof VEICULOS)[number];

export const NOME_VEICULO: Record<Veiculo, string> = {
  BICYCLE: "Bicicleta",
  ONFOOT: "A pé",
  PATINETE: "Patinete",
  EBIKE: "Bike elétrica",
  SUPERBIKE: "Bike elétrica (alta potência)",
  CAR: "Carro",
  MOTORCYCLE: "Moto",
  MOTORBIKE: "Motoneta",
};

/**
 * As etapas, na ordem em que o iFood espera recebê-las.
 * `estado` é o que fica gravado em CustomerOrder.ifoodDriverStatus.
 */
export const ETAPAS = [
  { chave: "assignDriver",          rotulo: "Alocar entregador",   estado: "ASSIGNED" },
  { chave: "goingToOrigin",         rotulo: "Saiu para coleta",    estado: "GOING_TO_ORIGIN" },
  { chave: "arrivedAtOrigin",       rotulo: "Chegou na loja",      estado: "ARRIVED_AT_ORIGIN" },
  { chave: "dispatch",              rotulo: "Saiu para entrega",   estado: "DISPATCHED" },
  { chave: "arrivedAtDestination",  rotulo: "Chegou no cliente",   estado: "ARRIVED_AT_DESTINATION" },
] as const;

export type ChaveEtapa = (typeof ETAPAS)[number]["chave"];

/** Quantas etapas já foram cumpridas, a partir do estado gravado. */
export function posicaoAtual(estado?: string | null): number {
  if (!estado) return 0;
  if (estado === "DELIVERED") return ETAPAS.length + 1;
  const i = ETAPAS.findIndex((e) => e.estado === estado);
  return i < 0 ? 0 : i + 1;
}

/** A próxima etapa que faz sentido, ou null quando a viagem acabou. */
export function proximaEtapa(estado?: string | null) {
  const pos = posicaoAtual(estado);
  return pos < ETAPAS.length ? ETAPAS[pos] : null;
}

export class ErroSequencia extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroSequencia";
  }
}

/**
 * Recusa a etapa fora de ordem antes de gastar uma chamada.
 * A mensagem é a que o lojista vê, então ela diz o que fazer em seguida.
 */
export function conferirSequencia(estadoAtual: string | null | undefined, etapa: ChaveEtapa) {
  const alvo = ETAPAS.findIndex((e) => e.chave === etapa);
  if (alvo < 0) throw new ErroSequencia("Etapa desconhecida.");
  const pos = posicaoAtual(estadoAtual);

  if (pos === alvo) return; // exatamente a próxima

  if (pos > alvo) {
    throw new ErroSequencia(`"${ETAPAS[alvo].rotulo}" já foi feita para este pedido.`);
  }
  const faltando = ETAPAS[pos];
  throw new ErroSequencia(
    `Antes de "${ETAPAS[alvo].rotulo}" é preciso registrar "${faltando.rotulo}".`,
  );
}

// ── chamadas ────────────────────────────────────────────────────────────────

/** Detalhes do pedido: cliente, endereço, itens e pagamento. */
export function detalhesDoPedido(ctx: ContextoIfood, orderId: string) {
  return chamarComContexto(ctx, base(orderId));
}

/**
 * Aloca o entregador. Devolve 202 sem corpo quando dá certo — e 409 quando o
 * pedido já tem entregador, caso que o avaliador testa de propósito.
 */
export function alocarEntregador(
  ctx: ContextoIfood,
  orderId: string,
  entregador: { nome: string; telefone: string; veiculo: Veiculo },
) {
  const nome = (entregador.nome ?? "").trim();
  if (!nome) throw new ErroSequencia("Informe o nome do entregador.");

  // O iFood espera só dígitos; máscara com parênteses e traço volta como 400.
  const telefone = (entregador.telefone ?? "").replace(/\D/g, "");
  if (telefone.length < 10) throw new ErroSequencia("Informe o telefone do entregador com DDD.");

  if (!VEICULOS.includes(entregador.veiculo)) {
    throw new ErroSequencia("Escolha um tipo de veículo válido.");
  }

  return chamarComContexto(ctx, `${base(orderId)}/assignDriver`, {
    method: "POST",
    body: JSON.stringify({
      workerName: nome,
      workerPhone: telefone,
      workerVehicleType: entregador.veiculo,
    }),
  });
}

/** As etapas sem corpo: deslocamento, chegada, despacho, chegada no destino. */
export function marcarEtapa(ctx: ContextoIfood, orderId: string, etapa: Exclude<ChaveEtapa, "assignDriver">) {
  return chamarComContexto(ctx, `${base(orderId)}/${etapa}`, { method: "POST" });
}

/**
 * Envia o código de entrega ditado pelo cliente.
 *
 * Duas respostas contam como "a API funcionou": `{success:true}` confirma a
 * entrega e `{success:false}` diz que o código está errado — e aí a tela tem
 * que deixar digitar de novo, o que também é item de checklist. Código errado
 * também pode voltar como 422.
 */
export async function validarCodigoEntrega(
  ctx: ContextoIfood,
  orderId: string,
  codigo: string,
) {
  const code = (codigo ?? "").replace(/\s/g, "");
  if (!code) throw new ErroSequencia("Digite o código que o cliente informou.");

  const r = await chamarComContexto<{ success: boolean }>(ctx, `${base(orderId)}/verifyDeliveryCode`, {
    method: "POST",
    body: JSON.stringify({ code }),
  });

  return { ...r, conferido: r.ok && r.data?.success === true };
}

// ── o evento que autoriza pedir o código ────────────────────────────────────

export const EVENTO_CODIGO = "DELIVERY_DROP_CODE_REQUESTED";
export const CODIGO_CURTO = "DDCR";

/**
 * Reconhece, na fila de eventos, o aviso de que este pedido exige código.
 * Sem esse evento o pedido não é elegível e `verifyDeliveryCode` não deve ser
 * chamado — "não processa o evento DELIVERY_DROP_CODE_REQUESTED" está listado
 * na documentação entre as reprovações mais comuns.
 */
export function ehEventoDeCodigo(evento: any): boolean {
  if (!evento) return false;
  // Cuidado com o vizinho: "DDC" é DUE_DATE_CHANGE_REQUESTED, outro evento
  // completamente diferente. A comparação é de igualdade, nunca de prefixo.
  return evento.fullCode === EVENTO_CODIGO || evento.code === CODIGO_CURTO;
}

/**
 * Registra que este pedido passou a exigir código de entrega.
 *
 * Grava por SQL bruto de propósito: as colunas existem no banco mas não no
 * schema do Prisma. Ver /api/ifood/preparar-banco para o porquê — resumindo,
 * declarar o campo antes de a coluna existir derruba toda query de
 * CustomerOrder, e aqui o `db push` é manual.
 *
 * Nunca lança: um pedido sem a coluna criada ainda deve seguir o fluxo normal.
 */
export async function marcarExigeCodigo(prisma: any, ifoodOrderId: string): Promise<boolean> {
  try {
    const n = await prisma.$executeRaw`
      UPDATE "CustomerOrder"
         SET "ifoodDropCodeRequired" = true,
             "ifoodDropCodeAt" = NOW()
       WHERE "ifoodOrderId" = ${ifoodOrderId}
    `;
    return n > 0;
  } catch (e: any) {
    console.warn("[iFood logistics] não deu para marcar o código de entrega:", e?.message);
    return false;
  }
}

/** O pedido é elegível para validação de código? */
export async function exigeCodigo(prisma: any, ifoodOrderId: string): Promise<boolean> {
  try {
    const linhas = await prisma.$queryRaw<{ exige: boolean }[]>`
      SELECT COALESCE("ifoodDropCodeRequired", false) AS exige
        FROM "CustomerOrder"
       WHERE "ifoodOrderId" = ${ifoodOrderId}
       LIMIT 1
    `;
    return linhas?.[0]?.exige === true;
  } catch {
    return false;
  }
}
