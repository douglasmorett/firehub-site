const fs = require('fs');
const path = 'src/app/api/customer-order/poll/route.ts';
let code = fs.readFileSync(path, 'utf8');

// Add withRetry helper at the top
const withRetryFunc = `
async function withRetry(operation, retries = 3, delay = 500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await operation();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
`;
if (!code.includes('withRetry')) {
  code = code.replace('export const revalidate = 0;', 'export const revalidate = 0;\n' + withRetryFunc);
}

// Wrap prisma calls
code = code.replace(
  'const orders = await prisma.customerOrder.findMany({',
  'const orders = await withRetry(() => prisma.customerOrder.findMany({'
).replace(
  '    take: 200\n  });',
  '    take: 200\n  }));'
);

code = code.replace(
  'const activeSession = await prisma.cashSession.findFirst({',
  'const activeSession = await withRetry(() => prisma.cashSession.findFirst({'
).replace(
  '    select: { openedAt: true }\n  });',
  '    select: { openedAt: true }\n  }));'
);

code = code.replace(
  'const allRecentOrders = await prisma.customerOrder.findMany({',
  'const allRecentOrders = await withRetry(() => prisma.customerOrder.findMany({'
).replace(
  '    orderBy: { createdAt: "asc" },\n  });',
  '    orderBy: { createdAt: "asc" },\n  }));'
);

fs.writeFileSync(path, code);
