/**
 * Impressora do caixa com impressora compartilhada na rede (Speed Burguer, 16/11/2026).
 * O Windows lista "\\trailer\DARUMA BOBINA"; a loja cadastrou "DARUMA BOBINA".
 *
 *   npx tsx scripts/teste-impressora-do-caixa.ts
 */
import { impressoraDoCaixa, nomeNestePc } from "../src/lib/impressao-da-conta";

let ok = 0, falhou = 0;
function confere(nome: string, obtido: unknown, esperado: unknown) {
  if (obtido === esperado) { ok++; console.log("  ok  ", nome); }
  else { falhou++; console.log("  FALHA", nome, "→ obtido", obtido, "esperado", esperado); }
}

const cadastradas = [
  { name: "DARUMA BOBINA", label: "balcao", categories: [], copies: 2 },
  { name: "CAIXA2", label: "delivery", categories: [], copies: 1 },
  { name: "TRAILER", label: "bebidas", categories: [], somenteBebidas: true, copies: 1 },
  { name: "COZINHA", label: "cozinha", categories: [], copies: 1 },
];
const noPc = ["AnyDesk Printer", "CAIXA2", "COZINHA", "Microsoft Print to PDF", "TRAILER", "CAIXA", "\\\\trailer\\DARUMA BOBINA"];

confere("compartilhada na rede conta como presente (1ª da lista)", impressoraDoCaixa(cadastradas as any, noPc)?.name, "DARUMA BOBINA");
confere(
  "marcada para a conta, compartilhada na rede",
  impressoraDoCaixa(cadastradas.map((p) => ({ ...p, contaDaMesa: p.name === "DARUMA BOBINA" })) as any, noPc)?.name,
  "DARUMA BOBINA",
);
confere(
  "ausente de verdade continua fora",
  impressoraDoCaixa(cadastradas as any, ["CAIXA2", "COZINHA"])?.name,
  "CAIXA2",
);
confere("nome igual sem rede segue igual", impressoraDoCaixa(cadastradas as any, ["DARUMA BOBINA", "COZINHA"])?.name, "DARUMA BOBINA");

// O nome que cada PC dá à mesma impressora (16/11/2026, segundo caso da Speed Burguer):
// cadastro "\\trailer\DARUMA BOBINA"; no PC do trailer ela é "DARUMA BOBINA".
const pcDoTrailer = ["AnyDesk Printer", "COZINHA", "DARUMA BOBINA", "ELGIN i9(USB)", "TRAILER"];
const pcDoCaixa = ["CAIXA2", "COZINHA", "TRAILER", "\\\\trailer\\DARUMA BOBINA"];
confere("cadastro de rede → nome local no PC do trailer", nomeNestePc("\\\\trailer\\DARUMA BOBINA", pcDoTrailer), "DARUMA BOBINA");
confere("cadastro local → nome de rede no PC do caixa", nomeNestePc("DARUMA BOBINA", pcDoCaixa), "\\\\trailer\\DARUMA BOBINA");
confere("nome igual nos dois fica igual", nomeNestePc("COZINHA", pcDoTrailer), "COZINHA");
confere("sem equivalente no PC fica o cadastrado", nomeNestePc("CAIXA2", pcDoTrailer), "CAIXA2");
confere("sem lista do PC fica o cadastrado", nomeNestePc("\\\\trailer\\DARUMA BOBINA", []), "\\\\trailer\\DARUMA BOBINA");

console.log(`\n${ok} ok, ${falhou} falharam`);
if (falhou) process.exit(1);
