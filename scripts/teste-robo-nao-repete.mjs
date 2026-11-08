/**
 * O robô não repete a pergunta que o cliente já respondeu (Charlie Brown 07–08/11
 * e Lapastine 08/11/2026: "Confirma pra mim?" três vezes em 18 s, "Qual sabor?"
 * depois de "Sabor calabresa", o bairro pedido de novo).
 *
 * Causa: o site roda em vários processos desde 06/11 (PROCESSOS_DO_SITE), e o
 * webhook lia o histórico do cache do PROCESSO — só ia ao banco com o cache
 * vazio. O processo que já tinha atendido a conversa seguia com a cópia velha.
 *
 * 1) Dois processos, um banco: com a leitura antiga, o processo A não vê o
 *    endereço que o cliente deu pelo B; com a nova (banco a cada mensagem), vê.
 * 2) A fala do cliente gravada com a hora da CHEGADA fica antes da resposta.
 * 3) A trava da resposta enxuta: pergunta já feita e respondida não sai de novo.
 *
 *   node scripts/teste-robo-nao-repete.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";

const carregar = async (arquivo) => {
  const js = ts.transpileModule(readFileSync(arquivo, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import("data:text/javascript," + encodeURIComponent(js));
};
const { historicoParaAIa, historicoParaGuardar, historicoSemARajada } = await carregar("src/lib/memoria-da-conversa.ts");
const { enxugarResposta } = await carregar("src/lib/resposta-enxuta.ts");

let falhas = 0;
const conferir = (nome, ok, extra = "") => {
  console.log(`  ${ok ? "ok   " : "FALHA"} ${nome}${ok ? "" : `\n        ${typeof extra === "string" ? extra : JSON.stringify(extra)}`}`);
  if (!ok) falhas++;
};
const cli = (text) => ({ sender: "user", text });
const bot = (text) => ({ sender: "bot", text });
const enx = (resposta, historico, mensagemDoCliente) => enxugarResposta(resposta, { historico, mensagemDoCliente });

// ── O webhook em miniatura: o banco é um só, o cache é de cada processo ─────
const T0 = 1_794_000_000_000;
function servidor(leitura) {
  const banco = [];
  const gravar = (m) => banco.push(...historicoParaGuardar([m], T0 + 10 * 60_000));
  const processo = () => ({ cache: [] });
  /** Uma mensagem do cliente atendida pelo processo `p`; `responder` faz o papel do modelo. */
  const atender = (p, texto, chegouEm, responder, gravacao) => {
    const doBanco = historicoParaAIa(banco, chegouEm + 1000);
    const historico = leitura === "antiga"
      ? (p.cache.length ? p.cache : doBanco)
      : (historicoSemARajada(doBanco, chegouEm, texto).length ? historicoSemARajada(doBanco, chegouEm, texto) : p.cache);
    const resposta = responder(historico);
    const enviadaEm = chegouEm + 6000;
    gravar({ sender: "bot", text: resposta, timestamp: enviadaEm }); // replyToCustomer
    gravar({ sender: "user", text: texto, timestamp: gravacao === "hora-da-gravacao" ? enviadaEm + 50 : chegouEm });
    p.cache = [...historico, { sender: "user", text: texto, timestamp: chegouEm }, { sender: "bot", text: resposta, timestamp: enviadaEm }].slice(-15);
    return { historico, resposta };
  };
  return { banco, processo, atender };
}
/** O "modelo": pergunta o bairro enquanto não o vê no histórico. */
const modelo = (historico) =>
  historico.some((m) => m.sender === "user" && /country club/i.test(m.text))
    ? "Pix, cartão ou dinheiro?"
    : "Me passa o endereço com o bairro? 😊";

console.log("\n1) Dois processos, um banco (Charlie Brown, Virginia, 08/11 18:10–18:12)");
for (const leitura of ["antiga", "nova"]) {
  const s = servidor(leitura);
  const A = s.processo(), B = s.processo();
  s.atender(A, "Gostaria de uma pizza Napolitana grande", T0, modelo);
  s.atender(B, "A pizza pode ser sem borda, Av Antônio Emídio de Rezende, 584, Jd Country Club", T0 + 60_000, modelo);
  const r = s.atender(A, "O pagto será com pix", T0 + 120_000, modelo);
  if (leitura === "antiga") {
    conferir("leitura antiga (reproduz o defeito): o processo A pede o bairro de novo", /bairro/.test(r.resposta), r.resposta);
  } else {
    conferir("leitura nova: o processo A vê o endereço dado pelo B", r.historico.some((m) => /Country Club/.test(m.text)), r.historico);
    conferir("e não pede o bairro de novo", !/bairro/.test(r.resposta), r.resposta);
  }
}

console.log("\n2) A ordem do histórico");
for (const gravacao of ["hora-da-gravacao", "hora-da-chegada"]) {
  const s = servidor("nova");
  const A = s.processo();
  s.atender(A, "Quero uma calabresa", T0, () => "Grande ou brotinho?", gravacao);
  s.atender(A, "Grande", T0 + 30_000, () => "Anotado! Endereço com bairro?", gravacao);
  const lido = historicoParaAIa(s.banco, T0 + 60_000).map((m) => m.text);
  const certa = ["Quero uma calabresa", "Grande ou brotinho?", "Grande", "Anotado! Endereço com bairro?"];
  if (gravacao === "hora-da-gravacao") conferir("com a hora da gravação (antes) a fala do cliente fica DEPOIS da resposta", lido[0] === "Grande ou brotinho?", lido);
  else conferir("com a hora da chegada fica na ordem da conversa", JSON.stringify(lido) === JSON.stringify(certa), lido);
}

console.log("\n3) Rajada: o pedaço que saiu de cena não vai duas vezes");
{
  const doBanco = [
    { sender: "user", text: "Quero uma pizza", timestamp: T0 },
    { sender: "bot", text: "Qual sabor?", timestamp: T0 + 5000 },
    { sender: "user", text: "uma napolitana", timestamp: T0 + 20_000 }, // juntada, gravada ao sair de cena
    { sender: "user", text: "Sim", timestamp: T0 + 21_000 }, // de outra mensagem, que outro processo levou
  ];
  const r = historicoSemARajada(doBanco, T0 + 20_000, "uma napolitana\ngrande");
  conferir("sai o pedaço desta rajada", !r.some((m) => m.text === "uma napolitana"), r);
  conferir("fica o que veio antes e a fala que não está no texto", r.length === 3 && r.some((m) => m.text === "Sim"), r);
}

const RESUMO_1 = "Fechado! Confere se está tudo certinho:\n\n1x Pizza Grande (8 pedaços) - 1 sabor (12- Napolitana) - 54 reais\nSubtotal dos itens: 54 reais\nTaxa de entrega: 4 reais\nValor Total a pagar: 58 reais\nEndereço: Av Antônio Emídio de Rezende, 584 - Country Club\nPagamento: Pix\n\nConfirma pra mim pra eu enviar pra cozinha?";
const RESUMO_2 = "Resumo do pedido:\n- 1x Pizza Grande (8 pedaços) - 1 sabor (12- Napolitana): 54 reais\nSubtotal dos itens: 54 reais\nTaxa de entrega: 4 reais\nValor Total a pagar: 58 reais\nEndereço: Av Antônio Emídio de Rezende, 584 - Country Club\nPagamento: Pix\n\nConfirma pra mim? 😊";

console.log("\n4) Charlie Brown, 08/11 18:12–18:13: \"Confirma?\" três vezes");
{
  const h = [cli("A pizza pode ser sem borda, Av Antônio Emídio de Rezende, 584, Jd Country Club"), bot("Pode sim! Anotei a pizza sem borda pra entrega no Country Club com a taxa de 4,00 reais. Qual será a forma de pagamento: Pix, cartão ou dinheiro?"), cli("O pagto será com pux"), bot(RESUMO_1)];
  const r = enx(RESUMO_2, h, "Pix");
  conferir("o 2º resumo, mesmo total, sai sem o \"Confirma pra mim?\"", !/\?/.test(r.texto) && /Total a pagar: 58/.test(r.texto), r.texto);
  const h2 = [...h, cli("Pix"), bot(RESUMO_2)];
  const r2 = enx("Beleza, Pix na entrega! Posso confirmar e mandar seu pedido pra cozinha? 😊", h2, "Na hora que for entregue");
  conferir("o 3º (\"Posso confirmar...?\") sai sem a pergunta", r2.texto === "Beleza, Pix na entrega!", r2.texto);
}

console.log("\n5) O \"Confirma?\" que tem de ficar");
{
  const h = [cli("O pagto será com pix"), bot(RESUMO_1)];
  const sim = enx(RESUMO_2, h, "Sim");
  conferir("o cliente disse \"sim\" e o modelo pediu de novo: fica (pedido parado é pior)", /Confirma pra mim\?/.test(sim.texto), sim.texto);
  const outro = enx(RESUMO_2.replace("Valor Total a pagar: 58 reais", "Valor Total a pagar: 66 reais"), h, "Põe uma coca 2 litros também");
  conferir("o total mudou (mexeu no pedido): fica", /Confirma pra mim\?/.test(outro.texto), outro.texto);
  const endereco = enx("Fechado! Total 58 reais. Confirma pra mim?", [cli("Rua Aymores 364"), bot("É no Vila Togni? Confirma o endereço?")], "Isso, Vila Togni");
  conferir("\"Confirma o endereço?\" respondido não barra o \"Confirma?\" do resumo", /Confirma pra mim\?/.test(endereco.texto), endereco.texto);
  const pergunta = enx(RESUMO_2, h, "Quanto tempo demora?");
  conferir("o cliente perguntou no meio: fica", /Confirma pra mim\?/.test(pergunta.texto), pergunta.texto);
}

console.log("\n6) Pergunta qualquer repetida não é cortada (o cliente pode não ter respondido)");
{
  // Lapastine, 08/11: referência não é bairro — perguntar o bairro de novo é o certo.
  const bairro = enx("Anotado, perto do Mercadinho do Maia! Qual é o bairro pra eu confirmar a entrega? 😊", [bot("Me passa o endereço com o bairro? 😊"), cli("Rua das Flores, 10")], "Perto do Mercadinho do Maia.");
  conferir("\"Qual é o bairro?\" depois de um ponto de referência fica", /bairro.*\?/.test(bairro.texto), bairro.texto);
  const nova = enx("Calabresa anotada! Vai querer borda recheada?", [bot("Qual sabor da pizza: Mussarela, Presunto ou Calabresa?")], "Calabresa");
  conferir("pergunta nova não é tocada", /borda recheada\?/.test(nova.texto), nova.texto);
  const so = enx("Confirma pra mim? 😊", [cli("O pagto será com pix"), bot(RESUMO_1)], "Pix");
  conferir("resposta que era só o \"Confirma?\" repetido vira \"Anotado\" no webhook (corte \"já dito\")", !so.texto.trim() && so.cortes.some((c) => c.endsWith("já dito")), so);
}

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
