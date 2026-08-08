import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

if (typeof window === "undefined" && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not defined. Please set it in your .env file.')
}

export const prisma =
  globalForPrisma.prisma ??
  (typeof window === "undefined"
    ? new PrismaClient()
    : (null as unknown as PrismaClient))

if (process.env.NODE_ENV !== 'production' && typeof window === 'undefined') {
  globalForPrisma.prisma = prisma
}
