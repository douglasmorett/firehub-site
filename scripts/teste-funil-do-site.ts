/**
 * O funil do site (lib/funil-do-site-regras.ts): de onde veio, as etapas
 * cumulativas, as porcentagens e onde mais perde gente.
 *
 *   npx tsx scripts/teste-funil-do-site.ts
 */
import {
  conversao, degrausDoFunil, dicaDoOnline, dispositivoDaVisita, ehRobo, etapasAte, maiorPerda, origemDaVisita, textoDoOnline,
} from "../src/lib/funil-do-site-regras";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

console.log("\n— De onde veio —");
confere("utm do link manda", origemDaVisita({ utm: "instagram", referrer: "https://www.google.com/" }), "instagram");
confere("referrer do Instagram", origemDaVisita({ referrer: "https://l.instagram.com/?u=..." }), "instagram");
confere("Google", origemDaVisita({ referrer: "https://www.google.com.br/" }), "google");
confere("WhatsApp pelo utm", origemDaVisita({ utm: "whatsapp" }), "whatsapp");
confere("Facebook (l.facebook)", origemDaVisita({ referrer: "https://l.facebook.com/" }), "facebook");
confere("sem pista = direto/QR", origemDaVisita({}), "direto");
confere("do próprio site = direto", origemDaVisita({ referrer: "https://firehubfood.com.br/loja/x", host: "firehubfood.com.br" }), "direto");
confere("outro site", origemDaVisita({ referrer: "https://guialocal.com.br/" }), "outro");
confere("celular", dispositivoDaVisita("Mozilla/5.0 (Linux; Android 14) Mobile Safari"), "celular");
confere("computador", dispositivoDaVisita("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "computador");
confere("robô do Google não conta", ehRobo("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
confere("prévia do WhatsApp não conta", ehRobo("WhatsApp/2.23"), true);
confere("pessoa conta", ehRobo("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile"), false);

console.log("\n— Etapas cumulativas —");
confere("carrinho marca produto e visita", etapasAte("carrinho"), ["visita", "produto", "carrinho"]);
confere("pedido marca tudo", etapasAte("pedido"), ["visita", "produto", "carrinho", "checkout", "pedido"]);

console.log("\n— O funil —");
const c = { visita: 200, produto: 120, carrinho: 60, checkout: 30, pedido: 24 };
const d = degrausDoFunil(c);
confere("pessoas por degrau", d.map((x) => x.pessoas), [200, 120, 60, 30, 24]);
confere("% do total", d.map((x) => x.doTotal), [100, 60, 30, 15, 12]);
confere("% da etapa anterior", d.map((x) => x.daAnterior), [100, 60, 50, 50, 80]);
confere("perdidos em cada passo", d.map((x) => x.perdidos), [0, 80, 60, 30, 6]);
confere("conversão = pedidos ÷ visitas", conversao(c), 12);
confere("maior perda: produto → carrinho e checkout empatam em 50%: fica a primeira", maiorPerda(d)?.etapa, "carrinho");
confere("degrau nunca passa do anterior (dado torto)", degrausDoFunil({ visita: 10, produto: 12, carrinho: 3, checkout: 3, pedido: 1 }).map((x) => x.pessoas), [10, 10, 3, 3, 1]);
confere("sem visitas: tudo zero, sem dividir por zero", degrausDoFunil({ visita: 0, produto: 0, carrinho: 0, checkout: 0, pedido: 0 }).map((x) => x.doTotal), [0, 0, 0, 0, 0]);
confere("pouca gente não vira diagnóstico", maiorPerda(degrausDoFunil({ visita: 2, produto: 1, carrinho: 0, checkout: 0, pedido: 0 })), null);

console.log("\n— A caixinha da tela de Pedidos —");
confere("zero = ninguém", textoDoOnline(0), "ninguém no site agora");
confere("um", textoDoOnline(1), "1 no site agora");
confere("vários", textoDoOnline(3), "3 no site agora");
confere("milhar com ponto", textoDoOnline(1200), "1.200 no site agora");
confere("lixo vira zero", textoDoOnline(NaN), "ninguém no site agora");
confere("negativo vira zero", textoDoOnline(-2), "ninguém no site agora");
confere("dica sem carrinho não fala de carrinho", dicaDoOnline({ agora: 2, comCarrinho: 0, finalizando: 0 }).includes("🛒"), false);
confere("dica com carrinho e finalizando", dicaDoOnline({ agora: 4, comCarrinho: 2, finalizando: 1 }).endsWith("🛒 2 com carrinho · 1 finalizando."), true);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
