/**
 * Trava o cadastro da loja na Focus NFe e as credenciais fiscais:
 * cifragem dos tokens, token por ambiente, conserto do fiscalConfig legado
 * (o da Hakim Centro em 24/09/2026) e o corpo do POST /v2/empresas — que
 * leva o .pfx, a senha e o CSC e por isso não pode vazar em log nem em
 * mensagem de erro.
 *
 *   npx tsx scripts/teste-fiscal-cadastro.ts
 */
process.env.FISCAL_CHAVE = "chave-de-teste-do-cadastro-fiscal";

import { readFileSync } from "fs";
import { join } from "path";
import { ambienteDoTokenColado, cifrar, decifrar, nomeDoAmbiente, tokenDoAmbiente } from "../src/lib/fiscal-credenciais";
import {
  ambienteNumerico,
  aplicarFormularioFiscal,
  carimbarEmissaoLigada,
  comPadroesDeGravacao,
  configParaConferencia,
  cscDoAmbiente,
  FORMAS_AUTOMATICAS_PADRAO,
  normalizarConfigFiscal,
  notaDoPedido,
  caminhoDaNotaDoPedido,
  regimeNumerico,
  respostaDaNotaDaConta,
  retratoDoCadastro,
  situacaoDoCertificado,
  sugestoesDoCadastro,
  type CaminhoDaNota,
  type ConfigFiscalGravada,
  type PedidoDaConta,
} from "../src/lib/fiscal-config";
import { pendenciasDoEmitente } from "../src/lib/fiscal-validacao";
import {
  conferirPedidoDeCadastro,
  corpoSemSegredos,
  finalDoCsc,
  lerEmpresa,
  montarCorpoDaEmpresa,
  semSegredos,
  SEM_CONTA_DE_REVENDA,
  tokenDeRevenda,
  traduzirErroDaFocus,
} from "../src/lib/focus-empresas";
import { pendenciasParaEmitir } from "../src/lib/fiscal-emissao";

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// ─── Cifragem ────────────────────────────────────────────────────────────────
console.log("\n— cifrar / decifrar");
{
  const token = "tOkEnDaFoCuS1234567890";
  const c1 = cifrar(token)!;
  const c2 = cifrar(token)!;
  confere("ida e volta devolve o mesmo token", decifrar(c1), token);
  confere("cifrado não contém o token em claro", c1.includes(token), false);
  // "fh2:<id da chave>:…" — o formato com o id da chave (lib/fiscal-credenciais).
  confere("cifrado tem o prefixo de versão e o id da chave", /^fh2:[0-9a-f]{8}:/.test(c1), true);
  confere("mesmo token cifra diferente a cada vez (IV novo)", c1 === c2, false);
  confere("vazio continua vazio", cifrar("   "), null);
  confere("legado em texto puro volta como está", decifrar("tokenColadoAMao"), "tokenColadoAMao");
  confere("null/undefined viram null", [decifrar(null), decifrar(undefined)], [null, null]);

  // Adulterado (um byte do conteúdo trocado): o GCM recusa, e a resposta é
  // "sem token" — nunca lixo mandado para a Focus.
  const [, prefixo, iv, tag, dados] = /^(fh2:[0-9a-f]{8}:)([^.]*)\.([^.]*)\.(.*)$/.exec(c1)!;
  const dadosTrocados = Buffer.from(dados, "base64");
  dadosTrocados[0] ^= 0xff;
  confere("valor adulterado não abre", decifrar(`${prefixo}${iv}.${tag}.${dadosTrocados.toString("base64")}`), null);

  const chaveOriginal = process.env.FISCAL_CHAVE;
  process.env.FISCAL_CHAVE = "outra-chave";
  confere("cifrado com outra chave não abre", decifrar(c1), null);
  process.env.FISCAL_CHAVE = chaveOriginal;
  confere("de volta à chave certa, abre", decifrar(c1), token);
}

// ─── Token por ambiente ──────────────────────────────────────────────────────
console.log("\n— tokenDoAmbiente");
{
  const tokens = { homologacao: cifrar("TOKEN-H"), producao: cifrar("TOKEN-P") };
  confere("ambiente 2 usa o de homologação", tokenDoAmbiente({ ambiente: 2, tokens }), "TOKEN-H");
  confere("ambiente 1 usa o de produção", tokenDoAmbiente({ ambiente: 1, tokens }), "TOKEN-P");
  confere("ambiente \"1\" (texto) também é produção", tokenDoAmbiente({ ambiente: "1", tokens }), "TOKEN-P");
  confere("sem ambiente = homologação", tokenDoAmbiente({ tokens }), "TOKEN-H");
  confere("falta o do ambiente → cai no colado à mão", tokenDoAmbiente({ ambiente: 1, tokens: { homologacao: tokens.homologacao }, tokenDoProvedor: "MANUAL" }), "MANUAL");
  confere("colado à mão cifrado também abre", tokenDoAmbiente({ ambiente: 2, tokenDoProvedor: cifrar("MANUAL-C") }), "MANUAL-C");
  confere("sem nada → null", tokenDoAmbiente({ ambiente: 1, tokens: { homologacao: tokens.homologacao } }), null);
  confere("config nula → null", tokenDoAmbiente(null), null);
  // A armadilha do legado: "producao" por extenso é NaN e cai em homologação.
  // Por isso toda rota normaliza ANTES de pedir o token.
  confere("nomeDoAmbiente(\"producao\") sem normalizar cai em homologação", nomeDoAmbiente("producao"), "homologacao");
  confere(
    "normalizado, \"producao\" pega o token de produção",
    tokenDoAmbiente(normalizarConfigFiscal({ ambiente: "producao", tokens })),
    "TOKEN-P"
  );
}

// ─── Config legada ───────────────────────────────────────────────────────────
console.log("\n— normalização do fiscalConfig legado");
{
  // Exatamente o que a Hakim Centro tem gravado (24/09/2026).
  const hakim = {
    ie: "",
    cnpj: "55878184000189",
    enabled: false,
    ambiente: "homologacao",
    cstDefault: "102",
    ncmDefault: "2106.90.90",
    razaoSocial: "",
    nomeFantasia: "",
    regimeTributario: "Simples Nacional",
    autoEmitPaymentMethods: ["PIX", "CREDITO_ONLINE", "CREDIT_CARD", "DEBIT_CARD", "VOUCHER"],
    contador: { email: "contador@exemplo.com", automatico: true },
  };
  const n = normalizarConfigFiscal(hakim);
  confere("ambiente \"homologacao\" vira 2", n.ambiente, 2);
  confere("regime \"Simples Nacional\" vira 1", n.regimeTributario, 1);
  confere("chave antiga `ie` sai", "ie" in n, false);
  confere("ncmDefault (o NCM genérico que mascarava produto sem NCM) sai", "ncmDefault" in n, false);
  confere("cstDefault \"102\" vira csosnPadrao", [n.csosnPadrao, "cstDefault" in n], ["102", false]);
  confere("CNPJ intacto", n.cnpj, "55878184000189");
  confere("config do contador passa intacta", n.contador, hakim.contador);
  confere("formas automáticas intactas", n.autoEmitPaymentMethods, hakim.autoEmitPaymentMethods);
  confere("enabled continua false", n.enabled, false);
  confere("não altera o objeto original", hakim.ambiente, "homologacao");

  confere("IE da chave antiga vale quando a nova está vazia", normalizarConfigFiscal({ ie: "12.345.678" }).inscricaoEstadual, "12.345.678");
  confere("IE nova ganha da antiga", normalizarConfigFiscal({ ie: "111", inscricaoEstadual: "222" }).inscricaoEstadual, "222");

  confere("ambientes por extenso e em número", ["producao", "Produção", "PRODUCAO", "homologação", "1", 2, "2", "qualquer"].map(ambienteNumerico), [1, 1, 1, 2, 1, 2, 2, 2]);
  confere("ambiente ausente fica ausente (o padrão da tela decide)", [ambienteNumerico(undefined), ambienteNumerico("")], [null, null]);
  confere(
    "regimes por extenso",
    ["Simples Nacional", "Simples Nacional - Excesso de sublimite", "Regime Normal", "Lucro Presumido", "MEI", "3", 1, "xyz"].map(regimeNumerico),
    [1, 2, 3, 3, 4, 3, 1, null]
  );
  confere("série em texto vira número; inválida sai", [normalizarConfigFiscal({ serie: "3" }).serie, "serie" in normalizarConfigFiscal({ serie: "abc" })], [3, false]);
  confere("UF em minúsculas vira maiúscula", normalizarConfigFiscal({ uf: " rj " }).uf, "RJ");
  confere("lixo vira objeto vazio", [normalizarConfigFiscal(null), normalizarConfigFiscal("x"), normalizarConfigFiscal([1])], [{}, {}, {}]);

  // Antes da normalização, a tela da Hakim acusava ambiente e regime inválidos.
  const antes = pendenciasParaEmitir({ ...(hakim as any) }).map((p) => p.campo);
  const depois = pendenciasParaEmitir(n).map((p) => p.campo);
  confere("sem normalizar: acusa ambiente e regime", [antes.includes("ambiente"), antes.includes("regimeTributario")], [true, true]);
  confere("normalizada: ambiente e regime saem da lista", [depois.includes("ambiente"), depois.includes("regimeTributario")], [false, false]);
}

// ─── CSC cadastrado na Focus conta como CSC ─────────────────────────────────
// A mesma conferência da rota (api/store/fiscal → conferir).
const conferir = (c: ConfigFiscalGravada) => pendenciasParaEmitir(configParaConferencia(c));
const campos = (c: ConfigFiscalGravada) => pendenciasParaEmitir(c).map((p) => p.campo);
const camposConferidos = (c: ConfigFiscalGravada) => conferir(c).map((p) => p.campo);

// Loja completa, de conta própria (token colado), como o PUT grava depois de
// o lojista digitar o CSC no modo manual: sem `csc`, só o final.
const EMITENTE = {
  provedor: "focusnfe", cnpj: "55878184000189", inscricaoEstadual: "12345678", razaoSocial: "Hakim Centro Ltda",
  regimeTributario: 1, logradouro: "Rua A", numero: "10", bairro: "Centro", municipio: "Rio das Ostras",
  codigoMunicipio: "3304524", uf: "RJ", cep: "28890000", serie: 1, temCertificado: true,
};
// Como a rota /provisionar grava: os dois tokens que a Focus devolve, o CSC
// POR AMBIENTE em cscNaFocus e nada de cscId/cscFinal em cima.
const PROVISIONADA = (csc: ConfigFiscalGravada["cscNaFocus"], extra: Record<string, unknown> = {}): ConfigFiscalGravada =>
  normalizarConfigFiscal({
    ...EMITENTE, ambiente: 2, focusEmpresaId: "123",
    tokens: { homologacao: cifrar("TOKEN-H"), producao: cifrar("TOKEN-P") },
    cscNaFocus: csc, ...extra,
  });
const SO_HOMOLOGACAO = { homologacao: { id: "1", final: "AB12" } };
const OS_DOIS = { homologacao: { id: "1", final: "AB12" }, producao: { id: "2", final: "CD34" } };

console.log("\n— configParaConferencia / CSC por ambiente");
{
  const pronta = normalizarConfigFiscal({ ...EMITENTE, ambiente: 2, cscId: "1", tokens: { homologacao: cifrar("TOKEN-H") }, cscFinal: "AB12" });
  // A emissão, a automática, o cron e a inutilização leem a config CRUA. O
  // PUT apaga o `csc` e grava só o final: se a emissão não aceitasse o final,
  // a loja ficava "LIGADA" na tela e nenhuma nota saía (409 "falta o CSC").
  confere("config crua (como emitir/automática leem): o final do CSC basta", campos(pronta), []);
  confere("com a ponte, cadastro completo", conferir(pronta), []);
  confere("a ponte não mexe no objeto gravado", "csc" in pronta, false);
  confere("sem cscFinal a ponte não inventa CSC", camposConferidos({ ...pronta, cscFinal: null }), ["csc"]);
  confere("em produção sem token de produção: pendência de token", camposConferidos({ ...pronta, ambiente: 1 }), ["tokenDoProvedor"]);

  // Cadastrada pela Focus só com o CSC de homologação (o formulário aceita).
  const soH = PROVISIONADA(SO_HOMOLOGACAO);
  confere("provisionada, homologação com CSC: pronta", camposConferidos(soH), []);
  confere("provisionada, PRODUÇÃO sem CSC de produção: falta CSC", camposConferidos({ ...soH, ambiente: 1 }), ["cscId", "csc"]);
  confere("a emissão (config crua) concorda: falta CSC em produção", campos({ ...soH, ambiente: 1 }), ["cscId", "csc"]);
  // O /provisionar antigo espelhava o CSC de homologação em cscId/cscFinal e
  // ele passava a valer em produção. Mesmo com esses campos velhos, na loja
  // cadastrada vale só o CSC do ambiente.
  confere(
    "provisionada com cscId/cscFinal velhos em cima: produção continua sem CSC",
    camposConferidos({ ...soH, ambiente: 1, cscId: "1", cscFinal: "AB12" }),
    ["cscId", "csc"]
  );
  const osDois = PROVISIONADA(OS_DOIS);
  confere("provisionada com os dois CSCs: produção pronta", camposConferidos({ ...osDois, ambiente: 1 }), []);
  confere("…e a emissão (config crua) concorda", campos({ ...osDois, ambiente: 1 }), []);
  confere(
    "cscDoAmbiente: provisionada mostra o CSC de cada ambiente",
    [cscDoAmbiente(soH, 2), cscDoAmbiente(soH, 1)],
    [{ id: "1", final: "AB12", temCsc: true }, { id: null, final: null, temCsc: false }]
  );
  confere("cscDoAmbiente: conta própria usa o CSC digitado nos dois", [cscDoAmbiente(pronta, 1).temCsc, cscDoAmbiente(pronta, 2).temCsc], [true, true]);
}

// ─── Gravação do formulário (PUT /api/store/fiscal) ─────────────────────────
console.log("\n— aplicarFormularioFiscal");
{
  const AGORA = new Date("2026-09-24T21:00:00-03:00");
  const opcoes = (papel = "FRANCHISEE") => ({ papel, cifrar: (t: string) => cifrar(t), conferir, agora: AGORA });
  const gravar = (bruto: unknown, body: Record<string, unknown>, papel?: string) => aplicarFormularioFiscal(bruto, body, opcoes(papel));
  const ok = (r: ReturnType<typeof aplicarFormularioFiscal>) => {
    if (!r.ok) throw new Error(`esperava gravar, veio ${JSON.stringify(r.corpo)}`);
    return r;
  };

  // Modo manual (conta própria): token + CSC digitados. O `csc` sai, fica o
  // final — e a EMISSÃO (config crua) tem de aceitar isso.
  const manual = ok(gravar({ ...EMITENTE, ambiente: 2 }, { cscId: "1", csc: "ABCDEF123456", tokenHomologacao: "TOKEN-H" })).config;
  confere("modo manual: CSC inteiro não fica gravado, só o final", [manual.csc, manual.cscFinal], [undefined, "3456"]);
  confere("modo manual: token cifrado", [String(manual.tokens?.homologacao).startsWith("fh2:"), decifrar(manual.tokens?.homologacao)], [true, "TOKEN-H"]);
  confere("modo manual: a emissão (config crua) vê o cadastro completo", campos(manual), []);
  const ligadaManual = ok(gravar(manual, { enabled: true }));
  confere("modo manual: liga, e a emissão continua sem pendência", [ligadaManual.config.enabled, campos(ligadaManual.config)], [true, []]);

  const legado = ok(gravar({ ...EMITENTE, ambiente: 2, cscId: "1", csc: "LEGADO9999" }, { razaoSocial: "Hakim Centro Ltda" })).config;
  confere("CSC em texto puro do legado vira só o final", [legado.csc, legado.cscFinal, campos(legado)], [undefined, "9999", ["tokenDoProvedor"]]);

  // Formas da emissão automática: a tela mostra PIX/crédito/débito marcados
  // quando a loja nunca escolheu; o servidor tem de gravar a mesma lista.
  confere("sem lista gravada: qualquer Salvar grava a lista padrão", ok(gravar({ ...EMITENTE }, { razaoSocial: "X" })).config.autoEmitPaymentMethods, [...FORMAS_AUTOMATICAS_PADRAO]);
  confere("padrão = PIX, crédito e débito", FORMAS_AUTOMATICAS_PADRAO, ["PIX", "CREDIT_CARD", "DEBIT_CARD"]);
  confere("ligar sem lista gravada: a lista padrão vai junto", ok(gravar(manual, { enabled: true })).config.autoEmitPaymentMethods, [...FORMAS_AUTOMATICAS_PADRAO]);
  confere("lista já gravada fica como está", ok(gravar({ autoEmitPaymentMethods: ["MONEY"] }, { razaoSocial: "X" })).config.autoEmitPaymentMethods, ["MONEY"]);
  confere("desmarcar tudo continua vazio (não volta ao padrão)", ok(gravar({ autoEmitPaymentMethods: ["PIX"] }, { autoEmitPaymentMethods: [] })).config.autoEmitPaymentMethods, []);
  confere("lista com lixo: só os textos", ok(gravar({}, { autoEmitPaymentMethods: ["PIX", 3, null] })).config.autoEmitPaymentMethods, ["PIX"]);

  // Carimbo de quando a emissão passou a valer.
  const ligou = ok(gravar(manual, { enabled: true })).config;
  confere("ligar carimba emissaoLigadaEm", ligou.emissaoLigadaEm, AGORA.toISOString());
  const depois = aplicarFormularioFiscal(ligou, { razaoSocial: "Outra" }, { ...opcoes(), agora: new Date("2026-09-25T10:00:00-03:00") });
  confere("salvar outra coisa com ela ligada mantém o carimbo", ok(depois).config.emissaoLigadaEm, AGORA.toISOString());
  confere("desligada não carimba", ok(gravar(manual, { razaoSocial: "Outra" })).config.emissaoLigadaEm, undefined);
  confere(
    "carimbarEmissaoLigada: trocar de ambiente com ela ligada carimba de novo",
    carimbarEmissaoLigada({ enabled: true, ambiente: 2, emissaoLigadaEm: "velho" }, { enabled: true, ambiente: 1, emissaoLigadaEm: "velho" }, AGORA).emissaoLigadaEm,
    AGORA.toISOString()
  );
  confere(
    "carimbarEmissaoLigada: ambiente ausente dos dois lados não é troca",
    carimbarEmissaoLigada({ enabled: true, emissaoLigadaEm: "velho" }, { enabled: true, emissaoLigadaEm: "velho" }, AGORA).emissaoLigadaEm,
    "velho"
  );

  // Ligar com pendência não liga (nem carimba).
  const incompleta = gravar({ ...EMITENTE, ambiente: 2 }, { enabled: true });
  confere("ligar com pendência: 409 com a lista", [incompleta.ok, !incompleta.ok && incompleta.corpo.error], [false, "pendencias"]);

  // Produção: a loja cadastrada só com o CSC de homologação.
  const soH = { ...PROVISIONADA(SO_HOMOLOGACAO), enabled: true, emissaoLigadaEm: "2026-09-20T10:00:00.000Z" };
  const paraProducao = gravar(soH, { ambiente: 1, confirmarProducao: true });
  confere(
    "ligada em homologação, só CSC de homologação: NÃO passa para produção",
    [paraProducao.ok, !paraProducao.ok && (paraProducao.corpo.pendencias as any[]).map((p) => p.campo)],
    [false, ["cscId", "csc"]]
  );
  const desligadaSoH = { ...soH, enabled: false, ambiente: 1 };
  const ligarEmProducao = gravar(desligadaSoH, { enabled: true, confirmarProducao: true });
  confere("desligada em produção sem CSC de produção: não liga", ligarEmProducao.ok, false);
  const osDois = { ...PROVISIONADA(OS_DOIS), enabled: true, emissaoLigadaEm: "2026-09-20T10:00:00.000Z" };
  const semConfirmar = gravar(osDois, { ambiente: 1 });
  confere("com os dois CSCs, produção sem confirmar: pede confirmação", !semConfirmar.ok && semConfirmar.corpo.error, "confirmacao_necessaria");
  const producao = ok(gravar(osDois, { ambiente: 1, confirmarProducao: true })).config;
  confere("com os dois CSCs e confirmado: passa, e o carimbo é o da troca", [producao.ambiente, producao.emissaoLigadaEm], [1, AGORA.toISOString()]);

  // Loja cadastrada pelo FireHub: o CSC digitado no modo manual não chega à
  // Focus, então não é gravado — e a tela é avisada.
  const cscManual = ok(gravar(PROVISIONADA(SO_HOMOLOGACAO), { cscId: "9", csc: "NAOVAIPRAFOCUS" }));
  confere("provisionada: CSC do modo manual não é gravado", [cscManual.config.cscId, cscManual.config.cscFinal, cscManual.config.csc], [undefined, undefined, undefined]);
  confere("provisionada: e a resposta avisa", cscManual.avisos.length, 1);
  confere("provisionada: o `cscId: \"\"` que a tela manda em todo Salvar passa calado", ok(gravar(PROVISIONADA(SO_HOMOLOGACAO), { cscId: "", razaoSocial: "X" })).avisos, []);

  // STAFF salva o operacional, não a identidade fiscal nem o liga/desliga —
  // e, desde a escolha "Como a nota é emitida" (30/09/2026), nem as formas
  // da emissão automática: a tela as mostra na mesma tabela das integrações,
  // e metade da decisão não pode ser do balcão.
  const staff = ok(gravar({ ...EMITENTE }, { enabled: true, cnpj: "55878184000189", autoEmitPaymentMethods: ["PIX"] }, "STAFF"));
  confere("STAFF: não liga; CNPJ igual não conta como recusado; formas ficam como a tela mostrou", [staff.config.enabled, staff.recusados, staff.config.autoEmitPaymentMethods], [undefined, ["enabled", "autoEmitPaymentMethods"], [...FORMAS_AUTOMATICAS_PADRAO]]);
  const staffSemMudar = ok(gravar({ ...EMITENTE, autoEmitPaymentMethods: ["PIX"] }, { autoEmitPaymentMethods: ["PIX"], razaoSocial: EMITENTE.razaoSocial }, "STAFF"));
  confere("STAFF: mandar a lista que a tela mostrou não conta como recusado", staffSemMudar.recusados, []);
  const staffModo = ok(gravar({ ...EMITENTE }, { modoDaEmissao: "manual", cpfNaEntrega: "obrigatorio", formasPorIntegracao: { IFOOD: ["ONLINE"] } }, "STAFF"));
  confere("STAFF: modo, CPF da entrega e formas das integrações são do titular", [staffModo.recusados, staffModo.config.modoDaEmissao, staffModo.config.cpfNaEntrega, staffModo.config.formasPorIntegracao], [["modoDaEmissao", "formasPorIntegracao", "cpfNaEntrega"], undefined, undefined, undefined]);
  confere("campo fora da lista não entra", "inventado" in ok(gravar({}, { inventado: 1 })).config, false);
  confere("o carimbo não vem do corpo", ok(gravar({}, { emissaoLigadaEm: "2020-01-01" })).config.emissaoLigadaEm, undefined);
}

// ─── Item 1: a tela, o ligar e o /provisionar conferem a MESMA coisa ─────────
console.log("\n— retratoDoCadastro: a conferência da tela é a do gravado");
{
  const opcoes = { papel: "FRANCHISEE", cifrar: (t: string) => cifrar(t), conferir, agora: new Date("2026-09-24T21:00:00-03:00") };
  const gravar = (bruto: unknown, body: Record<string, unknown>) => aplicarFormularioFiscal(bruto, body, opcoes);
  const pendenciasDoGet = (bruto: unknown, loja: { storeName?: string; cpfCnpj?: string } | null) =>
    camposConferidos(retratoDoCadastro(bruto, loja).config);
  const pendenciasDoProvisionar = (bruto: unknown) =>
    // A mesma chamada da rota /provisionar, sobre o mesmo retrato.
    pendenciasDoEmitente({ ...retratoDoCadastro(bruto, null).config, cscId: "x", csc: "x", temCertificado: true, ambiente: 2, serie: 1 } as any).map((p) => p.campo);

  // A Hakim Centro como está gravada (24/09/2026): razão social e nome fantasia
  // vazios, CNPJ preenchido, loja "Hakim Centro" com cpfCnpj 55878184000189.
  const LOJA_HAKIM = { storeName: "Hakim Centro", cpfCnpj: "55878184000189" };
  const hakimGravada = {
    ie: "", cnpj: "55878184000189", enabled: false, ambiente: "homologacao", cstDefault: "102", ncmDefault: "2106.90.90",
    razaoSocial: "", nomeFantasia: "", regimeTributario: "Simples Nacional",
    autoEmitPaymentMethods: ["PIX", "CREDITO_ONLINE", "CREDIT_CARD", "DEBIT_CARD", "VOUCHER"],
  };
  const r = retratoDoCadastro(hakimGravada, LOJA_HAKIM);
  confere("Hakim: a razão social do retrato é a gravada (vazia), não o nome da loja", [r.config.razaoSocial, r.config.nomeFantasia], ["", ""]);
  confere("Hakim: o nome da loja volta como SUGESTÃO (razão social e nome fantasia)", r.sugestoes, { razaoSocial: "Hakim Centro", nomeFantasia: "Hakim Centro" });
  confere("Hakim: a tela acusa a razão social", pendenciasDoGet(hakimGravada, LOJA_HAKIM).includes("razaoSocial"), true);

  // Hakim com todo o resto pronto (conta própria), só a razão social vazia:
  // a tela dizia "pronta" (o GET preenchia com "Hakim Centro") e o ligar recusava.
  const quaseProntaGravada = {
    ...hakimGravada, ...EMITENTE, cnpj: "55878184000189", razaoSocial: "", nomeFantasia: "",
    tokens: { homologacao: cifrar("TOKEN-H") }, cscId: "1", cscFinal: "AB12",
  };
  const doGet = pendenciasDoGet(quaseProntaGravada, LOJA_HAKIM);
  const ligar = gravar(quaseProntaGravada, { enabled: true });
  const doLigar = !ligar.ok ? (ligar.corpo.pendencias as any[]).map((p) => p.campo) : [];
  confere("quase pronta: a tela lista só a razão social", doGet, ["razaoSocial"]);
  confere("quase pronta: o ligar recusa pela MESMA lista", [ligar.ok, doLigar], [false, doGet]);
  confere("quase pronta: o /provisionar recusa pela mesma razão social", pendenciasDoProvisionar(quaseProntaGravada), ["razaoSocial"]);
  confere(
    "o retrato antigo (nome da loja no lugar da razão social) dizia pronta — a divergência",
    camposConferidos({ ...retratoDoCadastro(quaseProntaGravada, LOJA_HAKIM).config, razaoSocial: "Hakim Centro" }),
    []
  );
  // O lojista usa a sugestão e salva: aí sim ela vira dado, e os três concordam.
  const salva = gravar(quaseProntaGravada, { razaoSocial: "Hakim Centro" });
  const gravadaDepois = salva.ok ? salva.config : {};
  confere("usou a sugestão e salvou: tela sem pendência", pendenciasDoGet(gravadaDepois, LOJA_HAKIM), []);
  confere("…o ligar liga", gravar(gravadaDepois, { enabled: true }).ok, true);
  confere("…o /provisionar não acusa o emitente", pendenciasDoProvisionar(gravadaDepois), []);
  confere("…e a sugestão some", retratoDoCadastro(gravadaDepois, LOJA_HAKIM).sugestoes, { nomeFantasia: "Hakim Centro" });

  // Loja nova: nada gravado. Nada da identidade fiscal é inventado; o que é
  // operacional (ambiente, série, formas) é o padrão que a gravação aplica.
  const nova = retratoDoCadastro(null, { storeName: "Loja Nova", cpfCnpj: "11222333000181" });
  confere(
    "loja nova: CNPJ, razão social e regime ficam vazios no retrato",
    [nova.config.cnpj, nova.config.razaoSocial, nova.config.regimeTributario],
    [undefined, undefined, undefined]
  );
  confere("loja nova: sugere CNPJ, razão social, nome fantasia e regime 1", nova.sugestoes, { cnpj: "11222333000181", razaoSocial: "Loja Nova", nomeFantasia: "Loja Nova", regimeTributario: 1 });
  confere("loja nova: ambiente 2, série 1 e formas padrão no retrato", [nova.config.ambiente, nova.config.serie, nova.config.autoEmitPaymentMethods], [2, 1, [...FORMAS_AUTOMATICAS_PADRAO]]);
  confere("sem nome nem documento da loja: nada a sugerir além do regime", sugestoesDoCadastro({}, null), { regimeTributario: 1 });

  // A tela manda o formulário SEM `ambiente` (ele tem controle próprio) e o
  // ligar manda só `enabled`. Antes: o GET mostrava ambiente 2 e série 1 só
  // no retrato, o banco ficava sem os dois, e o ligar recusava por "ambiente".
  const semAmbienteNemSerie = { ...EMITENTE, serie: undefined, tokens: { homologacao: cifrar("TOKEN-H") }, cscId: "1", cscFinal: "AB12" };
  confere("gravado sem ambiente nem série: a tela não acusa os dois", pendenciasDoGet(semAmbienteNemSerie, null), []);
  const salvouSemAmbiente = gravar(semAmbienteNemSerie, { razaoSocial: "Hakim Centro Ltda" });
  confere("…o Salvar grava ambiente 2 e série 1", salvouSemAmbiente.ok && [salvouSemAmbiente.config.ambiente, salvouSemAmbiente.config.serie], [2, 1]);
  const ligouSemAmbiente = gravar(semAmbienteNemSerie, { enabled: true });
  confere("…e o ligar liga (antes: 409 por \"ambiente\" e \"série\")", [ligouSemAmbiente.ok, ligouSemAmbiente.ok && ligouSemAmbiente.config.ambiente], [true, 2]);
  confere("…e a emissão (config crua gravada) concorda", ligouSemAmbiente.ok && campos(ligouSemAmbiente.config), []);

  confere(
    "comPadroesDeGravacao não mexe no que foi escolhido",
    (({ ambiente, serie, autoEmitPaymentMethods }) => [ambiente, serie, autoEmitPaymentMethods])(comPadroesDeGravacao({ ambiente: 1, serie: 3, autoEmitPaymentMethods: [] })),
    [1, 3, []]
  );
  confere("comPadroesDeGravacao não inventa a identidade fiscal", ["cnpj", "razaoSocial", "nomeFantasia", "regimeTributario"].some((k) => k in comPadroesDeGravacao({})), false);
}

// ─── Item 2: o token colado à mão é de UM ambiente ──────────────────────────
console.log("\n— ambienteDoToken: o token colado vale só no ambiente dele");
{
  const opcoes = (papel = "FRANCHISEE") => ({ papel, cifrar: (t: string) => cifrar(t), conferir, agora: new Date("2026-09-24T21:00:00-03:00") });
  const gravar = (bruto: unknown, body: Record<string, unknown>, papel?: string) => aplicarFormularioFiscal(bruto, body, opcoes(papel));
  const T = cifrar("TOKEN-COLADO");

  confere("marcado homologação: não serve para produção", tokenDoAmbiente({ ambiente: 1, tokenDoProvedor: T, ambienteDoToken: 2 }), null);
  confere("marcado homologação: serve para homologação", tokenDoAmbiente({ ambiente: 2, tokenDoProvedor: T, ambienteDoToken: 2 }), "TOKEN-COLADO");
  confere("marcado produção: serve para produção, não para homologação", [tokenDoAmbiente({ ambiente: 1, tokenDoProvedor: T, ambienteDoToken: 1 }), tokenDoAmbiente({ ambiente: 2, tokenDoProvedor: T, ambienteDoToken: 1 })], ["TOKEN-COLADO", null]);
  confere(
    "marca em texto (tela antiga): producao, Produção, PRODUÇÃO, homologacao",
    ["producao", "Produção", "PRODUÇÃO", "homologacao", "2", 1].map((a) => ambienteDoTokenColado({ ambienteDoToken: a })),
    ["producao", "producao", "producao", "homologacao", "homologacao", "producao"]
  );
  confere("o token do cadastro (tokens) continua ganhando do colado", tokenDoAmbiente({ ambiente: 1, tokens: { producao: cifrar("TOKEN-P") }, tokenDoProvedor: T, ambienteDoToken: 2 }), "TOKEN-P");

  // Config antiga, sem a marca: vale o ambiente gravado na época.
  confere("leitura antiga em homologação: carimba 2", normalizarConfigFiscal({ ambiente: 2, tokenDoProvedor: "X" }).ambienteDoToken, 2);
  confere("leitura antiga com \"producao\" por extenso: carimba 1", normalizarConfigFiscal({ ambiente: "producao", tokenDoProvedor: "X" }).ambienteDoToken, 1);
  confere("leitura antiga sem ambiente: carimba 2 (homologação, como a emissão lê)", normalizarConfigFiscal({ tokenDoProvedor: "X" }).ambienteDoToken, 2);
  confere("marca já gravada fica", normalizarConfigFiscal({ ambiente: 2, tokenDoProvedor: "X", ambienteDoToken: 1 }).ambienteDoToken, 1);
  confere("sem token colado, sem marca", "ambienteDoToken" in normalizarConfigFiscal({ ambiente: 1, ambienteDoToken: 1 }), false);

  // As rotas que trocam o `ambiente` do objeto (cancelar/DANFE pelo da nota,
  // contador pelo de produção) normalizam antes: o carimbo protege.
  const antiga = normalizarConfigFiscal({ ...EMITENTE, ambiente: 2, tokenDoProvedor: T });
  confere("config antiga normalizada, pedida em produção: sem token", tokenDoAmbiente({ ...antiga, ambiente: 1 }), null);
  confere("…pedida em homologação: o colado", tokenDoAmbiente({ ...antiga, ambiente: 2 }), "TOKEN-COLADO");

  // A guarda: ligada em homologação com o token colado de homologação, trocar
  // para produção deixava passar (o colado "servia" para os dois).
  const ligadaH = { ...EMITENTE, ambiente: 2, enabled: true, provedor: "focusnfe", tokenDoProvedor: T, cscId: "1", cscFinal: "AB12", emissaoLigadaEm: "2026-09-20T10:00:00.000Z" };
  const paraProducao = gravar(ligadaH, { ambiente: 1, confirmarProducao: true });
  confere(
    "ligada com o token colado de homologação: NÃO passa para produção (falta o token)",
    [paraProducao.ok, !paraProducao.ok && (paraProducao.corpo.pendencias as any[]).map((p) => p.campo)],
    [false, ["tokenDoProvedor"]]
  );
  confere("…e a emissão (config crua) concorda", campos({ ...ligadaH, ambiente: 1, ambienteDoToken: 2 }), ["tokenDoProvedor"]);
  const comTokenDeProducao = gravar(ligadaH, { ambiente: 1, confirmarProducao: true, tokenProducao: "TOKEN-P" });
  confere("colando o de produção junto, passa", comTokenDeProducao.ok && tokenDoAmbiente(comTokenDeProducao.config), "TOKEN-P");

  // Colar pelo PUT marca o ambiente.
  const colouEmH = gravar({ ...EMITENTE, ambiente: 2 }, { tokenDoProvedor: "NOVO" });
  confere("colado com a loja em homologação: marca 2", colouEmH.ok && colouEmH.config.ambienteDoToken, 2);
  const colouTrocando = gravar({ ...EMITENTE, ambiente: 2 }, { tokenDoProvedor: "NOVO", ambiente: 1 });
  confere("colado junto com a troca para produção: marca 1", colouTrocando.ok && colouTrocando.config.ambienteDoToken, 1);
  const colouDizendo = gravar({ ...EMITENTE, ambiente: 2 }, { tokenDoProvedor: "NOVO", ambienteDoToken: "producao" });
  confere("quem cola diz de qual é: marca 1 com a loja em homologação", colouDizendo.ok && colouDizendo.config.ambienteDoToken, 1);
  const soAMarca = gravar({ ...EMITENTE, ambiente: 2, tokenDoProvedor: T }, { ambienteDoToken: 1 });
  confere("a marca sozinha, sem token novo, não muda nada", soAMarca.ok && soAMarca.config.ambienteDoToken, 2);
  const staffColando = gravar({ ...EMITENTE, ambiente: 2, tokenDoProvedor: T }, { tokenDoProvedor: "DO-STAFF", ambiente: 1, ambienteDoToken: 1 }, "STAFF");
  confere(
    "STAFF não cola token nem mexe na marca",
    staffColando.ok && [decifrar(staffColando.config.tokenDoProvedor), staffColando.config.ambienteDoToken],
    ["TOKEN-COLADO", 2]
  );
}

// ─── As regras da nota que ninguém conseguia gravar ─────────────────────────
// momentoDaEmissao, taxaDeServicoNaNota, intermediadores, pixEstatico e
// entregaComoPresencial já decidiam a nota (lib/fiscal-momento,
// lib/fiscal-emissao), e o PUT as descartava em silêncio.
console.log("\n— aplicarFormularioFiscal: regras da nota");
{
  const opcoes = (papel = "FRANCHISEE") => ({ papel, cifrar: (t: string) => cifrar(t), conferir, agora: new Date("2026-09-24T21:00:00-03:00") });
  const base = { ...EMITENTE, ambiente: 2 };
  const r = aplicarFormularioFiscal(base, {
    momentoDaEmissao: "aceite", taxaDeServicoNaNota: true, pixEstatico: true, entregaComoPresencial: true,
    intermediadores: {
      IFOOD: { cnpj: null },
      "99FOOD": { cnpj: "60.112.920/0001-23", ativo: false },
      BRENDI: { cnpj: "11.222.333/0001-81", id: "loja-brendi-9" },
      WABIZ: { cnpj: "11.222.333/0001-00" }, // dígito errado: rejeição 440 em toda nota do canal
      LOJA_INVENTADA: { cnpj: "11.222.333/0001-81" },
    },
  }, opcoes());
  const c = r.ok ? r.config : ({} as any);
  confere("gravou momento, taxa de serviço, Pix estático e entrega presencial", [r.ok, c.momentoDaEmissao, c.taxaDeServicoNaNota, c.pixEstatico, c.entregaComoPresencial], [true, "aceite", true, true, true]);
  confere(
    "intermediadores: só canais conhecidos, CNPJ sem máscara e conferido, vazio = o oficial do código",
    c.intermediadores,
    { "99FOOD": { cnpj: "60112920000123", ativo: false }, BRENDI: { cnpj: "11222333000181", id: "loja-brendi-9" } }
  );
  confere("CNPJ com dígito errado não é gravado, e a resposta diz", r.ok && r.avisos.some((a) => /WABIZ/.test(a) && /não é válido/.test(a)), true);
  const invalido = aplicarFormularioFiscal({ ...base, momentoDaEmissao: "saida" }, { momentoDaEmissao: "quando der" }, opcoes());
  confere("momento que não existe: mantém o gravado e avisa", [invalido.ok && invalido.config.momentoDaEmissao, invalido.ok && invalido.avisos.length > 0], ["saida", true]);
  const staff = aplicarFormularioFiscal({ ...base, momentoDaEmissao: "saida" }, { momentoDaEmissao: "aceite", pixEstatico: true }, opcoes("STAFF"));
  confere(
    "STAFF não muda as regras da nota (são do titular com o contador)",
    staff.ok && [staff.config.momentoDaEmissao, staff.config.pixEstatico ?? null, staff.recusados],
    ["saida", null, ["momentoDaEmissao", "pixEstatico"]]
  );
  const liga = aplicarFormularioFiscal({ ...base, cscId: "1", cscFinal: "AB12", tokens: { homologacao: cifrar("TOKEN-H") } }, { enabled: true }, opcoes());
  confere("ligar carimba emissaoLigadaEm (a varredura e a retentativa não voltam no tempo)", liga.ok && liga.config.emissaoLigadaEm, "2026-09-25T00:00:00.000Z");
}

// ─── Loja cadastrada pela Focus: a emissão lê o CSC do ambiente ─────────────
console.log("\n— pendenciasParaEmitir: loja da Focus (config crua, como emitir/automática/inutilização leem)");
{
  const soH = PROVISIONADA(SO_HOMOLOGACAO);
  confere("sem `csc` gravado, só cscNaFocus: homologação pronta", campos(soH), []);
  // O /provisionar antigo espelhava o CSC de homologação em cscId/cscFinal: a
  // emissão (sem a ponte da tela) dizia "pronta" para produção sem o CSC dela.
  confere("cscId/cscFinal velhos em cima NÃO valem para produção na emissão", campos({ ...soH, ambiente: 1, cscId: "1", cscFinal: "AB12" }), ["cscId", "csc"]);
  // As rotas que emitem leem a config NORMALIZADA (o "producao" por extenso
  // da tela antiga virava NaN = homologação).
  const leem = (arquivo: string) => readFileSync(join(__dirname, "..", arquivo), "utf8");
  confere(
    "emitir, inutilizar e a automática normalizam a config antes de emitir",
    [
      leem("src/app/api/store/fiscal/emitir/route.ts").includes("normalizarConfigFiscal(loja?.fiscalConfig)"),
      leem("src/app/api/store/fiscal/inutilizacao/route.ts").includes("normalizarConfigFiscal(loja?.fiscalConfig)"),
      leem("src/lib/fiscal-automatico.ts").includes("config: configNormalizada(loja?.fiscalConfig)"),
      leem("src/lib/fiscal-automatico.ts").includes("const config = configNormalizada(loja.fiscalConfig)"),
    ],
    [true, true, true, true]
  );
  confere("legado \"producao\" por extenso, normalizado: produção (e não NaN = homologação)", normalizarConfigFiscal({ ambiente: "producao" }).ambiente, 1);
}

// ─── Item 4 (revisão 2): o Emitir de um pedido de mesa emite a nota da CONTA ─
console.log("\n— caminhoDaNotaDoPedido (POST /api/store/fiscal/emitir)");
{
  const S = "cmtngami90013mo012jox35em"; // conta do Pastel paga em Dinheiro (38,80)
  const fechada = (pedidos: PedidoDaConta[]) => ({ status: "CLOSED", pedidos });
  const rodada = (id: string, extra: Partial<PedidoDaConta> = {}): PedidoDaConta => ({ id, status: "ENTREGUE", fiscalStatus: "PENDING", fiscalInfo: null, ...extra });
  const recusa = (c: CaminhoDaNota) => (c.caminho === "recusa" ? c.corpo.error : c.caminho);

  confere("pedido comum: nota avulsa", caminhoDaNotaDoPedido({ id: "p1", tableSessionId: null }, null), { caminho: "avulsa" });
  confere("tableSessionId em branco não é mesa", caminhoDaNotaDoPedido({ id: "p1", tableSessionId: "  " }, null), { caminho: "avulsa" });
  // O caso da revisão: conta fechada, paga fora da lista automática, nada
  // gravado. Antes: 409 "pedido_de_mesa" e nenhum caminho para a nota.
  confere(
    "conta FECHADA sem nota: o botão emite a nota da conta",
    caminhoDaNotaDoPedido({ id: "p2", tableSessionId: S }, fechada([rodada("p1"), rodada("p2")])),
    { caminho: "conta", tableSessionId: S }
  );
  // A nota da conta rejeitada (NCM que faltava): a retentativa só refaz falha
  // de comunicação, então o botão é quem reemite depois de corrigir.
  const rejeitada = { fiscalStatus: "FAILED", fiscalInfo: { motivo: "rejeitada", idDaNota: `mesa-${S}`, ultimoErro: "NCM inválido" } };
  confere(
    "nota da conta REJEITADA: o botão reemite a conta",
    recusa(caminhoDaNotaDoPedido({ id: "p1", tableSessionId: S }, fechada([rodada("p1", rejeitada), rodada("p2", rejeitada)]))),
    "conta"
  );
  // Conta aberta ainda ganha pedido: a frase (e a regra) é a de lib/fiscal-momento.
  const aberta = caminhoDaNotaDoPedido({ id: "p1", tableSessionId: S }, { status: "OPEN", pedidos: [rodada("p1")] });
  confere("conta ABERTA: recusa com a frase de lib/fiscal-momento", aberta.caminho === "recusa" && [aberta.corpo.error, aberta.corpo.mensagem.endsWith("Feche a conta em Mesas e emita a nota da conta.")], ["conta_aberta", true]);
  confere("conta CLOSING (fechando) conta como aberta", recusa(caminhoDaNotaDoPedido({ id: "p1", tableSessionId: S }, { status: "CLOSING", pedidos: [rodada("p1")] })), "conta_aberta");
  confere("sessão não encontrada: recusa, nunca nota avulsa", recusa(caminhoDaNotaDoPedido({ id: "p1", tableSessionId: S }, null)), "conta_nao_encontrada");
  confere(
    "nota da mesa em processamento: recusa (emitir agora duplicaria)",
    recusa(caminhoDaNotaDoPedido({ id: "p2", tableSessionId: S }, fechada([rodada("p1", { fiscalInfo: { processando: true, idDaNota: `mesa-${S}` } }), rodada("p2")]))),
    "nota_em_processamento"
  );
  // Uma rodada com NFC-e própria (só por legado — 0 na base em 24/09/2026):
  // a automática não emite a conta e manda "emitir a nota do restante pela
  // tela"; a tela recusava também, e o caminho ficava fechado. Agora o botão
  // sai pela nota do RESTANTE (lib/fiscal-automatico → emitirNfceDaMesa manual).
  const comPropria = caminhoDaNotaDoPedido(
    { id: "p2", tableSessionId: S },
    fechada([rodada("p1", { dailyOrderNumber: 41, fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K41" } }), rodada("p2", { fiscalStatus: "FAILED" })])
  );
  confere("rodada com nota própria: o botão emite a nota do RESTANTE da conta", comPropria, { caminho: "conta", tableSessionId: S, restante: true });
  const todasComNota = caminhoDaNotaDoPedido(
    { id: "p2", tableSessionId: S },
    fechada([rodada("p1", { dailyOrderNumber: 41, fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K41" } }), rodada("p2", { dailyOrderNumber: 42, fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K42" } })])
  );
  confere(
    "todas as rodadas com nota própria: recusa (não sobra nada), dizendo quais",
    todasComNota.caminho === "recusa" && [todasComNota.corpo.error, /#41, #42/.test(todasComNota.corpo.mensagem)],
    ["mesa_toda_com_nota", true]
  );
  confere(
    "a conta já tem nota (reemissão -2 autorizada): recusa ja_emitida",
    recusa(caminhoDaNotaDoPedido({ id: "p2", tableSessionId: S }, fechada([rodada("p1", { fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K2", idDaNota: `mesa-${S}-2` } }), rodada("p2")]))),
    "ja_emitida"
  );
  confere(
    "…e a nota própria CANCELADA libera a nota da conta",
    recusa(caminhoDaNotaDoPedido({ id: "p2", tableSessionId: S }, fechada([rodada("p1", { fiscalStatus: "CANCELED", fiscalInfo: { nfceKey: "K41" } }), rodada("p2")]))),
    "conta"
  );
  // A nota da conta cancelada pela loja: a ref `mesa-<sessão>` está queimada
  // no provedor, e a reemissão sai com ref nova (`mesa-<sessão>-2`).
  confere(
    "nota da CONTA cancelada: o botão reemite a conta (ref nova)",
    caminhoDaNotaDoPedido({ id: "p1", tableSessionId: S }, fechada([rodada("p1", { fiscalStatus: "CANCELED", fiscalInfo: { nfceKey: "K", idDaNota: `mesa-${S}` } })])),
    { caminho: "conta", tableSessionId: S, reemissao: true }
  );
  confere(
    "rodada cancelada (pedido) não conta: a nota própria dela não trava a conta",
    recusa(caminhoDaNotaDoPedido({ id: "p2", tableSessionId: S }, fechada([rodada("p1", { status: "CANCELADO", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K" } }), rodada("p2")]))),
    "conta"
  );

  // A resposta, a partir do que emitirNfceDaMesa gravou.
  const gravado = {
    fiscalStatus: "EMITTED",
    fiscalInfo: { nfceKey: "CHAVE", nfceNumber: 7, serie: 1, protocol: "P", ambiente: 2, pdfUrl: "https://homologacao.focusnfe.com.br/x.pdf", idDaNota: `mesa-${S}`, notaDaConta: { tableSessionId: S, pedidos: ["p1", "p2"] } },
  };
  const ok = respostaDaNotaDaConta({ acao: "emitida", motivo: "CHAVE" }, gravado);
  confere(
    "emitida: 200 com a chave, os pedidos cobertos e o aviso de homologação",
    [ok.status, ok.corpo.success, ok.corpo.notaDaConta, ok.corpo.pedidos, ok.corpo.chaveDeAcesso, ok.corpo.numero, typeof ok.corpo.aviso],
    [200, true, true, ["p1", "p2"], "CHAVE", 7, "string"]
  );
  confere("processando: 202", respostaDaNotaDaConta({ acao: "processando", motivo: "SEFAZ lenta" }, null).status, 202);
  const falhouComunicacao = respostaDaNotaDaConta({ acao: "falhou", motivo: "fora do ar" }, { fiscalStatus: "FAILED", fiscalInfo: { motivo: "erro_de_comunicacao" } });
  confere("falha de comunicação: 502", [falhouComunicacao.status, falhouComunicacao.corpo.error], [502, "erro_de_comunicacao"]);
  const rejeitou = respostaDaNotaDaConta({ acao: "falhou", motivo: "Rejeição 778: NCM inexistente" }, { fiscalStatus: "FAILED", fiscalInfo: { motivo: "rejeitada" } });
  confere("rejeição: 409 com o motivo da SEFAZ", [rejeitou.status, String(rejeitou.corpo.mensagem).includes("NCM inexistente")], [409, true]);
  const totalZero = respostaDaNotaDaConta({ acao: "ignorado", motivo: "O total da conta ficou zero — não há venda para a nota." }, null);
  confere(
    "ignorado (ex.: total zero): 409 com o motivo, sem ponto dobrado",
    [totalZero.status, totalZero.corpo.mensagem],
    [409, "A nota da conta desta mesa não saiu: O total da conta ficou zero — não há venda para a nota."]
  );

  // Uma fonte só: a regra "é mesa?" e a frase de conta aberta são as de
  // lib/fiscal-momento; a função duplicada daqui (recusaDaNotaAvulsa) saiu.
  const lib = readFileSync(join(__dirname, "../src/lib/fiscal-config.ts"), "utf8");
  confere("fiscal-config usa pedidoDeMesaExigeNotaDaConta e não tem mais recusaDaNotaAvulsa", [lib.includes("pedidoDeMesaExigeNotaDaConta(pedido)"), lib.includes("function recusaDaNotaAvulsa")], [true, false]);

  // Ordem na rota: já emitida → caminho (mesa) → nota da conta OU avulsa.
  const rota = readFileSync(join(__dirname, "../src/app/api/store/fiscal/emitir/route.ts"), "utf8");
  const posPost = rota.indexOf("export async function POST");
  const jaEmitida = rota.indexOf('error: "ja_emitida"', posPost);
  const decide = rota.indexOf("caminhoDaNotaDoPedido(order", posPost);
  const daConta = rota.indexOf("emitirNfceDaMesa(caminho.tableSessionId, { manual: true })", posPost);
  // A nota avulsa é a de lib/fiscal-automatico (pedidoParaNota + a gravação da
  // automática), não mais um objeto montado à mão na rota.
  const avulsa = rota.indexOf("emitirNfceDoPedidoPelaTela(", posPost);
  confere("rota: a nota avulsa não é mais montada à mão (nada de `valorTotal: order.totalAmount`)", rota.includes("valorTotal: order.totalAmount"), false);
  confere("rota: já emitida → caminho → conta (manual) → avulsa, nessa ordem", [jaEmitida > 0, decide > jaEmitida, daConta > decide, avulsa > daConta], [true, true, true, true]);
}

// ─── Revisão 2: o Salvar do STAFF só lista o que ele de fato mudou ──────────
console.log("\n— STAFF: Salvar Dados sem mudança não lista campo nenhum");
{
  const opcoes = { papel: "STAFF", cifrar: (t: string) => cifrar(t), conferir, agora: new Date("2026-09-24T21:00:00-03:00") };
  // O que a tela manda em "Salvar Dados" (store/fiscal/page.tsx →
  // saveFiscalConfig): o estado inicial dela com o GET (retratoDoCadastro)
  // por cima — o campo nunca gravado vai como "".
  const payloadDaTela = (bruto: unknown) => {
    const inicial = { cnpj: "", inscricaoEstadual: "", razaoSocial: "", nomeFantasia: "", regimeTributario: null, logradouro: "", numero: "", complemento: "", bairro: "", municipio: "", codigoMunicipio: "", uf: "", cep: "", serie: 1, provedor: null, cscId: "" };
    const c: Record<string, any> = { ...inicial, ...retratoDoCadastro(bruto, { storeName: "Loja", cpfCnpj: "" }).config };
    const campos = ["cnpj", "inscricaoEstadual", "razaoSocial", "nomeFantasia", "regimeTributario", "logradouro", "numero", "complemento", "bairro", "municipio", "codigoMunicipio", "uf", "cep", "serie", "provedor", "cscId"];
    return JSON.parse(JSON.stringify(Object.fromEntries(campos.map((k) => [k, k === "complemento" ? c[k] || "" : c[k]]))));
  };
  const salvar = (bruto: unknown, mudar: Record<string, unknown> = {}) => {
    const r = aplicarFormularioFiscal(bruto, { ...payloadDaTela(bruto), ...mudar }, opcoes);
    if (!r.ok) throw new Error(JSON.stringify(r.corpo));
    return r;
  };

  // Pastel da Paulista e NIK: fiscalConfig null (24/09/2026). Antes: 13 campos
  // "mantidos como estavam", a série entre eles — e a série 1 era gravada.
  const nula = salvar(null);
  confere("fiscalConfig null: nenhum campo recusado", nula.recusados, []);
  confere("…e o que se grava é o que a tela mostrou (série 1, ambiente 2, formas padrão)", [nula.config.serie, nula.config.ambiente, nula.config.autoEmitPaymentMethods], [1, 2, [...FORMAS_AUTOMATICAS_PADRAO]]);
  confere(
    "a comparação antiga (contra o gravado cru) acusava a série",
    JSON.stringify(normalizarConfigFiscal(null).serie ?? null) !== JSON.stringify(payloadDaTela(null).serie ?? null),
    true
  );
  // Hakim Centro como está gravada (24/09/2026).
  const hakim = {
    ie: "", cnpj: "55878184000189", enabled: false, ambiente: "homologacao", cstDefault: "102", ncmDefault: "2106.90.90",
    razaoSocial: "", nomeFantasia: "", regimeTributario: "Simples Nacional",
    autoEmitPaymentMethods: ["PIX", "CREDITO_ONLINE", "CREDIT_CARD", "DEBIT_CARD", "VOUCHER"],
  };
  confere("Hakim: nenhum campo recusado", salvar(hakim).recusados, []);

  // O que o STAFF de fato tenta mudar continua recusado e intacto.
  const trocaCnpj = salvar(hakim, { cnpj: "11222333000181" });
  confere("STAFF trocando o CNPJ: recusado, e o CNPJ fica", [trocaCnpj.recusados, trocaCnpj.config.cnpj], [["cnpj"], "55878184000189"]);
  const apagaCnpj = salvar(hakim, { cnpj: "" });
  confere("STAFF apagando o CNPJ gravado: recusado", [apagaCnpj.recusados, apagaCnpj.config.cnpj], [["cnpj"], "55878184000189"]);
  const outraSerie = salvar(null, { serie: 2 });
  confere("STAFF mandando série 2 (nunca gravada): recusado, grava a 1", [outraSerie.recusados, outraSerie.config.serie], [["serie"], 1]);
  confere("STAFF mandando \"1\" (texto) na série 1: não é mudança", salvar(null, { serie: "1" }).recusados, []);
  const desliga = aplicarFormularioFiscal(null, { enabled: false }, opcoes);
  confere("STAFF desligando a emissão nunca ligada: não é mudança", desliga.ok && desliga.recusados, []);
  const liga = aplicarFormularioFiscal(null, { enabled: true }, opcoes);
  confere("STAFF ligando: continua recusado", liga.ok && [liga.recusados, liga.config.enabled], [["enabled"], undefined]);
}

// ─── Item 3: acessibilidade da tela fiscal (conferência estática do JSX) ────
console.log("\n— acessibilidade da tela fiscal");
{
  const tela = readFileSync(join(__dirname, "../src/app/store/fiscal/page.tsx"), "utf8");
  const ids = [
    // Dados da empresa e endereço
    "fiscal-cnpj", "fiscal-ie", "fiscal-razao-social", "fiscal-nome-fantasia", "fiscal-regime",
    "fiscal-logradouro", "fiscal-numero", "fiscal-bairro", "fiscal-cep", "fiscal-municipio", "fiscal-codigo-ibge", "fiscal-uf",
    // Cadastro na Focus: arquivo, senha, CSCs e série
    "fiscal-certificado", "fiscal-senha-certificado", "fiscal-id-csc-homologacao", "fiscal-csc-homologacao",
    "fiscal-id-csc-producao", "fiscal-csc-producao", "fiscal-serie",
    // Modo manual: provedor, tokens e CSC
    "fiscal-provedor", "fiscal-token-homologacao", "fiscal-token-producao", "fiscal-csc-id-manual", "fiscal-csc-manual",
  ];
  const semPar = ids.filter((id) => tela.split(`htmlFor="${id}"`).length !== 2 || tela.split(`id="${id}"`).length !== 2);
  confere("cada rótulo tem htmlFor, e cada campo o id correspondente (um só)", semPar, []);
  // Todo campo de senha e o de arquivo têm id — e portanto o rótulo acima como nome.
  const senhasEArquivo = [...tela.matchAll(/<input\b[^>]*?type="(password|file)"[^>]*>/g)].map((m) => m[0]);
  const semId = senhasEArquivo.filter((tag) => !/\bid="fiscal-[^"]+"/.test(tag) && !/aria-label=/.test(tag));
  // 7 = o arquivo do certificado, a senha dele, os 2 CSCs do cadastro, os 2
  // tokens e o CSC do modo manual. Se o número mudar, este teste precisa olhar.
  confere("nenhum campo de senha ou arquivo sem nome acessível", [senhasEArquivo.length, semId.length], [7, 0]);
  confere("botões de ambiente com aria-pressed", /aria-pressed=\{ativo\}/.test(tela), true);
  confere("grupo dos ambientes nomeado", tela.includes('role="group" aria-label="Ambiente da emissão"'), true);
  // WCAG 2.5.3 (rótulo no nome): o nome acessível do "Usar esta" começa pelo
  // texto visível — "clicar Usar esta" por voz precisa achar o botão.
  const nomeDoUsar = tela.match(/aria-label=\{`([^`]*)`\}\s*\n[^\n]*\n\s*>\s*\n\s*Usar esta\s*\n/);
  confere("\"Usar esta\": o nome acessível começa pelo texto visível", Boolean(nomeDoUsar && nomeDoUsar[1].startsWith("Usar esta")), true);
  confere("campo de CNPJ mostra o gravado, não o documento da loja", tela.includes("value={fiscalConfig.cnpj || cpfCnpj}"), false);
  confere("campo de nome fantasia mostra o gravado, não o nome da loja", tela.includes("value={fiscalConfig.nomeFantasia || storeName}"), false);
}

// ─── A nota de um pedido (cancelar e consultar) ─────────────────────────────
console.log("\n— notaDoPedido");
{
  const comum = notaDoPedido({ id: "p1", fiscalInfo: { nfceKey: "K", ambiente: 2 } });
  confere("pedido comum: a ref é o próprio pedido", comum, { idDaNota: "p1", ambiente: 2, pedidos: ["p1"], daConta: false });
  const mesa = notaDoPedido({ id: "p2", fiscalInfo: { nfceKey: "K", ambiente: 1, idDaNota: "mesa-S1", notaDaConta: { tableSessionId: "S1", pedidos: ["p1", "p2", "p3"] } } });
  confere("conta da mesa: a ref é a da conta, e cobre todos os pedidos", mesa, { idDaNota: "mesa-S1", ambiente: 1, pedidos: ["p2", "p1", "p3"], daConta: true });
  confere("sem ambiente gravado: null (vale o da loja)", notaDoPedido({ id: "p1", fiscalInfo: {} }).ambiente, null);
  confere("fiscalInfo vazio ou lixo", [notaDoPedido({ id: "p1", fiscalInfo: null }).idDaNota, notaDoPedido({ id: "p1", fiscalInfo: "x" }).pedidos], ["p1", ["p1"]]);
}

// ─── Corpo do POST /v2/empresas ─────────────────────────────────────────────
console.log("\n— montarCorpoDaEmpresa");
{
  const SENHA = "Senh@DoCert!";
  const CSC_H = "HOMOLOGA1234567890ABCDEF12345678";
  const CSC_P = "PRODUCAO9876543210FEDCBA98765432";
  const PFX = Buffer.concat([Buffer.from([0x30, 0x82, 0x0a, 0x00]), Buffer.alloc(3000, 7)]).toString("base64");
  const corpo = montarCorpoDaEmpresa({
    emitente: {
      cnpj: "55.878.184/0001-89", inscricaoEstadual: "07.123.456", razaoSocial: " Hakim Centro Ltda ", nomeFantasia: "",
      regimeTributario: 1, logradouro: "Rua A", numero: "S/N", complemento: "", bairro: "Centro",
      municipio: "Rio das Ostras", uf: "rj", cep: "28890-000", email: "loja@exemplo.com", telefone: "(22) 99999-0000",
    },
    certificado: { base64: PFX, senha: SENHA },
    csc: { homologacao: { id: "000001", codigo: CSC_H }, producao: { id: "2", codigo: CSC_P } },
  });
  confere("nome = razão social sem espaços", corpo.nome, "Hakim Centro Ltda");
  confere("nome fantasia vazio usa a razão social", corpo.nome_fantasia, "Hakim Centro Ltda");
  confere("CNPJ só com os caracteres do número", corpo.cnpj, "55878184000189");
  confere("IE com zero à esquerda preservado (texto, não inteiro)", corpo.inscricao_estadual, "07123456");
  confere("regime tributário numérico", corpo.regime_tributario, 1);
  confere("número \"S/N\" vai como está", corpo.numero, "S/N");
  confere("CEP só dígitos", corpo.cep, "28890000");
  confere("UF maiúscula", corpo.uf, "RJ");
  confere("complemento vazio não vai", "complemento" in corpo, false);
  confere("telefone só dígitos", corpo.telefone, "22999990000");
  confere("habilita NFC-e", corpo.habilita_nfce, true);
  confere("discrimina impostos (Lei 12.741)", corpo.discrimina_impostos, true);
  confere("contingência offline desligada", corpo.habilita_contingencia_offline_nfce, false);
  confere("não mexe na NF-e da empresa", "habilita_nfe" in corpo, false);
  confere("certificado vai com senha e é específico desta empresa", [corpo.arquivo_certificado_base64 === PFX, corpo.senha_certificado, corpo.certificado_especifico], [true, SENHA, true]);
  confere("ID do CSC como inteiro (000001 = 1)", [corpo.id_token_nfce_homologacao, corpo.id_token_nfce_producao], [1, 2]);
  confere("CSCs nos campos certos", [corpo.csc_nfce_homologacao, corpo.csc_nfce_producao], [CSC_H, CSC_P]);

  const paraLog = JSON.stringify(corpoSemSegredos(corpo));
  confere("versão de log não tem a senha", paraLog.includes(SENHA), false);
  confere("versão de log não tem o .pfx", paraLog.includes(PFX.slice(0, 40)), false);
  confere("versão de log não tem os CSCs", [paraLog.includes(CSC_H), paraLog.includes(CSC_P)], [false, false]);
  confere("versão de log mantém o resto", JSON.parse(paraLog).cnpj, "55878184000189");
  confere("corpoSemSegredos não altera o corpo original", corpo.senha_certificado, SENHA);

  const semCert = montarCorpoDaEmpresa({
    emitente: { cnpj: "55878184000189", inscricaoEstadual: "12345678", razaoSocial: "X", regimeTributario: 1, logradouro: "R", numero: "1", bairro: "B", municipio: "M", uf: "RJ", cep: "28890000" },
    csc: { homologacao: { id: "1", codigo: "" } },
  });
  confere("atualização sem certificado não manda campos de certificado", ["arquivo_certificado_base64" in semCert, "senha_certificado" in semCert], [false, false]);
  confere("CSC incompleto não vai", "csc_nfce_homologacao" in semCert, false);
  confere("CNPJ alfanumérico mantém as letras", montarCorpoDaEmpresa({ emitente: { cnpj: "12.abc.345/01de-35" } as any }).cnpj, "12ABC34501DE35");

  confere("final do CSC", finalDoCsc(" abcdef1234xyz9 "), "XYZ9");
}

// ─── Conferência antes de ir à Focus ────────────────────────────────────────
console.log("\n— conferirPedidoDeCadastro");
{
  const pfx = Buffer.concat([Buffer.from([0x30, 0x82]), Buffer.alloc(2000, 1)]).toString("base64");
  const csc = { homologacao: { id: "1", codigo: "ABCDEF123456" } };
  const campos = (p: any, exigir = true) => conferirPedidoDeCadastro(p, { exigirCertificado: exigir }).map((x) => x.campo);
  confere("pedido completo passa", campos({ certificado: { base64: pfx, senha: "x" }, csc }), []);
  confere("criar sem certificado: pede o arquivo", campos({ csc }), ["certificado"]);
  confere("atualizar sem certificado: tudo bem", campos({ csc }, false), []);
  confere("certificado sem senha", campos({ certificado: { base64: pfx, senha: "" }, csc }), ["senhaCertificado"]);
  confere("arquivo que não é PKCS#12 (PDF)", campos({ certificado: { base64: Buffer.from("%PDF-1.4 ...").toString("base64"), senha: "x" }, csc }), ["certificado"]);
  confere("arquivo .cer em texto", campos({ certificado: { base64: Buffer.from("-----BEGIN CERTIFICATE-----").toString("base64"), senha: "x" }, csc }), ["certificado"]);
  confere("arquivo acima de 50 KB", campos({ certificado: { base64: Buffer.concat([Buffer.from([0x30]), Buffer.alloc(60 * 1024)]).toString("base64"), senha: "x" }, csc }), ["certificado"]);
  confere("base64 corrompido", campos({ certificado: { base64: "@@@não é base64@@@", senha: "x" }, csc }), ["certificado"]);
  confere("criar sem nenhum CSC", campos({ certificado: { base64: pfx, senha: "x" } }), ["csc"]);
  confere("CSC sem o ID", campos({ certificado: { base64: pfx, senha: "x" }, csc: { producao: { id: "", codigo: "ABCDEF123456" } } }), ["csc.producao", "csc"]);
  confere("ID do CSC com letras", campos({ certificado: { base64: pfx, senha: "x" }, csc: { homologacao: { id: "abc", codigo: "ABCDEF123456" } } }), ["csc.homologacao.id"]);
  confere("CSC com espaço", campos({ certificado: { base64: pfx, senha: "x" }, csc: { homologacao: { id: "1", codigo: "ABC DEF 123" } } }), ["csc.homologacao.codigo"]);
}

// ─── Erros da Focus em português ────────────────────────────────────────────
console.log("\n— traduzirErroDaFocus");
{
  const erro422 = (mensagem: string) => ({ codigo: "erro_validacao", mensagem: "Erro de validação", erros: [{ codigo: "erro_validacao", mensagem, campo: "arquivo_certificado_base64" }] });
  // As três mensagens são as do exemplo oficial da doc (criar_empresa, 422).
  const senha = traduzirErroDaFocus(422, erro422("Arquivo certificado base64 Houve um erro ao instalar o certificado, verifique se a senha está correto e o arquivo está no formato PFX ou P12 codificado em base64"));
  const outroCnpj = traduzirErroDaFocus(422, erro422("Arquivo certificado base64 Certificado não pertence ao CNPJ informado"));
  const vencido = traduzirErroDaFocus(422, erro422("Arquivo certificado base64 Certificado com prazo de validade vencido"));
  confere("senha errada fala da senha", /senha/i.test(senha), true);
  confere("certificado de outro CNPJ", /outro CNPJ/.test(outroCnpj), true);
  confere("certificado vencido", /vencido/.test(vencido), true);
  confere("401 é problema do FireHub, não do lojista", /suporte do FireHub/.test(traduzirErroDaFocus(401, { mensagem: "HTTP Basic: Access denied" })), true);
  confere("empresa de outra conta", /outra conta/.test(traduzirErroDaFocus(422, { codigo: "permissao_negada", mensagem: "Empresa não encontrada como propriedade da revenda" })), true);
  confere("fora do ar", /fora do ar/.test(traduzirErroDaFocus(503, null)), true);
  confere("campo comum ganha nome legível", traduzirErroDaFocus(422, { erros: [{ campo: "inscricao_estadual", mensagem: "não é válida" }] }), "Inscrição Estadual: não é válida");

  // O 400 da Focus ECOA o corpo recebido. Nada dele pode voltar ao lojista.
  const SENHA = "SenhaSecreta#2026";
  const eco = { erros: [{ codigo: "parametros_invalidos", mensagem: `Existe um problema no JSON recebido: 822: unexpected token at '{"senha_certificado":"${SENHA}","arquivo_certificado_base64":"MIIKAgEDMIIJvgYJKoZIhvcNAQcBoIIJrwSCCasweDCCCaUwggX${"A".repeat(80)}"` }] };
  const msg400 = traduzirErroDaFocus(400, eco, [SENHA]);
  confere("400 com eco: sem senha na mensagem", msg400.includes(SENHA), false);
  confere("400 com eco: sem pedaço do .pfx", msg400.includes("MIIKAgEDMIIJvgYJ"), false);
  const msg422 = traduzirErroDaFocus(422, { erros: [{ campo: "x", mensagem: `valor ${SENHA} inválido` }] }, [SENHA]);
  confere("422 com a senha citada: senha mascarada", msg422.includes(SENHA), false);
  confere("semSegredos corta base64 longo", semSegredos(`abc ${"Q".repeat(60)} def`), "abc […] def");
}

// ─── Resposta da Focus e conta de revenda ───────────────────────────────────
console.log("\n— lerEmpresa / revenda");
{
  // Formato do exemplo oficial (EmpresaResponse).
  const e = lerEmpresa({ id: 123, token_producao: "TP", token_homologacao: "TH", certificado_valido_ate: "2027-04-01T15:03:25-03:00", certificado_cnpj: "55878184000189", habilita_nfce: true });
  confere("lê id, tokens e validade", e, { id: "123", tokenProducao: "TP", tokenHomologacao: "TH", certificadoValidoAte: "2027-04-01T15:03:25-03:00", certificadoCnpj: "55878184000189", habilitaNfce: true });
  confere("token vazio vira null (o exemplo da doc traz \"\")", lerEmpresa({ id: 1, token_producao: "", token_homologacao: "" }).tokenProducao, null);

  const antes = process.env.FOCUS_NFE_TOKEN_REVENDA;
  delete process.env.FOCUS_NFE_TOKEN_REVENDA;
  confere("sem FOCUS_NFE_TOKEN_REVENDA não há revenda", tokenDeRevenda(), null);
  confere("mensagem diz com todas as letras", /o FireHub ainda não tem conta de revenda na Focus/i.test(SEM_CONTA_DE_REVENDA), true);
  process.env.FOCUS_NFE_TOKEN_REVENDA = "  rev123  ";
  confere("com a variável, usa o token sem espaços", tokenDeRevenda(), "rev123");
  if (antes === undefined) delete process.env.FOCUS_NFE_TOKEN_REVENDA;
  else process.env.FOCUS_NFE_TOKEN_REVENDA = antes;
}

// ─── Validade do certificado ────────────────────────────────────────────────
console.log("\n— situacaoDoCertificado");
{
  const hoje = new Date("2026-09-24T12:00:00-03:00");
  confere("vencido", situacaoDoCertificado("2026-09-01T00:00:00-03:00", hoje)?.situacao, "vencido");
  confere("vence em 10 dias: alerta", situacaoDoCertificado("2026-10-04T12:00:00-03:00", hoje), { validoAte: "2026-10-04T12:00:00-03:00", dias: 10, situacao: "vence_em_breve" });
  confere("vence em 30 dias: ainda alerta", situacaoDoCertificado("2026-10-24T12:00:00-03:00", hoje)?.situacao, "vence_em_breve");
  confere("vence em 100 dias: ok", situacaoDoCertificado("2027-01-02T12:00:00-03:00", hoje)?.situacao, "ok");
  confere("sem data ou data inválida: null", [situacaoDoCertificado(null, hoje), situacaoDoCertificado("não é data", hoje)], [null, null]);
}

// ─── Revisão 2: o POST /api/store/fiscal/emitir rodando de verdade ──────────
//
// A rota inteira (e a emitirNfceDaMesa de lib/fiscal-automatico que ela chama)
// contra um banco FALSO em memória e um Focus FALSO (fetch interceptado). A
// sessão do next-auth é trocada no cache do `require`. Nada vai ao banco de
// produção nem à Focus: o `globalThis.prisma` falso é posto ANTES de qualquer
// módulo que importe lib/prisma ser carregado.
async function testeDaRotaDeEmitir() {
  console.log("\n— POST /api/store/fiscal/emitir (banco e Focus falsos)");
  const { Prisma } = require("@prisma/client");
  type Linha = Record<string, any>;
  const db: { user: Linha[]; customerOrder: Linha[]; tableSession: Linha[] } = { user: [], customerOrder: [], tableSession: [] };
  const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const ehAnyNull = (v: unknown) => v === Prisma.AnyNull || v === Prisma.DbNull || v === Prisma.JsonNull;
  const casaCampo = (valor: any, filtro: any): boolean => {
    if (filtro === null) return valor == null;
    if (typeof filtro !== "object" || Array.isArray(filtro)) return igual(valor, filtro);
    if (ehAnyNull(filtro)) return valor == null;
    for (const [op, alvo] of Object.entries(filtro)) {
      if (op === "equals") { if (ehAnyNull(alvo) ? valor != null : !igual(valor, alvo)) return false; }
      else if (op === "in") { if (!(alvo as unknown[]).includes(valor)) return false; }
      else if (op === "notIn") { if (valor == null || (alvo as unknown[]).includes(valor)) return false; }
      else throw new Error(`operador não suportado no banco falso: ${op}`);
    }
    return true;
  };
  const casa = (linha: Linha, where: any): boolean =>
    Object.entries(where ?? {}).every(([k, v]) =>
      k === "OR" ? (v as any[]).some((w) => casa(linha, w)) : k === "AND" ? (v as any[]).every((w) => casa(linha, w)) : k === "NOT" ? !casa(linha, v) : casaCampo(linha[k], v)
    );
  const copia = <T,>(v: T): T => (v == null ? v : structuredClone(v));
  const projetar = (linha: Linha, modelo: keyof typeof db): Linha => {
    const saida = copia(linha);
    if (modelo === "tableSession") {
      saida.orders = db.customerOrder
        .filter((o) => o.tableSessionId === linha.id)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((o) => copia(o));
    }
    return saida;
  };
  const delegado = (modelo: keyof typeof db) => ({
    findUnique: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, modelo) : null; },
    findFirst: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where)); return l ? projetar(l, modelo) : null; },
    findMany: async (a: any) => db[modelo].filter((x) => casa(x, a.where)).map((l) => projetar(l, modelo)),
    update: async (a: any) => { const l = db[modelo].find((x) => casa(x, a.where))!; Object.assign(l, copia(a.data)); return copia(l); },
    updateMany: async (a: any) => { const alvos = db[modelo].filter((x) => casa(x, a.where)); for (const l of alvos) Object.assign(l, copia(a.data)); return { count: alvos.length }; },
  });
  (globalThis as any).prisma = { user: delegado("user"), customerOrder: delegado("customerOrder"), tableSession: delegado("tableSession") };
  process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

  // Focus falso: autoriza toda nota e guarda o que recebeu. `noPost` põe uma
  // ref em contingência off-line; `naConsulta` diz o que o GET da ref responde
  // (a nota some — 404 —, o provedor cai — 500 —, continua em contingência ou
  // foi efetivada). A chave de uma ref é a mesma no POST e nas consultas.
  const enviadas: { ref: string; corpo: any }[] = [];
  const noPost = new Map<string, "contingencia">();
  const naConsulta = new Map<string, "some" | "cai" | "contingencia" | "autoriza">();
  const numeroDaRef = new Map<string, number>();
  let numero = 500;
  const autorizada = (ref: string, contingencia: boolean) => {
    const n = numeroDaRef.get(ref)!;
    return new Response(
      JSON.stringify({
        status: "autorizado", chave_nfe: "NFe" + String(n).padStart(44, "3"), numero: n, serie: 1, protocolo: "1330000" + n,
        data_emissao: new Date().toISOString(), caminho_danfe: `/arquivos/danfe-${n}.html`, caminho_xml_nota_fiscal: `/arquivos/${n}.xml`,
        ...(contingencia ? { contingencia_offline: true, contingencia_offline_efetivada: false } : {}),
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  };
  (globalThis as any).fetch = async (url: string, init: any = {}) => {
    const ref = decodeURIComponent(String(url).match(/nfce(?:\?ref=|\/)([^?&]+)/)?.[1] || "");
    const metodo = String(init.method || "GET");
    if (metodo === "GET") {
      const r = naConsulta.get(ref);
      if (r === "some" || !numeroDaRef.has(ref)) return new Response(JSON.stringify({ codigo: "nao_encontrado" }), { status: 404 });
      if (r === "contingencia" || r === "autoriza") return autorizada(ref, r === "contingencia");
      return new Response(JSON.stringify({ codigo: "erro_interno" }), { status: 500 });
    }
    if (metodo !== "POST") throw new Error(`o teste não esperava ${metodo} ${url}`);
    enviadas.push({ ref, corpo: JSON.parse(init.body) });
    numeroDaRef.set(ref, ++numero);
    return autorizada(ref, noPost.get(ref) === "contingencia");
  };

  // Sessão: o dono da loja, sem next-auth de verdade (ele leria os cookies da requisição).
  const stub = (caminho: string, exports: Record<string, unknown>) => {
    const arquivo = require.resolve(caminho);
    require.cache[arquivo] = { id: arquivo, filename: arquivo, loaded: true, exports } as any;
  };
  stub("next-auth/next", { getServerSession: async () => ({ user: { email: "dono@loja.teste" } }) });
  stub("../src/lib/auth", { authOptions: {} });

  const LOJA = "loja-1";
  db.user.push({
    id: LOJA, email: "dono@loja.teste", ownerId: null, role: "FRANCHISEE", storeName: "Loja Teste", name: "Dono",
    ifoodMerchantId: null, food99MerchantId: null,
    fiscalConfig: {
      enabled: true, provedor: "focusnfe", tokenDoProvedor: "token-de-teste", ambienteDoToken: 2, ambiente: 2, serie: 1,
      cnpj: "11.222.333/0001-81", inscricaoEstadual: "12.345.678", razaoSocial: "LOJA TESTE LTDA", regimeTributario: 1,
      logradouro: "Rua A", numero: "100", bairro: "Centro", municipio: "Macaé", codigoMunicipio: "3302403",
      uf: "RJ", cep: "27910-000", cscId: "1", cscFinal: "AB12", temCertificado: true,
      // A lista PADRÃO: Dinheiro e Voucher ficam de fora da automática.
      autoEmitPaymentMethods: [...FORMAS_AUTOMATICAS_PADRAO],
    },
  });
  const produto = { id: "pz", name: "Pastel", ncm: "19059090", cfop: "5102", csosn: "102", origem: "0" };
  let seq = 0;
  const pedido = (p: Partial<Linha>) => {
    const valor = Number(p.totalAmount ?? 20);
    const o: Linha = {
      id: `p${++seq}`, dailyOrderNumber: seq, franchiseeId: LOJA, status: "ENTREGUE", deliveryType: "MESA", tableSessionId: null,
      paymentMethod: "N/A", paymentMethods: null, totalAmount: valor, deliveryFee: 0, discountTotal: 0, customerCpfCnpj: null,
      customerName: "Mesa 4", fiscalStatus: "PENDING", fiscalInfo: null, createdAt: new Date(Date.UTC(2026, 8, 24, 12, seq)),
      items: [{ id: `i${seq}`, productName: "Pastel", quantity: 1, price: valor, menuProduct: produto }], ...p,
    };
    db.customerOrder.push(o);
    return o;
  };
  const conta = (id: string, status: string, pagamentos: { method: string; amount: number }[]) =>
    db.tableSession.push({ id, franchiseeId: LOJA, status, customerName: "Mesa 4", serviceFee: 0, waiterTip: 0, paymentMethods: pagamentos });
  const doBanco = (id: string) => db.customerOrder.find((o) => o.id === id)!;

  const { POST, GET } = require("../src/app/api/store/fiscal/emitir/route");
  const emitir = async (orderId: string, cpfCnpj?: string) => {
    const res: Response = await POST(new Request("http://teste/api/store/fiscal/emitir", { method: "POST", body: JSON.stringify({ orderId, cpfCnpj }) }));
    return { status: res.status, dados: await res.json() };
  };
  // "Consultar situação" da tela (GET da mesma rota).
  const consultar = async (orderId: string) => {
    const res: Response = await GET(new Request(`http://teste/api/store/fiscal/emitir?orderId=${orderId}`));
    return { status: res.status, dados: await res.json() };
  };

  // 1. O caso da revisão: conta FECHADA paga em Dinheiro (fora da lista
  //    padrão), como a cmtngami90013mo012jox35em do Pastel. O fechamento e a
  //    varredura não emitem; antes o botão respondia 409 "pedido_de_mesa".
  conta("S1", "CLOSED", [{ method: "Dinheiro", amount: 38.8 }]);
  const r1 = pedido({ tableSessionId: "S1", totalAmount: 20 });
  const r2 = pedido({ tableSessionId: "S1", totalAmount: 18.8 });
  const CPF = "52998224725";
  const e1 = await emitir(r2.id, CPF);
  confere("conta em Dinheiro: 200, nota da CONTA com as duas rodadas", [e1.status, e1.dados.notaDaConta, e1.dados.pedidos], [200, true, [r1.id, r2.id]]);
  confere("…uma nota só, com a ref da conta", enviadas.map((x) => x.ref), ["firehub-mesa-S1"]);
  confere(
    "…com o Dinheiro da conta (não o \"N/A\" da rodada) e o total da conta",
    [enviadas[0]?.corpo.formas_pagamento?.map((f: any) => f.forma_pagamento), Number(enviadas[0]?.corpo.valor_total)],
    [["01"], 38.8]
  );
  confere("…com o CPF digitado no modal", enviadas[0]?.corpo.cpf_destinatario, CPF);
  confere("…e as duas rodadas ficam EMITTED com a mesma chave", [doBanco(r1.id).fiscalStatus, doBanco(r2.id).fiscalStatus, doBanco(r1.id).fiscalInfo?.nfceKey === e1.dados.chaveDeAcesso], ["EMITTED", "EMITTED", true]);
  confere("…pedida à mão (não conta como automática)", doBanco(r1.id).fiscalInfo?.emitidaAutomaticamente, false);
  const e1b = await emitir(r1.id);
  confere("a outra rodada depois: 409 já emitida, sem nota nova", [e1b.status, e1b.dados.error, enviadas.length], [409, "ja_emitida", 1]);

  // 2. Conta ABERTA: ainda pode ganhar pedido.
  conta("S2", "OPEN", []);
  const r3 = pedido({ tableSessionId: "S2" });
  const e2 = await emitir(r3.id);
  confere("conta aberta: 409 conta_aberta, nada enviado", [e2.status, e2.dados.error, enviadas.length], [409, "conta_aberta", 1]);

  // 3. Nota da conta REJEITADA (NCM corrigido depois): o botão reemite a conta.
  conta("S3", "CLOSED", [{ method: "Voucher", amount: 40 }]);
  const rejeitada = { fiscalStatus: "FAILED", fiscalInfo: { motivo: "rejeitada", ultimoErro: "NCM inexistente", idDaNota: "mesa-S3", notaDaConta: { tableSessionId: "S3", pedidos: [] } } };
  const r4 = pedido({ tableSessionId: "S3", ...rejeitada });
  const r5 = pedido({ tableSessionId: "S3", ...rejeitada });
  const e3 = await emitir(r4.id);
  confere("nota da conta rejeitada: reemitida pelo botão", [e3.status, enviadas.at(-1)?.ref, doBanco(r5.id).fiscalStatus], [200, "firehub-mesa-S3", "EMITTED"]);

  // 4. Uma rodada com NFC-e própria (legado): sai a nota do RESTANTE. A conta
  //    foi paga numa forma só (Pix 40): a nota da rodada (20) sai dela, e a
  //    do restante declara Pix 20. Antes: 409 e nenhum caminho.
  conta("S4", "CLOSED", [{ method: "Pix", amount: 40 }]);
  const r6 = pedido({ tableSessionId: "S4", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K-PROPRIA" } });
  const r7 = pedido({ tableSessionId: "S4", fiscalStatus: "FAILED", fiscalInfo: { motivo: "dados_incompletos", ultimoErro: "Emita a nota do restante pela tela Fiscal." } });
  const e4 = await emitir(r7.id);
  const corpo4 = enviadas.at(-1)?.corpo;
  confere(
    "rodada com nota própria: 200, nota do RESTANTE só com a outra rodada",
    [e4.status, e4.dados.notaDaConta, e4.dados.restante, e4.dados.pedidos, enviadas.at(-1)?.ref],
    [200, true, true, [r7.id], "firehub-mesa-S4"]
  );
  confere(
    "…com o Pix que sobrou (40 − 20 da nota da rodada) e o total do restante",
    [Number(corpo4?.valor_total), corpo4?.formas_pagamento?.map((f: any) => [f.forma_pagamento, f.valor_pagamento])],
    [20, [["17", 20]]]
  );
  confere("…e a rodada com nota própria continua com a dela", [doBanco(r6.id).fiscalStatus, doBanco(r6.id).fiscalInfo.nfceKey], ["EMITTED", "K-PROPRIA"]);

  // 4b. Conta paga em duas formas e a nota da rodada sem forma conhecida: não
  //     dá para saber de qual pagamento abater — recusa em vez de chutar.
  conta("S5", "CLOSED", [{ method: "Pix", amount: 20 }, { method: "Dinheiro", amount: 20 }]);
  pedido({ tableSessionId: "S5", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K-PROPRIA-2" } });
  const r7b = pedido({ tableSessionId: "S5" });
  const antesDe4b = enviadas.length;
  const e4b = await emitir(r7b.id);
  confere(
    "restante impossível de separar: 409 que manda ao contador, nada enviado",
    [e4b.status, /contador/.test(e4b.dados.mensagem), enviadas.length === antesDe4b, doBanco(r7b.id).fiscalStatus],
    [409, true, true, "FAILED"]
  );

  // 5. Pedido comum: a nota avulsa de sempre.
  const r8 = pedido({ deliveryType: "RETIRADA", paymentMethod: "Pix", customerName: "Cliente" });
  const e5 = await emitir(r8.id);
  confere("pedido comum: nota avulsa, ref do pedido", [e5.status, e5.dados.notaDaConta, enviadas.at(-1)?.ref, doBanco(r8.id).fiscalStatus], [200, undefined, `firehub-${r8.id}`, "EMITTED"]);
  confere(
    "…gravada como a automática grava: ambiente, valor da nota, forma e 'pedida à mão'",
    [doBanco(r8.id).fiscalInfo.ambiente, doBanco(r8.id).fiscalInfo.valorDaNota, doBanco(r8.id).fiscalInfo.formaNaNota, doBanco(r8.id).fiscalInfo.emitidaAutomaticamente],
    [2, 20, "Pix", false]
  );

  // 6. iFood com a taxa de serviço de R$ 0,99 no total pago: a nota vale os
  //    itens e leva o intermediador. A rota montava o objeto à mão, sem canal:
  //    o pedido era tratado como canal próprio e a conferência de total
  //    recusava ("fechou em R$ 20,99, mas itens − desconto + entrega dá R$ 20,00").
  db.user[0].ifoodMerchantId = "merchant-uuid-1";
  const r9 = pedido({
    deliveryType: "RETIRADA", source: "IFOOD", ifoodOrderId: "if-1", ifoodReference: "4035",
    paymentMethod: "iFood App (Pago Online)", totalAmount: 20.99,
    items: [{ id: "i-if", productName: "Pastel", quantity: 1, price: 20, menuProduct: produto }],
  });
  const e6 = await emitir(r9.id);
  const corpo6 = enviadas.at(-1)?.corpo;
  confere(
    "iFood com taxa de serviço: 200, nota de R$ 20 com o iFood de intermediador e o merchant da loja",
    [e6.status, Number(corpo6?.valor_total), corpo6?.indicador_intermediario, corpo6?.cnpj_intermediario, corpo6?.id_intermediario, corpo6?.formas_pagamento?.[0]?.forma_pagamento],
    [200, 20, 1, "14380200000121", "merchant-uuid-1", "99"]
  );

  // 7. Contingência pelo botão: EMITTED com a marca (DANFE na tela), e o
  //    "Consultar situação" não desfaz nada enquanto a SEFAZ não efetivar.
  const r10 = pedido({ deliveryType: "RETIRADA", paymentMethod: "Pix" });
  noPost.set(`firehub-${r10.id}`, "contingencia");
  const e7 = await emitir(r10.id);
  confere(
    "contingência pelo botão: 200 com a marca, EMITTED com o DANFE e a marca gravada",
    [e7.status, e7.dados.contingencia, /CONTINGÊNCIA/.test(String(e7.dados.aviso)), doBanco(r10.id).fiscalStatus, doBanco(r10.id).fiscalInfo.contingencia, Boolean(doBanco(r10.id).fiscalInfo.pdfUrl)],
    [200, true, true, "EMITTED", true, true]
  );
  naConsulta.set(`firehub-${r10.id}`, "some");
  const g1 = await consultar(r10.id);
  naConsulta.set(`firehub-${r10.id}`, "cai");
  const g2 = await consultar(r10.id);
  confere(
    "consulta que não acha a nota ou não fala com o provedor: a contingência continua de pé",
    [g1.status, g2.status, doBanco(r10.id).fiscalStatus, doBanco(r10.id).fiscalInfo.contingencia],
    [502, 502, "EMITTED", true]
  );
  naConsulta.set(`firehub-${r10.id}`, "contingencia");
  const g3 = await consultar(r10.id);
  confere("consulta ainda em contingência: diz que continua, marca de pé", [g3.status, g3.dados.situacao, doBanco(r10.id).fiscalInfo.contingencia], [200, "contingencia", true]);
  naConsulta.set(`firehub-${r10.id}`, "autoriza");
  const g4 = await consultar(r10.id);
  confere(
    "efetivada: a consulta tira a marca, carimba a efetivação e mantém o que a nota declarou",
    [g4.dados.situacao, doBanco(r10.id).fiscalInfo.contingencia ?? null, Boolean(doBanco(r10.id).fiscalInfo.contingenciaEfetivadaEm), doBanco(r10.id).fiscalInfo.valorDaNota],
    ["autorizada", null, true, 20]
  );

  // 8. Pedido comum com a nota CANCELADA (emitida errado, cancelada no
  //    prazo): sai uma nova com ref nova, e a cancelada fica guardada.
  const r11 = pedido({
    deliveryType: "RETIRADA", paymentMethod: "Pix", fiscalStatus: "CANCELED",
    fiscalInfo: { nfceKey: "K-CANCELADA", nfceNumber: 9, ambiente: 2, canceladaEm: "2026-09-24T12:00:00.000Z", xmlCancelamentoUrl: "https://homologacao.focusnfe.com.br/c.xml" },
  });
  const e8 = await emitir(r11.id);
  const info8 = doBanco(r11.id).fiscalInfo;
  confere(
    "reemissão de pedido comum: ref <pedido>-2, EMITTED, a cancelada em notasAnteriores",
    [e8.status, e8.dados.reemissao, enviadas.at(-1)?.ref, doBanco(r11.id).fiscalStatus, info8.idDaNota, info8.notasAnteriores?.map((n: any) => [n.nfceKey, n.xmlCancelamentoUrl])],
    [200, true, `firehub-${r11.id}-2`, "EMITTED", `${r11.id}-2`, [["K-CANCELADA", "https://homologacao.focusnfe.com.br/c.xml"]]]
  );

  // 9. A nota da CONTA cancelada: reemissão da conta com `mesa-<sessão>-2`.
  conta("S6", "CLOSED", [{ method: "Pix", amount: 30 }]);
  const cancelada = { fiscalStatus: "CANCELED", fiscalInfo: { nfceKey: "K-CONTA", nfceNumber: 3, ambiente: 2, idDaNota: "mesa-S6", notaDaConta: { tableSessionId: "S6", pedidos: [] }, canceladaEm: "2026-09-24T12:00:00.000Z" } };
  const r12 = pedido({ tableSessionId: "S6", totalAmount: 30, ...cancelada });
  const e9 = await emitir(r12.id);
  const info9 = doBanco(r12.id).fiscalInfo;
  confere(
    "conta cancelada: nova nota da conta com ref mesa-S6-2, e a cancelada guardada",
    [e9.status, e9.dados.reemissao, enviadas.at(-1)?.ref, doBanco(r12.id).fiscalStatus, info9.idDaNota, info9.notasAnteriores?.map((n: any) => [n.nfceKey, n.idDaNota])],
    [200, true, "firehub-mesa-S6-2", "EMITTED", "mesa-S6-2", [["K-CONTA", "mesa-S6"]]]
  );
}

testeDaRotaDeEmitir()
  .catch((err) => {
    falhas++;
    console.log("❌ o teste da rota lançou:", err);
  })
  .finally(() => {
    console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ Tudo certo");
    process.exit(falhas ? 1 : 0);
  });
