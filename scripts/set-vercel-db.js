const { execSync } = require('child_process');
const { writeFileSync, unlinkSync } = require('fs');
const { join } = require('path');

const DB_URL = process.env.DATABASE_URL;

// Write value to temp file (no trailing newline)
const tmpFile = join(__dirname, '_db_url_tmp.txt');
writeFileSync(tmpFile, DB_URL, 'utf8');

try {
  // Use file input to avoid PowerShell pipe issues
  console.log('Adding DATABASE_URL to production...');
  execSync(`cmd /c "type ${tmpFile} | npx vercel env add DATABASE_URL production"`, {
    stdio: 'inherit',
    cwd: join(__dirname, '..')
  });
  console.log('✅ Done!');
} catch (e) {
  console.error('Error:', e.message);
} finally {
  try { unlinkSync(tmpFile); } catch {}
}
