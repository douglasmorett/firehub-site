/**
 * Trava o QR Code da mesa (lib/mesa-qr.ts): o código de uma mesa não serve em
 * outra mesa nem em outra loja, e o geral só vale na loja dele.
 *
 *   npx tsx scripts/teste-mesa-qr.ts
 */
process.env.MESA_QR_SECRET = process.env.MESA_QR_SECRET || "segredo-de-teste";
import { codigoDaMesa, codigoGeral, lerCodigo, valeParaALoja, valeParaAMesa, caminhoDoQr } from "../src/lib/mesa-qr";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — veio ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`}`);
};

const LOJA_A = "cmlojaaaaaaaaaaaaaaaaaaaa";
const LOJA_B = "cmlojabbbbbbbbbbbbbbbbbbb";
const MESA_1 = "cmmesa1111111111111111111";
const MESA_2 = "cmmesa2222222222222222222";

const c1 = codigoDaMesa(LOJA_A, MESA_1);
const l1 = lerCodigo(c1)!;
confere("o código da mesa lê de volta a mesa", l1.tipo === "mesa" && l1.tableId, MESA_1);
confere("vale na loja dona da mesa", valeParaAMesa(l1, LOJA_A), true);
confere("NÃO vale se a mesa for de outra loja", valeParaAMesa(l1, LOJA_B), false);
const trocado = lerCodigo(`${MESA_2}.${c1.split(".")[1]}`)!;
confere("trocar o id da mesa no link mantendo a assinatura NÃO vale", valeParaAMesa(trocado, LOJA_A), false);
const g = lerCodigo(codigoGeral(LOJA_A))!;
confere("o geral vale na loja dele", valeParaALoja(g, LOJA_A), true);
confere("o geral NÃO vale em outra loja", valeParaALoja(g, LOJA_B), false);
confere("o geral não passa por QR de mesa", valeParaAMesa(g, LOJA_A), false);
confere("o de mesa não passa por geral", valeParaALoja(l1, LOJA_A), false);
confere("lixo no link não é código", [lerCodigo("abc"), lerCodigo(""), lerCodigo("a.b"), lerCodigo("../x.yyyyyyyyy")], [null, null, null, null]);
confere("assinatura adulterada não vale", valeParaAMesa(lerCodigo(c1.slice(0, -1) + (c1.endsWith("A") ? "B" : "A"))!, LOJA_A), false);
confere("o link é curto (QR legível)", caminhoDoQr("pizzaria-do-digao", c1).length < 80, true);
process.env.MESA_QR_SECRET = "outro-segredo";
confere("trocar o segredo invalida o QR impresso", valeParaAMesa(l1, LOJA_A), false);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
