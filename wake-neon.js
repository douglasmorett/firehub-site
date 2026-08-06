const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');
const p = new PrismaClient();

async function wakeAndPush() {
  for (let i = 1; i <= 8; i++) {
    try {
      console.log(`Tentativa ${i} de acordar...`);
      await p.$queryRawUnsafe('SELECT 1 as ok');
      console.log('DB ACORDOU! Rodando prisma db push IMEDIATAMENTE...');
      await p.$disconnect();
      // Roda IMEDIATO enquanto o Neon ta vivo
      execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit', cwd: process.cwd() });
      console.log('SUCESSO! Schema sincronizado.');
      return;
    } catch (e) {
      console.log(`Falhou: ${e.message?.slice(0, 60)}`);
      if (i < 8) {
        const wait = Math.min(i * 2, 10);
        console.log(`Aguardando ${wait}s...`);
        await new Promise(r => setTimeout(r, wait * 1000));
      }
    }
  }
  console.log('FALHOU apos 8 tentativas');
  process.exit(1);
}

wakeAndPush();
