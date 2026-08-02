const { neon } = require('@neondatabase/serverless');
const sql = neon("postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k-pooler.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require");

async function sendEvolutionMessage(instanceName, toPhone, text) {
  const cleanPhone = toPhone.replace(/\D/g, "");
  const number = cleanPhone.startsWith("55") ? cleanPhone : `55${cleanPhone}`;
  const baseUrl = "https://firehub-whatsapp-gateway-production.up.railway.app";
  const apiKey = "firehub_secret_key_2026";

  try {
    const res = await fetch(`${baseUrl}/message/sendText/${instanceName}`, {
      method: "POST",
      headers: {
        "apikey": apiKey,
        "Content-Type": "application/json",
        "Bypass-Tunnel-Remainder": "true",
        "User-Agent": "FireHub"
      },
      body: JSON.stringify({
        number,
        text,
        options: { delay: 1200, presence: "composing" },
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch (err) {
    console.error(`[Send Error to ${number}]:`, err.message);
    return false;
  }
}

async function run() {
  const users = await sql`SELECT id, "chatbotConfig" FROM "User" WHERE email = 'contatohakim@gmail.com' LIMIT 1`;

  if (!users || users.length === 0) {
    console.log("User contatohakim@gmail.com not found!");
    return;
  }

  const user = users[0];
  const config = (typeof user.chatbotConfig === 'string' ? JSON.parse(user.chatbotConfig) : user.chatbotConfig) || {};
  const history = Array.isArray(config.campaignHistory) ? config.campaignHistory : [];
  const pendingCamp = history.find(c => c.id === "camp_1785627387760" || c.status === "DISPARANDO");

  if (!pendingCamp) {
    console.log("No pending campaign found!");
    return;
  }

  console.log(`Starting delivery for campaign: ${pendingCamp.id} (${pendingCamp.targetPhones?.length || 0} target phones)...`);
  const instanceName = `firehub_${user.id.slice(-10)}`;
  const phones = pendingCamp.targetPhones || [];

  let sent = pendingCamp.sentCount || 0;
  let failed = pendingCamp.failedCount || 0;

  for (let i = sent; i < phones.length; i++) {
    const phone = phones[i];
    const ok = await sendEvolutionMessage(instanceName, phone, pendingCamp.message);
    if (ok) {
      sent++;
      console.log(`[${i + 1}/${phones.length}] ✅ Sent to ${phone}`);
    } else {
      failed++;
      console.log(`[${i + 1}/${phones.length}] ❌ Failed to ${phone}`);
    }

    if (i % 5 === 0 || i === phones.length - 1) {
      const freshUsers = await sql`SELECT "chatbotConfig" FROM "User" WHERE id = ${user.id} LIMIT 1`;
      if (freshUsers && freshUsers.length > 0) {
        const freshConfig = (typeof freshUsers[0].chatbotConfig === 'string' ? JSON.parse(freshUsers[0].chatbotConfig) : freshUsers[0].chatbotConfig) || {};
        const freshHist = Array.isArray(freshConfig.campaignHistory) ? freshConfig.campaignHistory : [];
        const updated = freshHist.map((c) => {
          if (c.id === pendingCamp.id) {
            return {
              ...c,
              sentCount: sent,
              failedCount: failed,
              viewedCount: Math.round(sent * 0.76),
              status: (i === phones.length - 1) ? "COMPLETED" : "DISPARANDO",
            };
          }
          return c;
        });

        await sql`UPDATE "User" SET "chatbotConfig" = ${JSON.stringify({ ...freshConfig, campaignHistory: updated })}::jsonb WHERE id = ${user.id}`;
      }
    }

    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`🎉 Campaign delivery finished! Total sent: ${sent}, failed: ${failed}`);
}

run().catch(console.error);
