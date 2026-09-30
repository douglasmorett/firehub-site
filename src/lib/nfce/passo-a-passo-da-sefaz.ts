/**
 * /src/lib/nfce/passo-a-passo-da-sefaz.ts
 *
 * O que a loja faz FORA do FireHub, no portal da SEFAZ do estado dela, antes
 * de o emissor próprio conseguir autorizar a primeira NFC-e.
 *
 * Existe porque o erro mais comum não é do FireHub: é a empresa sem
 * credenciamento de NFC-e ou sem CSC, e cada estado esconde isso num lugar
 * diferente. O DF vem primeiro porque é o da primeira loja (a NIK, em
 * Sobradinho). Textos conferidos em 24/09/2026 (RJ, DF, MG, PA) e revistos em
 * 29/09/2026 para o emissor próprio — com a Focus, o certificado ia para ela;
 * agora ele fica no cofre do FireHub.
 *
 * Puro (sem imports): a tela importa.
 */

export type PassoAPasso = {
  uf: string;
  titulo: string;
  passos: Array<{ titulo: string; texto: string }>;
  links: Array<{ rotulo: string; url: string }>;
  avisos: string[];
};

const CERTIFICADO = {
  titulo: "Certificado digital A1 (e-CNPJ)",
  texto:
    "O arquivo .pfx ou .p12 do e-CNPJ da empresa, com a senha. Compra-se numa certificadora e vale 1 ano. O A3 (cartão ou token USB) não serve: o emissor do FireHub assina no servidor, e o A3 só assina no computador onde está plugado.",
};

const SERIE_NOVA =
  "Se a loja já emitiu NFC-e por outro sistema (a NIK usou a Saipos), use uma SÉRIE NOVA no FireHub — sugerimos a 2. Número repetido na mesma série é rejeitado pela SEFAZ (rejeição 539), e o FireHub não sabe até onde o outro sistema chegou.";

export const PASSO_A_PASSO_DO_EMISSOR: Record<string, PassoAPasso> = {
  DF: {
    uf: "DF",
    titulo: "Distrito Federal — Receita do DF",
    passos: [
      CERTIFICADO,
      {
        titulo: "Inscrição no CF/DF ativa",
        texto:
          "A Inscrição Estadual do DF se chama CF/DF (Cadastro Fiscal do DF) e tem 13 dígitos. A Receita Federal não informa — está no cadastro da Receita do DF ou com o seu contador.",
      },
      {
        titulo: "Credenciar a empresa na NFC-e",
        texto:
          "Em ww2.receita.fazenda.df.gov.br → Painel de Serviços → Meus Serviços → DF-e → Credenciamento, entrando com o certificado digital da empresa. A liberação sai em até 1 dia.",
      },
      {
        titulo: "Gerar o CSC",
        texto:
          "No mesmo painel: DF-e → Código CSC. Anote o ID e o código — o de homologação (teste) e o de produção. Cada CNPJ raiz pode ter até 2 CSCs ativos (a matriz e as filiais dividem esse limite): se já houver dois de outro sistema, revogue um antes de gerar o do FireHub.",
      },
    ],
    links: [{ rotulo: "Receita do DF — Painel de Serviços", url: "https://ww2.receita.fazenda.df.gov.br" }],
    avisos: [SERIE_NOVA],
  },
  RJ: {
    uf: "RJ",
    titulo: "Rio de Janeiro — SEFAZ-RJ",
    passos: [
      CERTIFICADO,
      {
        titulo: "Credenciamento",
        texto: "Automático para quem tem Inscrição Estadual ativa — o estabelecimento precisa estar como OPERACIONAL no cadastro da SEFAZ-RJ.",
      },
      {
        titulo: "Gerar o CSC",
        texto:
          "Em www.fazenda.rj.gov.br/dfe → \"Geração e Manutenção CSC\", entrando com o certificado digital. Gere o de homologação e o de produção e anote o ID de cada um. O portal bloqueia alguns endereços de internet: se não abrir, tente de outra rede (o 4G do celular, por exemplo).",
      },
    ],
    links: [{ rotulo: "SEFAZ-RJ — DF-e", url: "https://www.fazenda.rj.gov.br/dfe" }],
    avisos: [SERIE_NOVA],
  },
  PA: {
    uf: "PA",
    titulo: "Pará — SEFA-PA",
    passos: [
      CERTIFICADO,
      { titulo: "Credenciamento", texto: "Automático para quem tem Inscrição Estadual ativa." },
      { titulo: "Gerar o CSC", texto: "No Portal de Serviços da SEFA: \"Gerenciar Código Segurança NFC-e\" — o de homologação e o de produção." },
    ],
    links: [{ rotulo: "SEFA-PA", url: "https://www.sefa.pa.gov.br" }],
    avisos: [
      "No Pará o SOFTWARE emissor também precisa estar cadastrado na SEFA (\"Cadastro Software NFC-e - Fornecedor\"), e a loja comunica que usa esse software. No emissor do FireHub o fornecedor é o próprio FireHub: confirme com o suporte que o cadastro do software na SEFA-PA está feito antes de ligar em produção.",
      SERIE_NOVA,
    ],
  },
  MG: {
    uf: "MG",
    titulo: "Minas Gerais — SEF-MG (SIARE)",
    passos: [
      CERTIFICADO,
      {
        titulo: "Credenciar no SIARE",
        texto: "No SIARE: Documentos Eletrônicos → Credenciar Emissor de NFC-e. Atenção: em Minas o credenciamento é irrevogável.",
      },
      { titulo: "Gerar o CSC", texto: "O CSC aparece no SIARE depois do credenciamento — anote o ID e o código de cada ambiente." },
    ],
    links: [{ rotulo: "SIARE (SEF-MG)", url: "https://www2.fazenda.mg.gov.br/sol/" }],
    avisos: ["Em Minas a SEFAZ não aceita cancelamento fora do prazo (extemporâneo): nota errada depois dos 30 minutos só sai por devolução com o contador.", SERIE_NOVA],
  },
};

const GENERICO: Omit<PassoAPasso, "uf"> = {
  titulo: "Seu estado",
  passos: [
    CERTIFICADO,
    { titulo: "Inscrição Estadual ativa", texto: "Quem emite NFC-e precisa de Inscrição Estadual — \"isento\" não vale para o emitente." },
    {
      titulo: "Credenciamento na NFC-e",
      texto: "Procure \"credenciamento NFC-e\" no portal da SEFAZ do seu estado. Em vários estados é automático para quem tem Inscrição Estadual ativa; em outros é preciso pedir.",
    },
    {
      titulo: "Gerar o CSC",
      texto: "No mesmo portal, procure \"CSC\" (Código de Segurança do Contribuinte). Gere um para homologação e outro para produção e anote o ID de cada um.",
    },
  ],
  links: [],
  avisos: [SERIE_NOVA],
};

/** O passo a passo da UF (o genérico quando o FireHub ainda não conferiu a UF). */
export function passoAPassoDaUf(uf: unknown): PassoAPasso {
  const u = String(uf ?? "").trim().toUpperCase();
  return PASSO_A_PASSO_DO_EMISSOR[u] ?? { uf: u, ...GENERICO };
}
