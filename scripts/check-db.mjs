import { neon } from '@neondatabase/serverless';

// Check firehub_db
const firehubUrl = 'postgresql://neondb_owner:npg_9C4DXWRhvBUo@ep-soft-water-amzwjl9k-pooler.c-5.us-east-1.aws.neon.tech/firehub_db?sslmode=require';
const sqlFirehub = neon(firehubUrl);

// Check neondb (old)
const neondbUrl = 'postgresql://neondb_owner:npg_9C4DXWRhvBUo@ep-soft-water-amzwjl9k-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require';
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
