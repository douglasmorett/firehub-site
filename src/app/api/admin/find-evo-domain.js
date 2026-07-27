const fs = require('fs');
const path = require('path');

const dirs = [
  'C:\\Users\\Micro\\Documents\\firecheck',
  'C:\\Users\\Micro\\Documents\\evo pdv',
  'C:\\Users\\Micro\\Documents\\hakim-portal',
  'C:\\Users\\Micro\\Documents\\Projeto Bill'
];

function findUrls(dir, depth = 0) {
  if (depth > 4) return;
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      if (f.startsWith('.') && !f.includes('env')) continue;
      if (f === 'node_modules' || f === 'dist' || f === '.next') continue;
      const full = path.join(dir, f);
      try {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          findUrls(full, depth + 1);
        } else if (f.endsWith('.js') || f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.json') || f.endsWith('.txt') || f.endsWith('.md') || f.endsWith('.ps1')) {
          try {
            const txt = fs.readFileSync(full, 'utf8');
            const matches = txt.match(/https?:\/\/[^\s"'`<>]+/gi);
            if (matches) {
              const evoMatches = matches.filter(u => /evo|whatsapp|bot|manager|instance|connect|firecheck|hakim/i.test(u));
              if (evoMatches.length > 0) {
                console.log(`\n=== File: ${full} ===`);
                [...new Set(evoMatches)].forEach(u => console.log("  " + u));
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }
  } catch (e) {}
}

dirs.forEach(d => findUrls(d));
