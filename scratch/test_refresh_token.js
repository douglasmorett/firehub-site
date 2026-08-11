const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: "postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require"
    }
  }
});

async function main() {
  const user = await prisma.user.findUnique({
    where: { email: "contatohakim@gmail.com" },
    select: { id: true, ifoodRefreshToken: true, ifoodAccessToken: true, ifoodMerchantId: true }
  });

  console.log("User iFood config:", {
    merchantId: user.ifoodMerchantId,
    hasAccessToken: !!user.ifoodAccessToken,
    hasRefreshToken: !!user.ifoodRefreshToken,
    refreshToken: user.ifoodRefreshToken
  });

  if (!user.ifoodRefreshToken) {
    console.log("No refresh token stored.");
    return;
  }

  const clientId     = process.env.IFOOD_CLIENT_ID_DISTRIBUTED || "cabc4064-8d01-4bb0-bb5b-ed93963f9a7a";
  const clientSecret = process.env.IFOOD_CLIENT_SECRET_DISTRIBUTED || "2k28s9uil03gobzo6p3gkojim4ffsw9ttu3031veoxm1irbiz53vbzrd50n8wqnywrbvfsurzalevhv4ank4jrrm9wr4xhfcahv";

  const res = await fetch("https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grantType: "refresh_token",
      clientId,
      clientSecret,
      refreshToken: user.ifoodRefreshToken
    })
  });

  console.log("Refresh response status:", res.status);
  const data = await res.json();
  console.log("Refresh response data:", data);

  if (res.ok && data.accessToken) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        ifoodAccessToken: data.accessToken,
        ifoodRefreshToken: data.refreshToken || user.ifoodRefreshToken,
      }
    });
    console.log("✅ Successfully updated ifoodAccessToken in DB!");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
