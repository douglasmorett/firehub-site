/**
 * Quem pode trocar de loja sem senha (lib/loja-ativa.ts, podeTrocarParaLoja),
 * a regra que lib/auth.ts usa no `trocarLoja`.
 *
 *   npx tsx scripts/teste-loja-ativa.ts
 *
 * O caso real: China Pow (principal) e Yakisoba do San (filial), 02/10/2026.
 */
import { podeTrocarParaLoja } from "../src/lib/loja-ativa";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = obtido === esperado;
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${obtido}, esperava ${esperado}`}`);
};

const china = { id: "cmuo5odcl006opd011q3e7yqy", role: "FRANCHISEE", ownerId: null, accountGroupId: null };
const yakisoba = { id: "cmuplf7nh002kmv01pbjpah72", role: "FRANCHISEE", ownerId: null, accountGroupId: china.id };
const terceira = { id: "loja3", role: "FRANCHISEE", ownerId: null, accountGroupId: china.id };
const outraLoja = { id: "outra", role: "FRANCHISEE", ownerId: null, accountGroupId: null };
const filialDeOutra = { id: "filial-outra", role: "FRANCHISEE", ownerId: null, accountGroupId: "outra" };
const funcionarioDaChina = { id: "staff1", role: "STAFF", ownerId: china.id, accountGroupId: null };
const admin = { id: "adm", role: "ADMIN", ownerId: null, accountGroupId: null };

console.log("\n— O grupo da China Pow —");
confere("principal → filial", podeTrocarParaLoja(china, yakisoba), true);
confere("filial → principal (voltar)", podeTrocarParaLoja(yakisoba, china), true);
confere("filial → outra filial do mesmo grupo", podeTrocarParaLoja(yakisoba, terceira), true);
confere("loja → ela mesma", podeTrocarParaLoja(china, china), true);

console.log("\n— O que tem que ser recusado —");
confere("loja de fora do grupo", podeTrocarParaLoja(china, outraLoja), false);
confere("filial de outro grupo", podeTrocarParaLoja(yakisoba, filialDeOutra), false);
confere("outra loja tentando entrar na China Pow", podeTrocarParaLoja(outraLoja, china), false);
confere("funcionário não troca (viraria dono)", podeTrocarParaLoja(funcionarioDaChina, yakisoba), false);
confere("destino que é funcionário", podeTrocarParaLoja(china, { ...funcionarioDaChina, accountGroupId: china.id }), false);
confere("destino ADMIN", podeTrocarParaLoja(china, { ...admin, accountGroupId: china.id }), false);
confere("sem sessão", podeTrocarParaLoja(null, yakisoba), false);
confere("destino inexistente", podeTrocarParaLoja(china, null), false);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
