const fs = require('fs');
['.env.local', '.env.clean', '.env.prod.real', '.env.production.local'].forEach(f => {
  if (fs.existsSync(f)) {
    const c = fs.readFileSync(f, 'utf8');
    const lines = c.split('\n');
    for (const l of lines) {
      if (l.startsWith('DATABASE_URL=')) {
        const val = l.replace('DATABASE_URL=', '').replace(/"/g, '').trim();
        console.log(f, 'length:', val.length, 'starts with:', val.substring(0, 20));
      }
    }
  }
});
