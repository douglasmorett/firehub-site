import { neon } from '@neondatabase/serverless';

const firehubUrl = process.env.DATABASE_URL;
const sqlFirehub = neon(firehubUrl);

// Check neondb (old)
const neondbUrl = process.env.NEON_DATABASE_URL;
const sqlNeondb = neon(neondbUrl);

console.log('=== Verificando firehub_db ===');
try {
  const cols = await sqlFirehub`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'CustomerOrder' 
    ORDER BY ordinal_position`;
  console.log('Colunas de CustomerOrder em firehub_db:');
  cols.forEach(c => console.log('  -', c.column_name));
} catch (e) {
  console.log('❌ Erro firehub_db:', e.message);
}

console.log('\n=== Verificando neondb (antigo) ===');
try {
  const cols = await sqlNeondb`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'CustomerOrder' 
    ORDER BY ordinal_position`;
  console.log('Colunas de CustomerOrder em neondb:');
  cols.forEach(c => console.log('  -', c.column_name));
} catch (e) {
  console.log('❌ Erro neondb:', e.message);
}
