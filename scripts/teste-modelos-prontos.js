/**
 * MODELOS PRONTOS ("Comanda detalhada" e "Cozinha sem valores"), o "sem
 * valores" por impressora e a letra dos itens — pedido do dono em 24/09/2026.
 *
 *   node scripts/teste-modelos-prontos.js
 */
const path = require("path");
const createJiti = require("jiti");
const jiti = createJiti(__filename, {
  alias: { "@": path.resolve(__dirname, "..", "src") },
  interopDefault: true,
  esmResolve: true,
});
const M = jiti("../src/lib/comanda-modelo.ts");

let ok = 0, falhas = 0;
function confere(nome, cond, detalhe) {
  if (cond) ok++;
  else { falhas++; console.log(`✖ ${nome}${detalhe ? `\n    ${JSON.stringify(detalhe)}` : ""}`); }
}
const tipos = (lista) => (lista || []).map((b) => b.tipo);

// ── 1. Loja que nunca abriu Personalizar impressão ────────────────────────
const semNada = { printers: [] };
const disponiveis = M.modelosDisponiveis(M.lerModelo(undefined));
confere("os dois prontos existem sem ninguém criar", disponiveis.map((m) => m.id).join() === `${M.ID_MODELO_DETALHADA},${M.ID_MODELO_COZINHA}`);
confere("impressora sem modelo: nada muda (sem blocos)", M.blocosDoPedido(semNada, {}) === undefined);
confere("impressora sem modelo: não é sem valores", M.semValoresDaImpressora(semNada, undefined) === false);

// Cozinha sem valores, loja sem personalização nenhuma
const blocosCozinha = M.blocosDoPedido(semNada, { modeloId: M.ID_MODELO_COZINHA });
confere("cozinha: leva blocos mesmo com o padrão de fábrica", Array.isArray(blocosCozinha) && blocosCozinha.length > 0);
confere("cozinha: sem totais, pagamento e QR", !tipos(blocosCozinha).some((t) => ["totais", "pagamento", "qrMotoboy", "qrCliente"].includes(t)), tipos(blocosCozinha));
confere("cozinha: mantém os obrigatórios", tipos(blocosCozinha).includes("itens") && tipos(blocosCozinha).includes("avisoEntrega"));
confere("cozinha: itens em letra 2x", blocosCozinha.find((b) => b.tipo === "itens")?.corpos?.linhaDoItem === 2);
confere("cozinha: é sem valores", M.semValoresDaImpressora(semNada, M.ID_MODELO_COZINHA) === true);

// Comanda detalhada
const blocosDetalhada = M.blocosDoPedido(semNada, { modeloId: M.ID_MODELO_DETALHADA });
confere("detalhada: tem totais, pagamento e QRs", ["totais", "pagamento", "qrMotoboy", "qrCliente"].every((t) => tipos(blocosDetalhada).includes(t)), tipos(blocosDetalhada));
confere("detalhada: não é sem valores", M.semValoresDaImpressora(semNada, M.ID_MODELO_DETALHADA) === false);
confere("detalhada: itens em letra 1,5x", blocosDetalhada.find((b) => b.tipo === "itens")?.corpos?.linhaDoItem === 1.5);

// ── 2. A loja editou o pronto: vale a versão dela, com o mesmo id ─────────
const pronto = M.modelosProntos().find((m) => m.id === M.ID_MODELO_COZINHA);
const editado = {
  comandaModelo: {
    ...M.modeloPadrao(),
    modelos: [{ ...pronto, nome: "Cozinha da Divinos", cozinha: pronto.cozinha.filter((b) => b.tipo !== "cliente") }],
  },
};
const lidos = M.modelosDisponiveis(M.lerModelo(editado.comandaModelo));
confere("editado: continua um só com aquele id", lidos.filter((m) => m.id === M.ID_MODELO_COZINHA).length === 1);
confere("editado: vale o nome da loja", lidos.find((m) => m.id === M.ID_MODELO_COZINHA)?.nome === "Cozinha da Divinos");
confere("editado: a loja tirou o cliente", !tipos(M.blocosDoPedido(editado, { modeloId: M.ID_MODELO_COZINHA })).includes("cliente"));
confere("editado: continua sem valores (lerModelo guarda a marca)", M.semValoresDaImpressora(editado, M.ID_MODELO_COZINHA) === true);

// ── 3. Modelo criado pela loja com a marca ────────────────────────────────
const proprio = { comandaModelo: { ...M.modeloPadrao(), modelos: [{ id: "mbar", nome: "Bar", semValores: true, cozinha: pronto.cozinha, completo: M.modeloPadrao().completo }] } };
confere("modelo da loja sem valores: usa a via cozinha", !tipos(M.blocosDoPedido(proprio, { modeloId: "mbar" })).includes("totais"));
confere("modelo da loja sem valores: marca por impressora", M.semValoresDaImpressora(proprio, "mbar") === true);
confere("modelo inexistente: cai no padrão, com valores", M.semValoresDaImpressora(proprio, "apagado") === false);

// ── 4. A letra dos itens é chave conhecida e sobrevive à leitura ──────────
const comLetra = M.lerModelo({ ...M.modeloPadrao(), completo: M.modeloPadrao().completo.map((b) => (b.tipo === "itens" ? { ...b, corpos: { linhaDoItem: 3, lixo: 2 } } : b)) });
const itens = comLetra.completo.find((b) => b.tipo === "itens");
confere("linhaDoItem 3 é guardada", itens.corpos?.linhaDoItem === 3, itens.corpos);
confere("chave desconhecida de corpo some", itens.corpos?.lixo === undefined);
confere("letra padrão (1) não viaja para o Assistente", !M.blocosParaOAssistente(M.modeloPadrao().completo).find((b) => b.tipo === "itens")?.corpos?.linhaDoItem);

console.log(`\n${ok} ok, ${falhas} falharam`);
process.exit(falhas ? 1 : 0);
