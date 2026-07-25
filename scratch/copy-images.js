const fs = require('fs');
const path = require('path');

const destDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

const srcBatata = 'C:\\Users\\Micro\\.gemini\\antigravity\\brain\\277517b7-eeca-407e-8e8d-6e77ad9d79a3\\.user_uploaded\\media__1784939036982.png';
const srcNugget = 'C:\\Users\\Micro\\.gemini\\antigravity\\brain\\277517b7-eeca-407e-8e8d-6e77ad9d79a3\\.user_uploaded\\media__1784943951174.jpg';

fs.copyFileSync(srcBatata, path.join(destDir, 'batata_frita.png'));
fs.copyFileSync(srcNugget, path.join(destDir, 'nuggets_hk.jpg'));

console.log("✅ Imagens copiadas com sucesso para public/uploads/!");
