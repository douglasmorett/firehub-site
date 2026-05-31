// Parse the HTML to extract product names and prices
const fs = require('fs');

const html = fs.readFileSync(process.argv[2], 'utf-8');

// Find all product cards - each has h3 with name and span with price
const productRegex = /<h3 class="font-bold"[^>]*>([^<]+)<\/h3>/g;
const priceRegex = /class="font-extrabold gradient-text"[^>]*>R\$ (?:<!-- -->)?(\d+\.\d+)<\/span>/g;

const names = [];
const prices = [];

let match;
while ((match = productRegex.exec(html)) !== null) {
  names.push(match[1].trim());
}
while ((match = priceRegex.exec(html)) !== null) {
  prices.push(parseFloat(match[1]));
}

console.log('=== CATÁLOGO ICEBOX DISTRIBUIDORA ===\n');
for (let i = 0; i < names.length; i++) {
  console.log(`${i+1}. ${names[i]} — R$ ${prices[i]?.toFixed(2) || '???'}`);
}
console.log(`\nTotal de produtos: ${names.length}`);
