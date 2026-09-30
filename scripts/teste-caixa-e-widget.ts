/**
 * Trava três correções de TELA achadas no teste de ponta a ponta (30/09/2026):
 *
 *  2. o "Abrir o caixa →" do Balcão e das Mesas apontava para /store/caixa, que
 *     não existe (404). Agora pede o modal da barra do topo por evento, com um
 *     caminho que existe quando a barra não está na página;
 *  3. depois de abrir o caixa pelo modal do topo, o Balcão mostrava "caixa
 *     fechado" por até 30 s. A barra avisa (firehub:caixa-mudou) e o Balcão e as
 *     Mesas reperguntam na hora;
 *  4. o widget flutuante de contato era uma caixa invisível de ~300×220 px que
 *     engolia o clique do que estivesse embaixo (o "Cancelar" da nota fiscal).
 *
 *   npx tsx scripts/teste-caixa-e-widget.ts
 *
 * Puro: o `window` é um EventTarget de mentira; o resto é leitura do código.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  avisarQueOCaixaMudou,
  caminhoParaAbrirOCaixa,
  EVENTO_ABRIR_MENU_DO_CAIXA,
  EVENTO_CAIXA_MUDOU,
  PARAMETRO_ABRIR_CAIXA,
  pedirAberturaDoCaixa,
  type PedidoDoCaixa,
} from "../src/lib/caixa-aberto";
import { funcionarioAbre } from "../src/lib/permissao-da-tela";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const verdade = (oQue: string, cond: boolean, detalhe = "") => {
  if (!cond) falhas++;
  console.log(`${cond ? "✅" : "❌"} ${oQue}${cond ? "" : ` — ${detalhe}`}`);
};
const ler = (arquivo: string) => readFileSync(join(__dirname, "..", arquivo), "utf8");

// ── um `window` de mentira: eventos de verdade, navegação anotada ──
const navegou: string[] = [];
const abriu: Array<[string, string | undefined, string | undefined]> = [];
const janela = Object.assign(new EventTarget(), {
  location: { pathname: "/store/venda-presencial", search: "", hash: "", assign: (u: string) => navegou.push(u) },
  open: (u: string, alvo?: string, recursos?: string) => {
    abriu.push([u, alvo, recursos]);
    return null;
  },
});
(globalThis as { window?: unknown }).window = janela;

console.log("\n— 2. o atalho \"Abrir o caixa →\"");
{
  confere(
    "o caminho sem a barra: o histórico de caixas (existe), com ?abrirCaixa=1 e a volta",
    [caminhoParaAbrirOCaixa("/store/venda-presencial"), caminhoParaAbrirOCaixa("/store/mesas")],
    ["/store/caixa/historico?abrirCaixa=1&voltar=%2Fstore%2Fvenda-presencial", "/store/caixa/historico?abrirCaixa=1&voltar=%2Fstore%2Fmesas"]
  );
  confere(
    "a volta só aceita caminho do painel (não vira redirecionamento para fora)",
    [caminhoParaAbrirOCaixa("https://golpe.example/store"), caminhoParaAbrirOCaixa("//golpe.example"), caminhoParaAbrirOCaixa(null)],
    ["/store/caixa/historico?abrirCaixa=1", "/store/caixa/historico?abrirCaixa=1", "/store/caixa/historico?abrirCaixa=1"]
  );
  verdade("a página do caminho existe; /store/caixa (o link antigo) não", existsSync(join(__dirname, "../src/app/store/caixa/historico/page.tsx")) && !existsSync(join(__dirname, "../src/app/store/caixa/page.tsx")));
  confere(
    "quem só tem o Balcão (venda_presencial) abre o histórico — e não abre a Início",
    [funcionarioAbre("/store/caixa/historico", "venda_presencial"), funcionarioAbre("/store/venda-presencial", "venda_presencial"), funcionarioAbre("/store", "venda_presencial")],
    [true, true, false]
  );

  // Sem a barra na página: ninguém atende o evento, e o pedido vira navegação.
  confere("sem a barra: devolve false e navega para o histórico com o pedido", [pedirAberturaDoCaixa(), navegou], [false, ["/store/caixa/historico?abrirCaixa=1&voltar=%2Fstore%2Fvenda-presencial"]]);
  confere(
    "sem a barra, no Balcão (novaAba): abre em outra aba — o carrinho fica montado",
    [pedirAberturaDoCaixa({ novaAba: true }), abriu, navegou.length],
    [false, [["/store/caixa/historico?abrirCaixa=1&voltar=%2Fstore%2Fvenda-presencial", "_blank", "noopener"]], 1]
  );

  // Com a barra: ela atende (preventDefault) e nada navega.
  const pedidos: Array<PedidoDoCaixa | null> = [];
  const barra = (e: Event) => {
    e.preventDefault();
    pedidos.push((e as CustomEvent<PedidoDoCaixa>).detail ?? null);
  };
  janela.addEventListener(EVENTO_ABRIR_MENU_DO_CAIXA, barra);
  confere("com a barra: devolve true, pede a ABERTURA e não navega", [pedirAberturaDoCaixa({ novaAba: true }), pedidos, navegou.length, abriu.length], [true, [{ acao: "abrir" }], 1, 1]);
  janela.removeEventListener(EVENTO_ABRIR_MENU_DO_CAIXA, barra);

  const src = ["src/app/store/venda-presencial/page.tsx", "src/components/mesas/MesasApp.tsx", "src/lib/caixa-aberto.ts"].map(ler).join("\n");
  verdade("não sobrou CAMINHO_DO_CAIXA nem link para /store/caixa", !src.includes("CAMINHO_DO_CAIXA") && !/href=["{]\/?store\/caixa["}]/.test(src) && !src.includes('href="/store/caixa"'));
  const balcao = ler("src/app/store/venda-presencial/page.tsx");
  verdade("Balcão: o botão pede o modal (outra aba só no fallback)", balcao.includes("onClick={() => pedirAberturaDoCaixa({ novaAba: true })}") && /<button\s+type="button"\s+onClick=\{\(\) => pedirAberturaDoCaixa/.test(balcao));
  const mesas = ler("src/components/mesas/MesasApp.tsx");
  verdade("Mesas: o botão pede o modal; o garçom (sem barra) continua sem o botão", mesas.includes('<button type="button" onClick={() => pedirAberturaDoCaixa()}') && /\{!ehGarcom && \(\s*<button type="button" onClick=\{\(\) => pedirAberturaDoCaixa\(\)\}/.test(mesas));

  const topo = ler("src/components/customer/StoreTopNav.tsx");
  verdade("a barra ouve o pedido e avisa que atendeu (preventDefault)", topo.includes("window.addEventListener(EVENTO_ABRIR_MENU_DO_CAIXA, atender)") && /const atender = \(e: Event\) => \{[\s\S]{0,200}e\.preventDefault\(\);/.test(topo));
  verdade(
    "pedido de ABERTURA com a barra achando o caixa aberto: pergunta ao servidor antes (abrir por cima encerra o turno sem conferir)",
    /if \(!pediuAbertura\) \{[\s\S]{0,80}setShowCaixaMenu\(true\);[\s\S]{0,80}\}\s*fetch\("\/api\/store\/caixa-aberto"/.test(topo) && topo.includes("if (d?.aberto === false) {")
  );
  verdade(
    "a barra lê ?abrirCaixa=1 ao carregar, abre o modal e tira o parâmetro",
    topo.includes("params.get(PARAMETRO_ABRIR_CAIXA) !== \"1\"") && topo.includes("params.delete(PARAMETRO_ABRIR_CAIXA)") && topo.includes("window.history.replaceState(") && topo.includes("atenderPedidoDoCaixa(true);")
  );
  confere("o parâmetro é o do caminho", PARAMETRO_ABRIR_CAIXA, "abrirCaixa");
  const aviso24h = ler("src/components/customer/AvisoCaixaAberto24h.tsx");
  verdade("a faixa de caixa aberto há 24h continua pedindo o MESMO evento (menu do caixa)", aviso24h.includes('new CustomEvent("firehub:abrir-menu-caixa")') && EVENTO_ABRIR_MENU_DO_CAIXA === "firehub:abrir-menu-caixa");
}

console.log("\n— 3. o Balcão e as Mesas reperguntam na hora");
{
  const avisos: Array<boolean | null> = [];
  const ouvinte = (e: Event) => avisos.push((e as CustomEvent<{ aberto?: boolean }>).detail?.aberto ?? null);
  janela.addEventListener(EVENTO_CAIXA_MUDOU, ouvinte);
  avisarQueOCaixaMudou(true);
  avisarQueOCaixaMudou(false);
  janela.removeEventListener(EVENTO_CAIXA_MUDOU, ouvinte);
  confere("a barra avisa abriu/fechou com o evento firehub:caixa-mudou", [EVENTO_CAIXA_MUDOU, avisos], ["firehub:caixa-mudou", [true, false]]);

  const topo = ler("src/components/customer/StoreTopNav.tsx");
  const abrir = topo.slice(topo.indexOf("const handleOpenCash"), topo.indexOf("// ── CLOSE CASH"));
  const fechar = topo.slice(topo.indexOf("const doClose"), topo.indexOf("// ── STORE TOGGLE"));
  verdade("depois de ABRIR o caixa, a barra avisa (dentro do res.ok)", /if \(res\.ok\) \{[\s\S]*avisarQueOCaixaMudou\(true\);/.test(abrir));
  verdade("depois de FECHAR o caixa, a barra avisa", fechar.includes("avisarQueOCaixaMudou(false);"));
  verdade("a releitura de 60 s da barra também avisa quando o caixa mudou noutro aparelho", topo.includes("if (s.cashOpen !== cashOpenRef.current) avisarQueOCaixaMudou(s.cashOpen);"));

  for (const [nome, arquivo] of [["Balcão", "src/app/store/venda-presencial/page.tsx"], ["Mesas", "src/components/mesas/MesasApp.tsx"]] as const) {
    const src = ler(arquivo);
    verdade(
      `${nome}: ouve o evento, repergunta e solta o ouvinte ao sair`,
      src.includes("window.addEventListener(EVENTO_CAIXA_MUDOU, conferir);") && src.includes("window.removeEventListener(EVENTO_CAIXA_MUDOU, conferir);")
    );
    verdade(`${nome}: a repergunta não usa resposta guardada`, /\/api\/store\/caixa-aberto", \{ cache: "no-store" \}/.test(src));
  }
}

console.log("\n— 4. o widget de contato não engole clique");
{
  const css = ler("src/app/globals.css");
  const bloco = (seletor: string) => {
    const m = new RegExp(`(^|\\n)${seletor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
    return m ? m[2] : "";
  };
  verdade("o contêiner (caixa do tamanho do menu) não recebe clique", /pointer-events:\s*none/.test(bloco(".fcw-container")));
  verdade("a bolinha recebe (é nela que mora o clique e o arraste)", /pointer-events:\s*auto/.test(bloco(".fcw-fab")));
  verdade("o menu fechado não recebe clique nem foco; aberto, recebe", /pointer-events:\s*none/.test(bloco(".fcw-menu")) && /visibility:\s*hidden/.test(bloco(".fcw-menu")) && /pointer-events:\s*auto/.test(bloco(".fcw-menu-open")) && /visibility:\s*visible/.test(bloco(".fcw-menu-open")));
  verdade("o fundo do menu aberto continua clicável (fecha ao clicar fora)", !/pointer-events:\s*none/.test(bloco(".fcw-backdrop")));

  const widget = ler("src/components/FloatingContactWidget.tsx");
  verdade("o arraste (alça) está na bolinha, que tem pointer-events", /className=\{`fcw-fab[\s\S]{0,200}\{\.\.\.arraste\.alca\}/.test(widget));
  const arrastavel = ler("src/lib/useArrastavel.ts");
  verdade("o arraste captura o ponteiro na própria alça (currentTarget), não no contêiner", arrastavel.includes("const alca = e.currentTarget;") && arrastavel.includes("alca.setPointerCapture(e.pointerId)"));
}

console.log(falhas === 0 ? "\n✅ Tudo certo." : `\n❌ ${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
