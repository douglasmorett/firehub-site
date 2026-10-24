/**
 * scripts/teste-kds-link-curto.ts — o link curto das telas do KDS
 * (lib/kds-link-curto.ts), com as telas da Hakim Centro.
 *
 *   npx tsx scripts/teste-kds-link-curto.ts
 */
import { acharTela, chaveDaTela, urlDaTela } from "../src/lib/kds-link-curto";

let falhas = 0;
const conferir = (nome: string, ok: boolean, detalhe?: unknown) => {
  if (ok) console.log(`  ok  ${nome}`);
  else { falhas++; console.log(`  FALHOU  ${nome}`, detalhe ?? ""); }
};

const telas = [
  { id: "abf08fd5", name: "Pizza", stage: "production", filter: "all" },
  { id: "f1", name: "Finalização 1", stage: "finishing", filter: "all" },
  { id: "f8681f3b", name: "Esfirra", stage: "production", filter: "all" },
  { id: "f2", name: "Finalização 2", stage: "finishing", filter: "all" },
];

conferir("chave sem acento e com hífen", chaveDaTela("Finalização 2") === "finalizacao-2", chaveDaTela("Finalização 2"));
conferir("/kds/esfirra", acharTela(telas, "esfirra")?.id === "f8681f3b");
conferir("/kds/Esfirra (maiúscula)", acharTela(telas, "Esfirra")?.id === "f8681f3b");
conferir("/kds/finalizacao-2", acharTela(telas, "finalizacao-2")?.id === "f2");
conferir("/kds/finalizacao2 (sem hífen)", acharTela(telas, "finalizacao2")?.id === "f2");
conferir("/kds/Finaliza%C3%A7%C3%A3o%202 (como o navegador manda)", acharTela(telas, "Finaliza%C3%A7%C3%A3o%202")?.id === "f2");
conferir("/kds/3 = a 3ª tela (Esfirra)", acharTela(telas, "3")?.id === "f8681f3b");
conferir("/kds/9 não existe", acharTela(telas, "9") === null);
conferir("/kds/bar não existe", acharTela(telas, "bar") === null);
conferir("o endereço leva o id da tela", urlDaTela(telas[2]) === "/store/kds/tela?stage=production&filter=all&name=Esfirra&tela=f8681f3b", urlDaTela(telas[2]));

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
