const { neon } = require('@neondatabase/serverless');
const sql = neon("postgresql://neondb_owner:npg_6q8vJnVD3IHvP2FA4OpfFg@ep-soft-water-amzwjl9k-pooler.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require");

async function run() {
  const users = await sql`SELECT id, "chatbotConfig" FROM "User" WHERE email = 'contatohakim@gmail.com' LIMIT 1`;
  if (users.length > 0) {
    const config = (typeof users[0].chatbotConfig === 'string' ? JSON.parse(users[0].chatbotConfig) : users[0].chatbotConfig) || {};
    const history = Array.isArray(config.campaignHistory) ? config.campaignHistory : [];
    console.log("Campaign History count:", history.length);
    if (history.length > 0) {
      console.log("Latest Campaign [0]:", JSON.stringify(history[0], null, 2));
    }
  }
}

run().catch(console.error);
