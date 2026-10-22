import { PrismaClient } from '@prisma/client'
import { carimboDeStatus } from './order-stages'

/**
 * Injeta os marcos de tempo (acceptedAt, readyAt, dispatchedAt, deliveredAt)
 * em toda gravação que mexe no status do pedido. Ver src/lib/order-stages.ts.
 *
 * Nunca sobrescreve carimbo que a própria chamada já trouxe: quem importa um
 * pedido antigo de plataforma pode informar a hora real e ela vence.
 */
function comCarimbos<T>(data: T): T {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data
  const d = data as Record<string, unknown>
  if (!('status' in d)) return data
  const carimbo = carimboDeStatus(d.status)
  if (!carimbo) return data
  const campo = Object.keys(carimbo)[0]
  if (campo in d) return data
  return { ...d, ...carimbo } as T
}

// ── O ESTOQUE DO CANCELAMENTO, EM TODO CAMINHO ──────────────────────────────
//
// O cancelamento chega por uns quinze caminhos (painel, mesa, iFood, 99,
// Brendi, Keeta, robô, Pix vencido, disputa). Só três devolviam o insumo, e
// devolviam sempre — até a pizza que já tinha saído para entrega. Pelo mesmo
// motivo dos carimbos, a decisão mora aqui: toda gravação que põe o pedido em
// cancelado chama `tratarEstoqueDoCancelamento` (lib/stock.ts), que devolve o
// insumo se o pedido não foi feito e marca desperdício se foi
// (lib/desperdicio-do-cancelado.ts).
//
// Depois da gravação e fora dela: a gravação pode estar numa transação ainda
// aberta, então a função relê o pedido e, se ele ainda não aparece cancelado,
// tenta de novo mais tarde. Transação desfeita = pedido não cancelado = nada.
const STATUS_DE_CANCELAMENTO = new Set(['CANCELADO', 'CANCELLED', 'CANCELED'])
const ESPERAS_DO_ESTOQUE_MS = [1_500, 6_000, 20_000]

function cancela(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const status = (data as Record<string, unknown>).status
  return typeof status === 'string' && STATUS_DE_CANCELAMENTO.has(status.toUpperCase())
}

function estoqueDoCancelamento(ids: string[], tentativa = 0) {
  if (typeof window !== 'undefined' || ids.length === 0) return
  const espera = ESPERAS_DO_ESTOQUE_MS[tentativa]
  if (espera == null) return
  setTimeout(() => {
    import('./stock')
      .then(async ({ tratarEstoqueDoCancelamento }) => {
        const pendentes: string[] = []
        for (const id of ids) {
          const r = await tratarEstoqueDoCancelamento(id).catch((e) => {
            console.error(`[Stock] Erro no estoque do cancelamento ${id}:`, e?.message || e)
            return null
          })
          if (r === 'NAO_CANCELADO') pendentes.push(id)
        }
        estoqueDoCancelamento(pendentes, tentativa + 1)
      })
      .catch((e) => console.error('[Stock] Erro ao carregar o estoque do cancelamento:', e?.message || e))
  }, espera)
}

// ── A FOODY / VOE DELIVERY, EM TODO CAMINHO ─────────────────────────────────
//
// O motoboy terceirizado da Foody é chamado quando o pedido é aceito ou fica
// pronto (conforme a loja escolheu), e a entrega é cancelada lá quando o pedido
// é cancelado aqui. Status muda em uma dúzia de lugares (painel, KDS, aceite
// automático, robô, webhooks), então a decisão mora aqui, como a do estoque.
//
// Depois da gravação e fora dela: a chamada à Foody nunca segura nem desfaz a
// mudança de status, e `foodyDepoisDoStatus` relê o pedido (transação
// desfeita = status antigo = nada a fazer). Sem loja com a integração ligada,
// não custa nem uma consulta (lib/foody-no-banco.ts).
const STATUS_DA_FOODY = new Set([
  'CONFIRMADO', 'ACEITO', 'PREPARANDO', 'EM_PREPARO', 'EM_ANDAMENTO',
  'PRONTO', 'SAIU_ENTREGA', 'SAIU_PARA_ENTREGA',
  ...STATUS_DE_CANCELAMENTO,
])

function interessaAFoody(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const status = (data as Record<string, unknown>).status
  return typeof status === 'string' && STATUS_DA_FOODY.has(status.toUpperCase())
}

function foodyDoStatus(ids: string[]) {
  if (typeof window !== 'undefined' || ids.length === 0) return
  setTimeout(() => {
    import('./foody-no-banco')
      .then(({ foodyDepoisDoStatus }) => foodyDepoisDoStatus(ids))
      .catch((e) => console.error('[Foody] Erro ao carregar o gatilho:', e?.message || e))
  }, 1_500)
}

// ── O AVISO NO CELULAR DA LOJA (app FireHub), EM TODO CAMINHO ──────────────
//
// Pelo mesmo motivo da Foody: pedido nasce em uma dúzia de lugares. Chama na
// criação e quando o status vira "de entrada" (o rascunho do robô e o Pix pago
// viram pedido por update). Quem decide se avisa — e garante um aviso só — é
// lib/app-firehub/aviso-de-pedido.ts, que relê o pedido.
const STATUS_DE_ENTRADA = new Set(['NOVO', 'PENDENTE', 'CONFIRMADO', 'RECEBIDO', 'ACEITO'])

function avisoDeEntrada(data: unknown): boolean {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  const status = (data as Record<string, unknown>).status
  return typeof status === 'string' && STATUS_DE_ENTRADA.has(status.toUpperCase())
}

function avisarCelularDaLoja(id: unknown) {
  if (typeof window !== 'undefined' || typeof id !== 'string') return
  setTimeout(() => {
    import('./app-firehub/aviso-de-pedido')
      .then(({ avisarPedidoNovo }) => avisarPedidoNovo(id))
      .catch((e) => console.error('[App FireHub] Erro ao carregar o aviso:', e?.message || e))
  }, 1_500)
}

function criarClient() {
  const base = new PrismaClient()
  return base.$extends({
    query: {
      customerOrder: {
        async create({ args, query }) {
          args.data = comCarimbos(args.data)
          const resultado = await query(args)
          // Pedido que já nasce aceito (aceite automático, balcão).
          if (interessaAFoody(args.data)) {
            const id = (resultado as { id?: unknown })?.id
            if (typeof id === 'string') foodyDoStatus([id])
          }
          avisarCelularDaLoja((resultado as { id?: unknown })?.id)
          return resultado
        },
        async update({ args, query }) {
          args.data = comCarimbos(args.data)
          const resultado = await query(args)
          if (cancela(args.data)) {
            const id = typeof args.where?.id === 'string' ? args.where.id : (resultado as { id?: unknown })?.id
            if (typeof id === 'string') estoqueDoCancelamento([id])
          }
          if (interessaAFoody(args.data)) {
            const id = typeof args.where?.id === 'string' ? args.where.id : (resultado as { id?: unknown })?.id
            if (typeof id === 'string') foodyDoStatus([id])
          }
          if (avisoDeEntrada(args.data)) {
            avisarCelularDaLoja(typeof args.where?.id === 'string' ? args.where.id : (resultado as { id?: unknown })?.id)
          }
          return resultado
        },
        async updateMany({ args, query }) {
          args.data = comCarimbos(args.data)
          // Os ids saem ANTES da gravação: o where costuma ser "ainda não
          // cancelado", e depois dela não acharia mais ninguém.
          const ids = cancela(args.data) && args.where
            ? await base.customerOrder.findMany({ where: args.where, select: { id: true }, take: 200 })
                .then((l) => l.map((p) => p.id)).catch(() => [] as string[])
            : []
          const resultado = await query(args)
          if (ids.length) {
            estoqueDoCancelamento(ids)
            // Cancelou em qualquer quantidade: a entrega em curso na Foody cai junto.
            foodyDoStatus(ids)
          }
          // A Foody ouve a gravação que aponta o pedido pelo id (a escrita
          // condicional do painel e do app do motoboy) — sem consulta extra.
          // Gravação em lote (fechamento do caixa) não chama motoboy.
          if (interessaAFoody(args.data) && !ids.length) {
            const alvo = (args.where as { id?: unknown } | undefined)?.id
            const daFoody = typeof alvo === 'string' ? [alvo]
              : alvo && typeof alvo === 'object' && Array.isArray((alvo as { in?: unknown }).in)
                ? ((alvo as { in: unknown[] }).in.filter((x) => typeof x === 'string') as string[])
                : []
            if (daFoody.length && daFoody.length <= 20 && (resultado as { count?: number })?.count) foodyDoStatus(daFoody)
          }
          // A escrita condicional de um pedido só (rascunho do robô → pedido).
          const alvoDoAviso = (args.where as { id?: unknown } | undefined)?.id
          if (avisoDeEntrada(args.data) && typeof alvoDoAviso === 'string' && (resultado as { count?: number })?.count) {
            avisarCelularDaLoja(alvoDoAviso)
          }
          return resultado
        },
        upsert({ args, query }) {
          args.create = comCarimbos(args.create)
          args.update = comCarimbos(args.update)
          return query(args)
        },
      },
    },
  })
}

type ClientEstendido = ReturnType<typeof criarClient>

const globalForPrisma = globalThis as unknown as {
  prisma: ClientEstendido | undefined
}

if (typeof window === "undefined" && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not defined. Please set it in your .env file.')
}

export const prisma =
  globalForPrisma.prisma ??
  (typeof window === "undefined"
    ? criarClient()
    : (null as unknown as ClientEstendido))

if (process.env.NODE_ENV !== 'production' && typeof window === 'undefined') {
  globalForPrisma.prisma = prisma
}
