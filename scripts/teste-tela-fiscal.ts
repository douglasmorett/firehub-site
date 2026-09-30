/**
 * Trava as correções de TELA do módulo fiscal achadas no teste de ponta a ponta
 * (30/09/2026):
 *
 *  1. o rótulo do campo nas pendências (lib/textos-da-tela-fiscal): a caixa
 *     vermelha do topo e o checklist do emissor mostravam "inscricaoEstadual",
 *     "razaoSocial", "Falta: cnpj, razaoSocial…";
 *  5. o teste de conexão é só POST { ambiente } (o GET com ?ambiente= saiu), e
 *     o 429 ("testou há menos de 1 min") aparece como veio;
 *  7. a justificativa do cancelamento e a descrição da devolução num modal da
 *     tela (era window.prompt), com contagem e a regra de 15 a 255 / 10 a 500.
 *
 *   npx tsx scripts/teste-tela-fiscal.ts
 *
 * Puro: sem banco, sem servidor, sem navegador. O `fetch` do teste de conexão
 * é falso, e o modal é renderizado com react-dom/server.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pendenciasDoEmitente } from "../src/lib/fiscal-validacao";
import { pendenciasDoEmissorProprio } from "../src/lib/nfce/pendencias";
import { prontidaoDoEmissor } from "../src/lib/nfce/cadastro-do-emissor";
import {
  avisoComRotulos,
  camposEmTexto,
  JUSTIFICATIVA_DO_CANCELAMENTO,
  OBSERVACAO_DA_DEVOLUCAO,
  pendenciaEmTexto,
  regraDoTexto,
  ROTULO_DO_CAMPO_FISCAL,
  rotuloDoCampoFiscal,
  textoDaJustificativa,
} from "../src/lib/textos-da-tela-fiscal";
import { pedirTesteDeConexao } from "../src/app/store/fiscal/EmissorProprio";
import ModalDeJustificativa from "../src/app/store/fiscal/ModalDeJustificativa";

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

async function principal() {
  console.log("\n— 1. o rótulo do campo");
  {
    const pedidos: Record<string, string> = {
      cnpj: "CNPJ",
      inscricaoEstadual: "Inscrição Estadual",
      razaoSocial: "Razão social",
      regimeTributario: "Regime tributário",
      logradouro: "Logradouro",
      numero: "Número",
      bairro: "Bairro",
      municipio: "Município",
      codigoMunicipio: "Código IBGE do município",
      uf: "UF",
      cep: "CEP",
      serie: "Série",
      csc: "CSC",
      certificado: "Certificado digital",
    };
    confere("os rótulos pedidos, como no formulário", Object.keys(pedidos).map((c) => rotuloDoCampoFiscal(c)), Object.values(pedidos));

    // Todo `campo` LITERAL que as regras fiscais geram tem rótulo cadastrado —
    // conferido no código-fonte: campo novo sem rótulo derruba este teste.
    const fontes = [
      "src/lib/fiscal-validacao.ts",
      "src/lib/nfce/pendencias.ts",
      "src/lib/fiscal-emissao.ts",
      "src/lib/nfce/cadastro-do-emissor.ts",
      "src/lib/focus-empresas.ts",
      "src/lib/nfce/credenciais-da-loja.ts",
      "src/lib/nfce/emissor.ts",
      "src/lib/nfce/xml-da-nota.ts",
    ];
    const achados = new Set<string>();
    for (const f of fontes) {
      const src = ler(f);
      for (const m of src.matchAll(/campo:\s*"([A-Za-z_.]+)"/g)) achados.add(m[1]);
      for (const m of src.matchAll(/exigir\(([^;]*?),\s*"([A-Za-z_.]+)",/g)) achados.add(m[2]);
      for (const m of src.matchAll(/\bfalta\(\s*"([A-Za-z_.]+)"/g)) achados.add(m[1]);
    }
    // Os montados com crase (lib/focus-empresas: `csc.${amb}`…).
    for (const amb of ["homologacao", "producao"]) for (const s of ["", ".id", ".codigo"]) achados.add(`csc.${amb}${s}`);
    verdade(`achou os campos das regras no código (${achados.size})`, achados.size >= 40, [...achados].join(", "));
    const semRotulo = [...achados].filter((c) => !ROTULO_DO_CAMPO_FISCAL[c]);
    confere("todo campo que as pendências geram tem rótulo cadastrado", semRotulo, []);

    // O que as regras DEVOLVEM de verdade: nenhuma pendência sai com o nome cru.
    const doEmitente = [
      ...pendenciasDoEmitente({}),
      ...pendenciasDoEmitente({ inscricaoEstadual: "ISENTO", regimeTributario: 3 }),
    ];
    const doProprio = pendenciasDoEmissorProprio(
      {
        uf: "ZZ",
        cnpj: "64568087000180",
        ambiente: 2,
        sefaz: {
          certificado: { arquivo: "x.pfx", sha256: "x", validoAte: "2020-01-01T00:00:00.000Z", validoDe: "2019-01-01T00:00:00.000Z", cnpj: "11111111000191" },
          csc: { homologacao: { id: "ABC", cifrado: "fh1:x", final: "1234" } },
          qrVersao: 7,
          serie: 0,
          numeroInicial: 0,
        },
      },
      new Date("2026-09-30T12:00:00Z")
    );
    const todas = [...doEmitente, ...doProprio];
    confere(
      "as pendências do emitente e do emissor próprio cobrem os campos esperados",
      [...new Set(todas.map((p) => p.campo))].sort(),
      ["ambiente", "bairro", "cep", "certificado", "cnpj", "codigoMunicipio", "csc", "cscId", "inscricaoEstadual", "logradouro", "municipio", "numero", "numeroInicial", "qrVersao", "razaoSocial", "regimeTributario", "serie", "uf"].sort()
    );
    confere(
      "nenhuma pendência sai com o rótulo igual ao nome interno",
      todas.filter((p) => rotuloDoCampoFiscal(p.campo) === p.campo).map((p) => p.campo),
      []
    );

    confere(
      "formas compostas: produto → campo, item N.campo, lista[i].campo",
      [
        rotuloDoCampoFiscal("Pizza Calabresa → ncm"),
        rotuloDoCampoFiscal("Esfiha → csosn"),
        rotuloDoCampoFiscal("item 3.ncm"),
        rotuloDoCampoFiscal("item 2.cofins"),
        rotuloDoCampoFiscal("items[0].valor_bruto"),
        rotuloDoCampoFiscal("formas_pagamento[1]"),
        rotuloDoCampoFiscal("formas_pagamento[0].forma_pagamento"),
      ],
      ["Pizza Calabresa → NCM", "Esfiha → CSOSN", "Item 3 → NCM", "Item 2 → COFINS", "Item 1 → Valor bruto", "Pagamento 2", "Pagamento 1 → Forma pagamento"]
    );
    confere(
      "campo desconhecido vira palavras legíveis (não quebra, não aparece cru)",
      [rotuloDoCampoFiscal("tokenDoProvedorNovo"), rotuloDoCampoFiscal("uf_do_cliente"), rotuloDoCampoFiscal("  "), rotuloDoCampoFiscal(null), rotuloDoCampoFiscal(undefined)],
      ["Token do provedor novo", "UF do cliente", "", "", ""]
    );
    confere(
      "a linha da pendência: \"Rótulo: mensagem\" (sem campo, só a mensagem)",
      [pendenciaEmTexto({ campo: "inscricaoEstadual", mensagem: "Inválida." }), pendenciaEmTexto({ campo: "", mensagem: "Só a mensagem." }), pendenciaEmTexto({ campo: "cep" })],
      ["Inscrição Estadual: Inválida.", "Só a mensagem.", "CEP"]
    );
    confere(
      "a lista de campos: rótulos na ordem, sem repetir",
      camposEmTexto([{ campo: "cnpj" }, { campo: "razaoSocial" }, { campo: "regimeTributario" }, { campo: "regimeTributario" }, { campo: "" }, { campo: "uf" }]),
      "CNPJ, Razão social, Regime tributário, UF"
    );

    // O que o funcionário tentou mudar e só o titular muda volta em
    // `camposIgnorados` e no `aviso` do PUT — também com o nome interno.
    const configFiscal = ler("src/lib/fiscal-config.ts");
    const inicio = configFiscal.indexOf("const CAMPOS_DO_TITULAR");
    const doTitular = [...configFiscal.slice(inicio, configFiscal.indexOf("]);", inicio)).matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    verdade(`achou os campos que só o titular muda (${doTitular.length})`, doTitular.length >= 20, doTitular.join(", "));
    confere("todo campo que só o titular muda tem rótulo", doTitular.filter((c) => !ROTULO_DO_CAMPO_FISCAL[c]), []);
    confere(
      "o bloco do emissor do FireHub (sefaz.x) usa o rótulo do campo",
      [rotuloDoCampoFiscal("sefaz.serie"), rotuloDoCampoFiscal("sefaz.numeroInicial"), rotuloDoCampoFiscal("sefaz.csc.homologacao"), rotuloDoCampoFiscal("sefaz.qrVersao"), rotuloDoCampoFiscal("sefaz.contingenciaOffline")],
      ["Série", "Número inicial", "CSC de homologação", "Versão do QR Code", "Contingência off-line"]
    );
    confere(
      "o aviso de campos ignorados sai com os rótulos (o resto do aviso fica como veio)",
      avisoComRotulos(
        "Alguns campos só o responsável pela loja altera e foram mantidos como estavam: cnpj, inscricaoEstadual, sefaz.serie. O CSC digitado no modo manual não foi gravado.",
        ["cnpj", "inscricaoEstadual", "sefaz.serie"]
      ),
      "Alguns campos só o responsável pela loja altera e foram mantidos como estavam: CNPJ, Inscrição Estadual, Série. O CSC digitado no modo manual não foi gravado."
    );
    confere("sem camposIgnorados (ou sem aviso), fica como veio", [avisoComRotulos("Só um aviso.", undefined), avisoComRotulos("", ["cnpj"]), avisoComRotulos(undefined, ["cnpj"])], ["Só um aviso.", "", ""]);

    // O item 4 do checklist ("Pronto para emitir?"), montado no servidor.
    const itens = prontidaoDoEmissor({}, { produtosSemNcm: 0, totalDeProdutos: 1, temNotaDeHomologacao: false, agora: new Date("2026-09-30T12:00:00Z") });
    confere(
      "checklist: \"Dados da empresa\" diz o que falta com o nome do formulário",
      itens.find((i) => i.chave === "empresa")?.detalhe,
      "Falta: CNPJ, Razão social, Regime tributário, Logradouro, Número, Bairro, Município, Código IBGE do município, UF, CEP."
    );

    const pagina = ler("src/app/store/fiscal/page.tsx");
    verdade(
      "a página não mostra mais `campo` cru (caixa do topo, alerts, título do \"Falhou\", Focus)",
      !pagina.includes("{p.campo}") && !/\$\{(x|p)\.campo\}/.test(pagina) && !pagina.includes("x.campo).join"),
      "sobrou `campo` cru em page.tsx"
    );
    verdade(
      "a caixa vermelha do topo usa o rótulo",
      pagina.includes("const rotulo = rotuloDoCampoFiscal(p.campo);") && pagina.includes("<strong>{rotulo}</strong>")
    );
    verdade("o \"Falta:\" do cadastro na Focus usa o rótulo", pagina.includes('" Falta: " + camposEmTexto(dados.pendencias)'));
    verdade(
      "os avisos do salvar (configurações, recusa, regras da nota) trocam os campos ignorados pelos rótulos",
      (pagina.match(/avisoComRotulos\((r\.)?dados\.aviso, (r\.)?dados\.camposIgnorados\)/g) ?? []).length === 3
    );
    const cadastro = ler("src/lib/nfce/cadastro-do-emissor.ts");
    verdade("o checklist do emissor usa o rótulo", cadastro.includes("`Falta: ${camposEmTexto(doEmitente)}.`") && !cadastro.includes("doEmitente.map((p) => p.campo)"));
  }

  console.log("\n— 5. teste de conexão: só POST { ambiente }, com o 429");
  {
    type Chamada = { url: string; init?: RequestInit };
    const chamadas: Chamada[] = [];
    let proxima: { status: number; corpo: unknown } = { status: 200, corpo: {} };
    (globalThis as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
      chamadas.push({ url, init });
      return new Response(JSON.stringify(proxima.corpo), { status: proxima.status, headers: { "Content-Type": "application/json" } });
    };

    proxima = { status: 200, corpo: { ok: true, success: true, cStat: "107", mensagem: "Serviço em operação", ambiente: 2, certificado: { titular: "NIK", validoAte: "2035-12-31", diasParaVencer: 3380 } } };
    const ok = await pedirTesteDeConexao(2);
    const c = chamadas[0];
    confere(
      "a chamada: POST na rota, corpo { ambiente } em JSON",
      [c?.url, c?.init?.method, (c?.init?.headers as Record<string, string>)?.["Content-Type"], c?.init?.body],
      ["/api/store/fiscal/testar-conexao", "POST", "application/json", JSON.stringify({ ambiente: 2 })]
    );
    confere("resposta do emissor do FireHub: ok, cStat, mensagem e certificado", [ok.aguarde, ok.ok, ok.cStat, ok.mensagem, ok.certificado?.titular], [false, true, "107", "Serviço em operação", "NIK"]);

    proxima = { status: 429, corpo: { error: "Você testou a conexão há menos de 1 minuto. Espere e tente de novo." } };
    const espera = await pedirTesteDeConexao(1);
    confere(
      "429: `aguarde`, não é falha de conexão, e a mensagem do servidor vai como veio",
      [espera.aguarde, espera.ok, espera.status, espera.mensagem, JSON.parse(String(chamadas[1]?.init?.body)).ambiente],
      [true, false, 429, "Você testou a conexão há menos de 1 minuto. Espere e tente de novo.", 1]
    );
    proxima = { status: 429, corpo: {} };
    verdade("429 sem corpo ainda diz para esperar", /1 minuto/.test((await pedirTesteDeConexao(2)).mensagem));

    proxima = { status: 409, corpo: { ok: false, success: false, cStat: "280", mensagem: "Certificado transmissor inválido" } };
    const falhou = await pedirTesteDeConexao(2);
    confere("409 do emissor: falhou, com o cStat", [falhou.aguarde, falhou.ok, falhou.cStat, falhou.mensagem], [false, false, "280", "Certificado transmissor inválido"]);

    proxima = { status: 200, corpo: { success: true, mensagem: "Token de homologação autenticado." } };
    confere("resposta da Focus ({ success, mensagem }) também é lida", [(await pedirTesteDeConexao(2)).ok], [true]);

    const tela = ler("src/app/store/fiscal/EmissorProprio.tsx");
    const pagina = ler("src/app/store/fiscal/page.tsx");
    verdade(
      "nenhuma chamada GET/`?ambiente=` sobrou na tela",
      !tela.includes("testar-conexao?ambiente=") && !pagina.includes("testar-conexao?ambiente=") && !pagina.includes('fetch("/api/store/fiscal/testar-conexao"'),
      "sobrou chamada antiga"
    );
    verdade(
      "a página chama o mesmo POST nos dois emissores",
      (pagina.match(/pedirTesteDeConexao\(ambiente\)/g) ?? []).length === 2 && pagina.includes("if (r.aguarde)")
    );
    verdade("o painel do emissor mostra o 429 como aviso (não como \"A conexão falhou\")", tela.includes('tom={teste.aguarde ? "aviso" : undefined}') && /teste\.aguarde\s*\?\s*teste\.mensagem/.test(tela));
  }

  console.log("\n— 7. a justificativa do cancelamento e da devolução");
  {
    confere("as regras: cancelamento 15–255 (SEFAZ), devolução 10–500", [JUSTIFICATIVA_DO_CANCELAMENTO, OBSERVACAO_DA_DEVOLUCAO], [{ minimo: 15, maximo: 255 }, { minimo: 10, maximo: 500 }]);
    const r = (t: string) => regraDoTexto(t, JUSTIFICATIVA_DO_CANCELAMENTO);
    confere("vazio: faltam 15", r(""), { tamanho: 0, ok: false, faltam: 15, sobram: 0 });
    confere("14 caracteres: ainda não", r("a".repeat(14)).ok, false);
    confere("15 caracteres: ok", r("a".repeat(15)), { tamanho: 15, ok: true, faltam: 0, sobram: 0 });
    confere("255: ok; 256: passou 1", [r("a".repeat(255)).ok, r("a".repeat(256))], [true, { tamanho: 256, ok: false, faltam: 0, sobram: 1 }]);
    confere(
      "espaços repetidos e quebras de linha contam como UM espaço (é o que vai à SEFAZ)",
      [textoDaJustificativa("  Pedido   cancelado\n\npelo cliente  "), r("a  b\n\nc").tamanho, r("               ").ok],
      ["Pedido cancelado pelo cliente", 5, false]
    );

    const html = renderToStaticMarkup(
      createElement(ModalDeJustificativa, {
        id: "nota-cancelamento",
        titulo: "Cancelar a NFC-e nº 12",
        rotulo: "Justificativa do cancelamento",
        ajuda: "Mínimo 15 caracteres — exigência da SEFAZ.",
        regra: JUSTIFICATIVA_DO_CANCELAMENTO,
        aviso: "O cancelamento é definitivo.",
        textoDoBotao: "Cancelar a nota na SEFAZ",
        perigosa: true,
        enviando: false,
        erro: "Passaram os 30 minutos.",
        outraAcao: { texto: "↩ Registrar a devolução feita pelo contador", aoClicar: () => {} },
        aoConfirmar: () => {},
        aoFechar: () => {},
      })
    );
    verdade("é um diálogo modal nomeado pelo título", html.includes('role="dialog"') && html.includes('aria-modal="true"') && html.includes('aria-labelledby="nota-cancelamento-titulo"') && html.includes('id="nota-cancelamento-titulo"'));
    verdade("o campo tem rótulo (for/id) e descrição (ajuda + contagem)", html.includes('for="nota-cancelamento-campo"') && /<textarea[^>]*id="nota-cancelamento-campo"/.test(html) && html.includes('aria-describedby="nota-cancelamento-ajuda nota-cancelamento-contagem"'));
    verdade("a contagem diz quanto falta", html.includes("0<!-- --> de <!-- -->255<!-- --> caracteres<!-- --> — faltam 15 para o mínimo de 15") || html.includes("0 de 255 caracteres — faltam 15 para o mínimo de 15"), html.match(/nota-cancelamento-contagem[^<]*<[^>]*>|contagem"[^>]*>([^<]*)/)?.[0] ?? "");
    verdade("o botão de confirmar nasce desabilitado (texto vazio)", /<button[^>]*disabled=""[^>]*>Cancelar a nota na SEFAZ<\/button>/.test(html));
    verdade("o botão de fechar tem nome (aria-label) e há \"Voltar\"", html.includes('aria-label="Fechar"') && html.includes(">Voltar</button>"));
    verdade("a recusa do servidor aparece no modal (role=alert) com o caminho da devolução", html.includes('role="alert"') && html.includes("Passaram os 30 minutos.") && html.includes("Registrar a devolução feita pelo contador"));

    const devolucao = renderToStaticMarkup(
      createElement(ModalDeJustificativa, {
        id: "nota-devolucao",
        titulo: "Registrar a devolução",
        rotulo: "Devolução/ajuste feito pelo contador",
        ajuda: "Descreva (mínimo 10 caracteres).",
        regra: OBSERVACAO_DA_DEVOLUCAO,
        declaracao: "Confirmo que o contador JÁ fez a devolução/estorno desta NFC-e.",
        textoDoBotao: "Registrar a devolução",
        enviando: false,
        aoConfirmar: () => {},
        aoFechar: () => {},
      })
    );
    verdade("a devolução pede a declaração num checkbox rotulado", /<label[^>]*><input type="checkbox"[^>]*\/><span>Confirmo que o contador JÁ fez/.test(devolucao));

    const pagina = ler("src/app/store/fiscal/page.tsx");
    verdade("nenhum window.prompt sobrou na página fiscal", !pagina.includes("window.prompt("));
    verdade(
      "o cancelamento e a devolução abrem o modal da tela, com as regras",
      pagina.includes('id="nota-cancelamento"') && pagina.includes('id="nota-devolucao"') && pagina.includes("regra={JUSTIFICATIVA_DO_CANCELAMENTO}") && pagina.includes("regra={OBSERVACAO_DA_DEVOLUCAO}")
    );
    verdade("a devolução manda `confirmar: true` (a declaração do modal)", pagina.includes("body: JSON.stringify({ orderId: order.id, observacao, confirmar: true })"));
    const modal = ler("src/app/store/fiscal/ModalDeJustificativa.tsx");
    verdade("Esc fecha, o foco vai para o campo e volta para quem abriu", modal.includes('e.key === "Escape"') && modal.includes("campoRef.current?.focus()") && modal.includes("antes.focus()"));
    verdade("o Tab fica dentro do modal", modal.includes('e.key === "Tab"') && modal.includes("primeiro.focus()") && modal.includes("ultimo.focus()"));
    verdade("confirmar só dentro da regra", modal.includes("const pode = r.ok && (!declaracao || declarado) && !enviando;") && modal.includes("disabled={!pode}"));
  }
}

principal()
  .catch((e) => {
    falhas++;
    console.log(`❌ o teste quebrou: ${String(e?.stack ?? e).slice(0, 600)}`);
  })
  .finally(() => {
    console.log(falhas === 0 ? "\n✅ Tudo certo." : `\n❌ ${falhas} falha(s).`);
    process.exit(falhas === 0 ? 0 : 1);
  });
