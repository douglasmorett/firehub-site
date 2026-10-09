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
 * agora ele fica no cofre do FireHub. Em 09/10/2026, quando o emissor passou a
 * atender as 27 UF, entraram mais 18 (SP, CE, RS, GO, BA, PR, PE, SC, PI, MT,
 * MA, ES, RN, TO, PB, AM, MS, RO), pelos portais oficiais de cada SEFAZ; as
 * que só tinham guia de terceiros (PI, MA, RN) avisam. AC, AL, AP, RR e SE
 * ficam no genérico.
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

const CSC_NO_NAVEGADOR =
  "Para gerar o CSC, a maioria dos portais exige o certificado digital instalado no navegador do computador (ou o contador entra com o dele). É o mesmo certificado do arquivo .pfx que você envia ao FireHub.";

const FONTE_DE_TERCEIROS =
  "O FireHub não achou a página oficial com esses passos no site da SEFAZ deste estado (09/10/2026): o caminho acima vem de guias de terceiros. Confirme com o contador antes de contar com ele.";

/** Credenciamento que a SEFAZ dá sem pedido: basta a Inscrição Estadual ativa. */
const CREDENCIAMENTO_AUTOMATICO = { titulo: "Credenciamento", texto: "Automático para quem tem Inscrição Estadual ativa — não precisa pedir." };

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

  // ── As UF que entraram em 09/10/2026, quando o emissor passou a atender as 27.
  // Textos dos portais oficiais de cada SEFAZ (páginas abertas em 09/10/2026);
  // onde só havia guia de terceiros, o aviso FONTE_DE_TERCEIROS diz.
  SP: {
    uf: "SP",
    titulo: "São Paulo — Portal NFC-e da SEFAZ-SP",
    passos: [
      CERTIFICADO,
      {
        titulo: "Credenciar a empresa",
        texto:
          "No Portal NFC-e (nfce.fazenda.sp.gov.br/NFCePortal), menu \"Credenciamento\", entrando com o certificado digital. A Inscrição Estadual precisa estar regular.",
      },
      {
        titulo: "Gerar o CSC",
        texto:
          "No mesmo portal, \"Gerenciar Código de Segurança\" gera o CSC de PRODUÇÃO; o de homologação (teste) é gerado no portal de homologação (www.homologacao.nfce.fazenda.sp.gov.br). Anote o ID e o código de cada ambiente.",
      },
    ],
    links: [
      { rotulo: "Portal NFC-e SEFAZ-SP", url: "https://www.nfce.fazenda.sp.gov.br/NFCePortal/" },
      { rotulo: "Portal de homologação (CSC de teste)", url: "https://www.homologacao.nfce.fazenda.sp.gov.br/" },
    ],
    avisos: [
      "Não precisa de SAT: a exigência de \"equipamento SAT ativo\" (CAT 12/2015) foi revogada pela Portaria SRE 34/2023, e desde 01/01/2026 a NFC-e é o documento do varejo paulista (SRE 79/2024, fim do SAT em 31/12/2025). A FAQ antiga do portal ainda cita o SAT — ignore. Basta o e-CNPJ A1 e o CSC.",
      CSC_NO_NAVEGADOR,
      SERIE_NOVA,
    ],
  },
  CE: {
    uf: "CE",
    titulo: "Ceará — SEFAZ-CE",
    passos: [
      CERTIFICADO,
      {
        titulo: "Credenciar a empresa",
        texto:
          "No Portal NFC-e (nfce.sefaz.ce.gov.br) → \"Credenciar Empresa\", com o certificado digital do CNPJ (a matriz credencia). Exige situação regular no Cadastro Geral da Fazenda; o CSC é informado depois do deferimento.",
      },
      {
        titulo: "Consultar o CSC",
        texto: "Em \"Consultar CSC\" (nfe.sefaz.ce.gov.br/ccc2-web), com o certificado: anote o ID e o código de cada ambiente.",
      },
    ],
    links: [
      { rotulo: "Portal NFC-e SEFAZ-CE", url: "http://nfce.sefaz.ce.gov.br/pages/index.jsf" },
      { rotulo: "Consultar CSC", url: "https://nfe.sefaz.ce.gov.br/ccc2-web/pages/csc/csc.jsf" },
    ],
    avisos: [CSC_NO_NAVEGADOR, SERIE_NOVA],
  },
  RS: {
    uf: "RS",
    titulo: "Rio Grande do Sul — Receita Estadual (e-CAC)",
    passos: [
      CERTIFICADO,
      { titulo: "Credenciamento", texto: "Automático: quem já emite NF-e não precisa de nenhum cadastramento para a NFC-e." },
      {
        titulo: "Gerar o CSC",
        texto:
          "No e-CAC da Receita Estadual → \"Manutenção de CSC\", com o certificado digital ou com a autorização eletrônica de sócio/contador. O MEI entra pelo Portal MEI (gov.br). Gere o de homologação e o de produção.",
      },
    ],
    links: [
      { rotulo: "e-CAC — Manutenção de CSC", url: "https://www.sefaz.rs.gov.br/NFCE/NFC-TOK-MAN.aspx" },
      { rotulo: "SEFAZ-RS", url: "https://www.sefaz.rs.gov.br" },
    ],
    avisos: [CSC_NO_NAVEGADOR, SERIE_NOVA],
  },
  GO: {
    uf: "GO",
    titulo: "Goiás — SEFAZ-GO",
    passos: [
      CERTIFICADO,
      {
        titulo: "Credenciamento",
        texto: "Quem já emite NF-e não precisa pedir. Senão, \"Credenciamento NF-e\" no portal da NF-e de Goiás, com o certificado digital.",
      },
      {
        titulo: "Gerar o CSC",
        texto: "No portal da NF-e/NFC-e: escolha o ambiente (homologação ou produção) e gere o CSC com o certificado digital. Anote o ID e o código de cada um.",
      },
    ],
    links: [
      { rotulo: "SEFAZ-GO — CSC da NFC-e", url: "https://nfe.sefaz.go.gov.br/nfeweb/jsp/SelecionarAmbienteCSC.jsf" },
      { rotulo: "SEFAZ-GO", url: "https://www.sefaz.go.gov.br" },
    ],
    avisos: [CSC_NO_NAVEGADOR, SERIE_NOVA],
  },
  BA: {
    uf: "BA",
    titulo: "Bahia — SEFAZ-BA (Inspetoria Eletrônica)",
    passos: [
      CERTIFICADO,
      { titulo: "Credenciamento", texto: "Sem pedido formal: a loja com Inscrição Estadual ativa gera o CSC direto na Inspetoria Eletrônica." },
      {
        titulo: "Gerar o CSC",
        texto:
          "Inspetoria Eletrônica → ICMS → Documentos fiscais → Nota Fiscal de Consumidor Eletrônica → \"Solicitar/Inutilizar CSC\", com o login da Inspetoria. O de produção fica em nfe.sefaz.ba.gov.br e o de homologação em hnfe.sefaz.ba.gov.br — gere os dois.",
      },
    ],
    links: [
      { rotulo: "Inspetoria Eletrônica — NFC-e", url: "https://www.sefaz.ba.gov.br/inspetoria-eletronica/icms/documentos-fiscais/nota-fiscal-de-consumidor-eletronica" },
    ],
    avisos: [SERIE_NOVA],
  },
  PR: {
    uf: "PR",
    titulo: "Paraná — Receita Estadual (Portal de Serviços)",
    passos: [
      CERTIFICADO,
      {
        titulo: "Autorização de uso da NFC-e",
        texto: "No Portal de Serviços da Receita/PR (receita.pr.gov.br), peça a \"autorização de uso de DF-e modelo 65\" (a NFC-e).",
      },
      {
        titulo: "Gerar o CSC",
        texto: "No mesmo portal, entrando com certificado digital ou usuário e senha: DF-e → NFC-e → CSC. Gere o de homologação e o de produção.",
      },
    ],
    links: [{ rotulo: "Portal de Serviços — Receita/PR", url: "https://receita.pr.gov.br/login" }],
    avisos: [SERIE_NOVA],
  },
  PE: {
    uf: "PE",
    titulo: "Pernambuco — SEFAZ-PE (e-Fisco)",
    passos: [
      CERTIFICADO,
      {
        titulo: "Credenciamento",
        texto:
          "No e-Fisco (ARE Virtual): pedir o credenciamento de NFC-e — tipo 83 para homologação e 84 para produção; o deferimento sai na hora. Peça os dois ambientes de uma vez.",
      },
      {
        titulo: "Gerar o CSC",
        texto: "No e-Fisco: Tributário → Notas Fiscais → DFE → CSC → Incluir, pela raiz do CNPJ e por ambiente. No máximo 2 CSC por ambiente por raiz.",
      },
    ],
    links: [{ rotulo: "e-Fisco (SEFAZ-PE)", url: "https://efisco.sefaz.pe.gov.br/" }],
    avisos: [SERIE_NOVA],
  },
  SC: {
    uf: "SC",
    titulo: "Santa Catarina — SEF-SC (SAT)",
    passos: [
      CERTIFICADO,
      {
        titulo: "Credenciamento (TTD 706 e 707)",
        texto:
          "No SAT (tributario.sef.sc.gov.br): peça o TTD 706 (homologação) e o TTD 707 (produção), sem taxa. A nota de produção só sai com o TTD deferido, e a empresa precisa ter o DTEC (domicílio tributário eletrônico).",
      },
      {
        titulo: "Gerar o CSC",
        texto: "SAT → \"Gestão do CSC\", com o certificado do titular, sócio, responsável ou contabilista. Até 2 CSC por ambiente por raiz de CNPJ.",
      },
    ],
    links: [
      { rotulo: "SAT — Gestão do CSC", url: "https://tributario.sef.sc.gov.br/tax.NET/Sat.Dfe.NFCe.Web/GestaoDeCscs.aspx" },
      { rotulo: "SEF-SC — NFC-e", url: "https://www.sef.sc.gov.br/nfce" },
    ],
    avisos: [CSC_NO_NAVEGADOR, SERIE_NOVA],
  },
  PI: {
    uf: "PI",
    titulo: "Piauí — SEFAZ-PI (SIAT Web)",
    passos: [
      CERTIFICADO,
      {
        titulo: "Credenciamento",
        texto: "Pedir em webas.sefaz.pi.gov.br/credenciamentoNFe (tipo NFC-e), com a Inscrição Estadual e o e-mail cadastrado na DIEF.",
      },
      { titulo: "Gerar o CSC", texto: "No SIAT Web (siatweb.sefaz.pi.gov.br): Autoatendimento → NFC-e → Manutenção do CSC." },
    ],
    links: [
      { rotulo: "SIAT Web (SEFAZ-PI)", url: "https://siatweb.sefaz.pi.gov.br/portal-publico" },
      { rotulo: "Credenciamento NFC-e", url: "https://webas.sefaz.pi.gov.br/credenciamentoNFe/?tipo=NFCe" },
    ],
    avisos: [FONTE_DE_TERCEIROS, SERIE_NOVA],
  },
  MT: {
    uf: "MT",
    titulo: "Mato Grosso — SEFAZ-MT",
    passos: [
      CERTIFICADO,
      { titulo: "Credenciamento", texto: "Automático para quem tem inscrição no ICMS (Portaria 177/2021). O MEI opta pelo CREDESP." },
      {
        titulo: "Gerar o CSC",
        texto:
          "Homologação: formulário público do portal da NFC-e, pela Inscrição Estadual. Produção: área restrita do portal → Nota Fiscal de Consumidor Eletrônica → Gerar CSC, com o certificado digital. Até 2 CSC por raiz; a revogação é na mesma tela.",
      },
    ],
    links: [{ rotulo: "Portal NFC-e SEFAZ-MT", url: "https://www.sefaz.mt.gov.br/portal/nfce/" }],
    avisos: [CSC_NO_NAVEGADOR, SERIE_NOVA],
  },
  MA: {
    uf: "MA",
    titulo: "Maranhão — SEFAZ-MA (SefazNet)",
    passos: [
      CERTIFICADO,
      { titulo: "Credenciamento", texto: "Sai ao informar a Inscrição Estadual, nos dois ambientes." },
      { titulo: "Gerar o CSC", texto: "No SefazNet (senha ou certificado): Autoatendimento → gerar o CSC de cada ambiente." },
    ],
    links: [{ rotulo: "SefazNet (SEFAZ-MA)", url: "https://sefaznet.sefaz.ma.gov.br/sefaznet/login.do?method=prepareLogin" }],
    avisos: [FONTE_DE_TERCEIROS, SERIE_NOVA],
  },
  ES: {
    uf: "ES",
    titulo: "Espírito Santo — SEFAZ-ES (Agência Virtual)",
    passos: [
      CERTIFICADO,
      { titulo: "Credenciamento", texto: "No site da SEFAZ-ES, credenciar a empresa em homologação e em produção (precisa pedir)." },
      {
        titulo: "Receber o CSC",
        texto: "O CSC de cada ambiente é enviado por e-mail ao contador e fica na página do credenciamento. Anote o ID e o código dos dois.",
      },
    ],
    links: [{ rotulo: "SEFAZ-ES — credenciamento NFC-e", url: "https://internet.sefaz.es.gov.br/informacoes/nfcEletronica/credenciamento.php" }],
    avisos: [SERIE_NOVA],
  },
  RN: {
    uf: "RN",
    titulo: "Rio Grande do Norte — SET-RN (UVT)",
    passos: [
      CERTIFICADO,
      { titulo: "Credenciamento", texto: "Pedir na SET-RN, pela Unidade Virtual de Tributação (UVT)." },
      { titulo: "Gerar o CSC", texto: "UVT → Meus Serviços → Gerar CSC — um para cada ambiente." },
    ],
    links: [{ rotulo: "UVT (SET-RN)", url: "https://uvt.set.rn.gov.br/" }],
    avisos: [FONTE_DE_TERCEIROS, SERIE_NOVA],
  },
  TO: {
    uf: "TO",
    titulo: "Tocantins — SEFAZ-TO",
    passos: [
      CERTIFICADO,
      { titulo: "Credenciamento", texto: "No portal da NFC-e → \"Credenciamento\" (apps.sefaz.to.gov.br/tcredpro), com o certificado digital." },
      { titulo: "Gerar o CSC", texto: "Portal NFC-e → \"Gerar/Consultar CSC\" — o de homologação e o de produção." },
    ],
    links: [
      { rotulo: "Portal NFC-e SEFAZ-TO", url: "https://www.sefaz.to.gov.br/nfce" },
      { rotulo: "Gerar/Consultar CSC", url: "https://www.sefaz.to.gov.br/nfce2/pages/contribuinte/csc.jsf" },
    ],
    avisos: [CSC_NO_NAVEGADOR, SERIE_NOVA],
  },
  PB: {
    uf: "PB",
    titulo: "Paraíba — SEFAZ-PB (SER Virtual)",
    passos: [
      CERTIFICADO,
      { titulo: "Credenciamento", texto: "Pedir no SER Virtual, com o login da empresa." },
      { titulo: "Gerar o CSC", texto: "SER Virtual → Documentos Fiscais → NFC-e → Gerar CSC (só pelo computador, não pelo celular)." },
    ],
    links: [{ rotulo: "SER Virtual — Gerar CSC", url: "https://www.sefaz.pb.gov.br/servirtual/documentos-fiscais/nfc-e/gerar-csc" }],
    avisos: [SERIE_NOVA],
  },
  AM: {
    uf: "AM",
    titulo: "Amazonas — SEFAZ-AM (DT-e)",
    passos: [
      CERTIFICADO,
      { titulo: "Credenciamento", texto: "Nenhum: a SEFAZ-AM diz que não é preciso processo para aderir à NFC-e." },
      { titulo: "Gerar o CSC", texto: "No DT-e (online.sefaz.am.gov.br), com o certificado digital da empresa — um por ambiente." },
    ],
    links: [
      { rotulo: "DT-e (SEFAZ-AM)", url: "https://online.sefaz.am.gov.br/inicioDte.asp" },
      { rotulo: "Portal NFC-e SEFAZ-AM", url: "https://portalnfce.sefaz.am.gov.br" },
    ],
    avisos: [CSC_NO_NAVEGADOR, SERIE_NOVA],
  },
  MS: {
    uf: "MS",
    titulo: "Mato Grosso do Sul — SEFAZ-MS (Portal DFE)",
    passos: [
      CERTIFICADO,
      CREDENCIAMENTO_AUTOMATICO,
      { titulo: "Gerar o CSC", texto: "No Portal DFE-MS → CSC, com o e-CNPJ da raiz e a Inscrição Estadual ativa — um por ambiente." },
    ],
    links: [{ rotulo: "Portal DFE-MS — CSC", url: "https://www.dfe.ms.gov.br/csc/" }],
    avisos: [CSC_NO_NAVEGADOR, SERIE_NOVA],
  },
  RO: {
    uf: "RO",
    titulo: "Rondônia — SEFIN-RO (Portal do Contribuinte)",
    passos: [
      CERTIFICADO,
      { titulo: "Credenciamento", texto: "Pedir no Portal do Contribuinte (DET, login gov.br); a liberação é na hora." },
      { titulo: "Gerar o CSC", texto: "No mesmo portal. Só 2 CSC ativos por empresa." },
    ],
    links: [{ rotulo: "Portal do Contribuinte (DET)", url: "https://det.sefin.ro.gov.br/" }],
    avisos: [
      "Em Rondônia o CSC de produção vale também para homologação: cadastre o mesmo ID e código nos dois ambientes aqui no FireHub.",
      SERIE_NOVA,
    ],
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
  avisos: [CSC_NO_NAVEGADOR, SERIE_NOVA],
};

/** O passo a passo da UF (o genérico quando o FireHub ainda não conferiu a UF). */
export function passoAPassoDaUf(uf: unknown): PassoAPasso {
  const u = String(uf ?? "").trim().toUpperCase();
  return PASSO_A_PASSO_DO_EMISSOR[u] ?? { uf: u, ...GENERICO };
}
