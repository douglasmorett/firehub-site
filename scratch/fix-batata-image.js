const fs = require('fs');
const path = require('path');

const destDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

const srcBatata = 'C:\\Users\\Micro\\.gemini\\antigravity\\brain\\277517b7-eeca-407e-8e8d-6e77ad9d79a3\\.user_uploaded\\media__1784944826777.jpg';

fs.copyFileSync(srcBatata, path.join(destDir, 'batata_frita.png'));
fs.copyFileSync(srcBatata, path.join(destDir, 'batata_frita.jpg'));

console.log("✅ Imagem REAL da Batata Frita copiada para public/uploads/batata_frita.png e jpg!");
