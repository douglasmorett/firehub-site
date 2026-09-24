/**
 * Trava a barreira de funcionário (lib/permissao-da-tela.ts).
 *
 *   npx tsx scripts/teste-permissao-da-tela.ts
 *
 * O caso é o caixa da Frangoso (24/09/2026): o dono marcou só o que o caixa
 * usa, e ele abria o financeiro — as caixinhas não eram lidas por tela nenhuma.
 */
import { funcionarioAbre, primeiraTelaDoFuncionario } from "../src/lib/permissao-da-tela";
import { menuDaLoja } from "../src/lib/menu-do-painel";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// Exatamente o que está gravado no banco para o caixa da Frangoso.
const CAIXA = "orders,kds,venda_presencial,cardapio,motoboys,editar_pedidos,impressoras";

for (const tela of ["/store/pedidos-clientes", "/store/kds", "/store/kds/tela", "/store/venda-presencial", "/store/mesas", "/store/cardapio", "/store/motoboys", "/store/roteirizacao", "/store/impressoras", "/store/impressoras/comanda", "/store/perfil"]) {
  confere(`caixa abre ${tela}`, funcionarioAbre(tela, CAIXA), true);
}
for (const tela of ["/store", "/store/financeiro", "/store/relatorios", "/store/fiscal", "/store/estoque", "/store/minha-loja", "/store/minha-loja#equipe", "/store/integracoes", "/store/chatbot", "/store/marketing", "/store/funcionarios", "/store/admin/lojistas", "/store/tela-que-ainda-nao-existe"]) {
  confere(`caixa NÃO abre ${tela}`, funcionarioAbre(tela, CAIXA), false);
}
confere("prefixo não engana: /store/ifood-status não é /store/ifood", funcionarioAbre("/store/ifood-status", "ifood"), true);
confere("/store/kdsx não é /store/kds", funcionarioAbre("/store/kdsx", "kds"), false);
confere("barra no fim não muda nada", funcionarioAbre("/store/financeiro/", CAIXA), false);

confere("caixa barrado vai para os pedidos", primeiraTelaDoFuncionario(CAIXA), "/store/pedidos-clientes");
confere("só cozinha vai para o KDS", primeiraTelaDoFuncionario("kds"), "/store/kds");
confere("sem nenhuma caixinha, a conta dele", primeiraTelaDoFuncionario(""), "/store/perfil");
confere("relatórios abre com a caixinha antiga 'relatorios'", funcionarioAbre("/store/relatorios", "relatorios"), true);

const menuDoCaixa = menuDaLoja({ permissoesDoFuncionario: CAIXA }).flatMap((g) => g.itens.map((i) => i.href));
confere("menu do caixa", menuDoCaixa, ["/store/pedidos-clientes", "/store/kds", "/store/mesas", "/store/venda-presencial", "/store/roteirizacao", "/store/cardapio", "/store/motoboys", "/store/impressoras"]);
const menuDoDono = menuDaLoja({ permissoesDoFuncionario: null }).flatMap((g) => g.itens.map((i) => i.href));
confere("dono vê o menu inteiro", menuDoDono.includes("/store/financeiro") && menuDoDono.includes("/store/minha-loja"), true);

console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
