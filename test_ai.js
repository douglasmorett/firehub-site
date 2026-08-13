const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } }
});

const { processChatbotAI } = require('./src/lib/chatbot-ai.ts'); // Wait, ts-node needed

