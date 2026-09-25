/**
 * A cotação assinada (src/lib/cotacao-de-entrega.ts).
 *
 *   npx tsx scripts/teste-cotacao-de-entrega.ts
 */
process.env.COTACAO_SECRET = "segredo-de-teste";
import { assinarCotacao, chaveDoEndereco, lerCotacao, VALIDADE_DA_COTACAO_MS } from "../src/lib/cotacao-de-entrega";

let ok = 0, falhas = 0;
function confere(nome: string, cond: boolean) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}`); }
}

const agora = 1_800_000_000_000;
const chave = chaveDoEndereco({ street: "Travessa Canaã", number: "6", neighborhood: "Boca do Mato" });
const base = {
  loja: "loja1", chave, lat: -22.85, lng: -42.03, origemDoPonto: "mapa" as const,
  distanciaKm: 0.84, medida: "rota" as const, faixaKm: 1, taxa: 5, taxaDoEntregador: 4, tempoMin: 30,
};
const token = assinarCotacao(base, agora);

const lida = lerCotacao(token, { loja: "loja1", chave }, agora + 60_000);
confere("token autêntico é lido", !!lida && lida.taxa === 5 && lida.distanciaKm === 0.84 && lida.taxaDoEntregador === 4);
confere("outra loja não usa", lerCotacao(token, { loja: "loja2", chave }, agora) === null);
confere("outro endereço não usa", lerCotacao(token, { loja: "loja1", chave: chaveDoEndereco({ street: "Rua X", number: "6", neighborhood: "Boca do Mato" }) }, agora) === null);
confere("vencida não usa", lerCotacao(token, { loja: "loja1", chave }, agora + VALIDADE_DA_COTACAO_MS + 1) === null);

// Forjar: trocar a taxa no corpo sem reassinar
const [corpo, ass] = token.split(".");
const mexido = JSON.parse(Buffer.from(corpo, "base64url").toString());
mexido.taxa = 0;
const forjado = Buffer.from(JSON.stringify(mexido)).toString("base64url") + "." + ass;
confere("taxa trocada no token é recusada", lerCotacao(forjado, { loja: "loja1", chave }, agora) === null);
confere("lixo é recusado", lerCotacao("abc.def", { loja: "loja1", chave }, agora) === null && lerCotacao(undefined, { loja: "loja1", chave }, agora) === null);

// Chave do endereço
confere("acento, caixa e espaços não mudam a chave",
  chaveDoEndereco({ street: "travessa  canaa", number: "6", neighborhood: "BOCA DO MATO" }) === chave);
confere("número diferente muda a chave", chaveDoEndereco({ street: "Travessa Canaã", number: "7", neighborhood: "Boca do Mato" }) !== chave);
confere("texto livre vale quando não há partes",
  chaveDoEndereco({ address: "Rua A, 10" }) === chaveDoEndereco({ address: "rua a 10" }));
confere("pino arrastado 1 m não muda a chave",
  chaveDoEndereco({ street: "R", number: "1", lat: -22.854031, lng: -42.029652 }) === chaveDoEndereco({ street: "R", number: "1", lat: -22.854034, lng: -42.029654 }));
confere("pino em outro lugar muda a chave",
  chaveDoEndereco({ street: "R", number: "1", lat: -22.854, lng: -42.0296 }) !== chaveDoEndereco({ street: "R", number: "1", lat: -22.86, lng: -42.0296 }));

console.log(`\n${ok} ok, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
