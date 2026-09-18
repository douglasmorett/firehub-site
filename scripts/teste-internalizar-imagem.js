/**
 * Reproduz, fora do servidor, o caminho que /api/admin/internalizar-imagens
 * percorre para UMA imagem: baixa a URL, monta o File e chama
 * `saveUploadedFile` — a mesma sequência, com as mesmas linhas.
 *
 * Existe porque em 18/09/2026 a conferência do banco mostrou que a
 * internalização NUNCA funcionou: 439 fotos de cinco lojas (Taurus 193 desde
 * 09/09, R&D 96, Frangoso 60, Delícias 55, Digão 35) continuavam servidas pelo
 * site de origem, e nenhuma loja tinha UMA foto sequer em /uploads vinda de
 * importação. Zero progresso — não é timeout, é falha em 100% das tentativas.
 * E falha de dentro do cron não aparece em lugar nenhum: a rota engole a
 * exceção por imagem e segue.
 *
 *   node scripts/teste-internalizar-imagem.js [url]
 */
const path = require("path");
const createJiti = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "..", "src") },
  interopDefault: true,
  esmResolve: true,
});

// Grava num diretório de teste, nunca no volume de produção.
process.env.UPLOADS_DIR = path.resolve(__dirname, "..", "scratch", "uploads-teste");

const { saveUploadedFile } = jiti(path.resolve(__dirname, "..", "src", "lib", "storage.ts"));

const URLS = process.argv[2]
  ? [process.argv[2]]
  : [
      // InstaDelivery (Pizzaria do Digão) — produto e opção
      "https://instadelivery-public.nyc3.cdn.digitaloceanspaces.com/itens/17896187316aab6a2ba93fa.jpeg",
      "https://instadelivery-public.nyc3.cdn.digitaloceanspaces.com/complements/177248782769a60493b47f9.jpeg",
      // Menu Integrado (R&D) — 96 fotos paradas desde 17/09
      "https://assets.menuintegrado.com/rails/active_storage/representations/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBCSUlXQUFBPSIsImV4cCI6bnVsbCwicHVyIjoiYmxvYl9pZCJ9fQ==/x.jpg",
    ];

(async () => {
  for (const url of URLS) {
    console.log("\n=== " + url.slice(0, 95) + " ===");
    try {
      const res = await fetch(url);
      console.log("  HTTP:", res.status);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bruto = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get("content-type")?.split(";")[0] || "image/webp";
      console.log("  content-type:", JSON.stringify(mime), "| bytes:", bruto.length);

      // As duas linhas exatas da rota.
      const arquivo = new File([bruto], `teste_${Date.now()}.webp`, { type: mime });
      console.log("  File:", { name: arquivo.name, type: arquivo.type, size: arquivo.size });

      const salvo = await saveUploadedFile(arquivo, "produtos");
      console.log("  ✅ SALVOU:", salvo.url, `(${salvo.size} bytes)`);
    } catch (e) {
      console.log("  ❌ FALHOU:", e && e.message ? e.message : String(e));
      if (e && e.stack) console.log("     " + e.stack.split("\n").slice(1, 4).join("\n     "));
    }
  }
})();
