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

function criarClient() {
  return new PrismaClient().$extends({
    query: {
      customerOrder: {
        create({ args, query }) { args.data = comCarimbos(args.data); return query(args) },
        update({ args, query }) { args.data = comCarimbos(args.data); return query(args) },
        updateMany({ args, query }) { args.data = comCarimbos(args.data); return query(args) },
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
