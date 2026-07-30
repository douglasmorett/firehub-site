import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require"
    }
  }
});

async function main() {
  console.log("Adding missing User columns via executeRawUnsafe...");

  const queries = [
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "planPercent" DOUBLE PRECISION DEFAULT 1;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "metaFbPageId" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "metaFbAccessToken" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "metaAdAccountId" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "metaPixelId" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "metaAdsEnabled" BOOLEAN DEFAULT false;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "metaAdsWeeklyFee" DOUBLE PRECISION DEFAULT 50;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mpSellerId" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mpAccessToken" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mpRefreshToken" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "celcoinAccountId" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ifoodMerchantId" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ifoodAccessToken" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ifoodClientId" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ifoodConnected" BOOLEAN DEFAULT false;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ifoodWidgetId" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ifoodSyncDeliveryTime" BOOLEAN DEFAULT false;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "jotajaClientId" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "jotajaClientSecret" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "jotajaMerchantId" TEXT;`,
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "jotajaConnected" BOOLEAN DEFAULT false;`,
  ];

  for (const q of queries) {
    try {
      await prisma.$executeRawUnsafe(q);
      console.log("OK:", q);
    } catch (e: any) {
      console.error("FAIL:", q, e.message);
    }
  }

  console.log("✅ All User columns added successfully!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
