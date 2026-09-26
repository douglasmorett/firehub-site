/**
 * scripts/teste-vitrine-do-cardapio.tsx — o topo do cardápio no molde do
 * CardápioWeb (pedido do dono, 26/09/2026), desenhado sem navegador:
 *   - a fileira de Destaques que rola para o lado (FileiraDeDestaques);
 *   - a capa da loja, com a imagem e o vídeo (CapaDaLoja).
 *
 *   npx tsx scripts/teste-vitrine-do-cardapio.tsx
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FileiraDeDestaques, { seloDoDestaque } from "../src/components/customer/FileiraDeDestaques";
import CapaDaLoja from "../src/components/customer/CapaDaLoja";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe !== undefined ? ` — ${String(detalhe).slice(0, 300)}` : ""}`); }
}

// ── O selo do cartão ─────────────────────────────────────────────────────
confere("o selo é a etiqueta que conta ('Mais Vendido'), não a que põe o item aqui",
  seloDoDestaque({ tags: JSON.stringify(["⭐ Destaque", "🔥 Mais Vendido"]) }) === "🔥 Mais Vendido");
confere("só '⭐ Destaque': sem selo", seloDoDestaque({ tags: JSON.stringify(["⭐ Destaque"]) }) === null);
confere("combo sem etiqueta: 'Combo'", seloDoDestaque({ tags: JSON.stringify(["⭐ Destaque"]), isCombo: true }) === "📦 Combo");
confere("tags quebradas não derrubam o cardápio", seloDoDestaque({ tags: "{lixo" }) === null && seloDoDestaque({ tags: null }) === null);

// ── A fileira ────────────────────────────────────────────────────────────
const produtos = [
  { id: "a", name: "X-Tudo Frango Crocante", description: "Pão brioche amanteigado, carne, queijo", imageUrl: "/uploads/produtos/x.webp", tags: JSON.stringify(["⭐ Destaque", "🔥 Mais Vendido"]) },
  { id: "b", name: "Fritas Divinos", description: "350g de batata", imageUrl: null, tags: JSON.stringify(["⭐ Destaque"]) },
];
const html = renderToStaticMarkup(
  <FileiraDeDestaques
    produtos={produtos}
    quantidade={(id) => (id === "a" ? 2 : 0)}
    abrir={() => {}}
    preco={(p) => <span className="preco-teste">R$ {p.id === "a" ? "27,00" : "25,00"}</span>}
  />,
);
confere("título 'Destaques'", html.includes(">Destaques</h2>"), html);
confere("uma fileira só (não a grade de antes)", (html.match(/class="destaques-fileira"/g) || []).length === 1 && !html.includes("grid"), html);
confere("um cartão por destaque", (html.match(/class="destaque-card/g) || []).length === 2, html);
confere("o que está na sacola aparece marcado, com a quantidade", html.includes('class="destaque-card no-carrinho"') && html.includes(">2</span>"), html);
confere("o selo sai no cartão", html.includes("🔥 Mais Vendido"), html);
confere("sem foto: um prato no lugar, sem <img> quebrada", (html.match(/<img/g) || []).length === 1 && html.includes("destaque-sem-foto"), html);
confere("o preço vem de quem chama (o mesmo PrecoDoCard da lista)", html.includes("R$ 27,00") && html.includes("R$ 25,00"), html);
confere("o cartão é acessível pelo teclado", (html.match(/role="button"/g) || []).length === 2 && html.includes('tabindex="0"'), html);
confere("sem destaques, nada aparece", renderToStaticMarkup(<FileiraDeDestaques produtos={[]} quantidade={() => 0} abrir={() => {}} preco={() => null} />) === "");

// ── A capa ───────────────────────────────────────────────────────────────
const soImagem = renderToStaticMarkup(<CapaDaLoja imagem="/uploads/lojas/capa.webp" video={null} nome="Divinos" />);
confere("capa só com imagem: a imagem, sem vídeo", soImagem.includes('src="/uploads/lojas/capa.webp"') && !soImagem.includes("<video"), soImagem);
const comVideo = renderToStaticMarkup(<CapaDaLoja imagem="/uploads/lojas/capa.webp" video="/uploads/lojas/capa.mp4" nome="Divinos" />);
confere("com vídeo: o HTML do servidor sai com a IMAGEM (primeiro paint e pôster)", comVideo.includes('src="/uploads/lojas/capa.webp"'), comVideo);
confere("…e sem o <video>, que só entra no navegador (o muted do servidor não vale para o autoplay)", !comVideo.includes("<video"), comVideo);
confere("a capa mantém a classe e o degradê de sempre", comVideo.includes('class="store-banner"') && comVideo.includes("store-banner-overlay"), comVideo);

console.log(`${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
