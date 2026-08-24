require('dotenv').config({ path: '.env' });
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql`select current_database(), now()`.then(r => console.log(r)).catch(e => console.log('ERR', e.message));
