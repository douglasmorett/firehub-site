require('dotenv').config({ path: '.env.local' });
const { getEvolutionQRCode } = require('./src/lib/whatsapp-evolution');

async function main() {
  console.log("EVOLUTION_API_URL:", process.env.EVOLUTION_API_URL);
  console.log("EVOLUTION_API_KEY:", process.env.EVOLUTION_API_KEY);

  try {
    const res = await getEvolutionQRCode("user_test_123");
    console.log("Resultado de getEvolutionQRCode:", res);
  } catch (err) {
    console.error("Erro:", err);
  }
}

main();
