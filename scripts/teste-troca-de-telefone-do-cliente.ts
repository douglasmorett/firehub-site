/**
 * Troca do telefone no "Editar cadastro" (lib/cadastro-do-cliente.ts,
 * lerTrocaDeTelefone). Só a parte pura — não toca no banco.
 *
 *   DATABASE_URL=postgresql://127.0.0.1:1/nada npx tsx scripts/teste-troca-de-telefone-do-cliente.ts
 *
 * Pedido do Flavio (01/11/2026): o cliente digitou o número errado e a loja
 * precisa corrigir.
 */
import { lerTrocaDeTelefone } from "../src/lib/cadastro-do-cliente";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};
const erro = { ok: false, erro: "Telefone inválido — use DDD + número." };

confere("sem campo = não troca", lerTrocaDeTelefone("22992761161", undefined), { ok: true, novo: null, mesmaPessoa: true });
confere("vazio = não troca", lerTrocaDeTelefone("22992761161", "  "), { ok: true, novo: null, mesmaPessoa: true });
confere("mesmo número com máscara = não troca", lerTrocaDeTelefone("22992761161", "(22) 99276-1161"), { ok: true, novo: null, mesmaPessoa: true });
confere("mesmo número com +55 = não troca", lerTrocaDeTelefone("22992761161", "+55 22 99276-1161"), { ok: true, novo: null, mesmaPessoa: true });
confere("número diferente troca", lerTrocaDeTelefone("22992761161", "(22) 99876-5432"), { ok: true, novo: "22998765432", mesmaPessoa: false });
confere("outro DDD, mesmo final: outra pessoa", lerTrocaDeTelefone("22992761161", "21992761161"), { ok: true, novo: "21992761161", mesmaPessoa: false });
confere("pôr o 9 que faltava: mesma pessoa", lerTrocaDeTelefone("2292761161", "22992761161"), { ok: true, novo: "22992761161", mesmaPessoa: true });
confere("sem DDD recusa", lerTrocaDeTelefone("22992761161", "99276-1161"), erro);
confere("começando com 0 recusa", lerTrocaDeTelefone("22992761161", "00000000000"), erro);
confere("dígitos demais recusa", lerTrocaDeTelefone("22992761161", "229927611610"), erro);
confere("letras recusa", lerTrocaDeTelefone("22992761161", "abc"), erro);

console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
process.exit(falhas ? 1 : 0);
