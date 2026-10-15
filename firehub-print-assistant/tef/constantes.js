/**
 * Constantes da PayGo Web (PGWebLib.dll) usadas pelo motor TEF.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CONFERIR NO .h DO KIT (PGWebLib.h / Enums do exemplo C#) quando o kit    │
 * │ chegar. Fontes usadas aqui (15/10/2026):                                 │
 * │  - paygodev.readme.io: "6 Funções da biblioteca" (PWOPER, PWCNF),        │
 * │    "10 Dicionário de dados" (PWINFO), "11 Códigos de retorno" (PWRET);  │
 * │  - exemplo oficial em C# indicado pela doc ("13 Código exemplo"):        │
 * │    github.com/adminti2/Integracao-PayGoWeb-CSharp (PWDAT, PW_GetData,    │
 * │    PWINFO_AUTCAP).                                                       │
 * │ As duas fontes batem entre si nos valores abaixo. O que NÃO foi achado   │
 * │ em nenhuma está marcado "NÃO ACHEI" e precisa vir do kit.                │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * O MESMO conjunto vai para o C# (PayGoHost.cs recebe estes números no
 * comando "iniciar"), para existir um lugar só a corrigir.
 */

const PWOPER = {
  SALE: 0x21, // PWOPER_SALE
  ADMIN: 0x20, // PWOPER_ADMIN
  INSTALL: 0x01, // PWOPER_INSTALL
};

const PWRET = {
  OK: 0,
  FROMHOSTPENDTRN: -2599, // há transação pendente: confirmar ou desfazer antes
  FROMHOST: -2596, // erro devolvido pela PayGo (ver PWINFO_RESULTMSG)
  INVPARAM: -2499,
  NOTINST: -2498, // ponto de captura não instalado (fazer PWOPER_INSTALL)
  MOREDATA: -2497,
  NODATA: -2496,
  DISPLAY: -2495,
  INVCALL: -2494,
  NOTHING: -2493,
  BUFOVFLW: -2492,
  CANCEL: -2491,
  TIMEOUT: -2490,
  PPNOTFOUND: -2489,
  DLLNOTINIT: -2487,
  FALLBACK: -2486,
  PPCOMERR: -2484,
  NOPINPAD: -2432,
};

const PWINFO = {
  OPERATION: 0x02,
  POSID: 0x11,
  AUTNAME: 0x15,
  AUTVER: 0x16,
  AUTDEV: 0x17,
  AUTCAP: 0x24,
  TOTAMNT: 0x25,
  CURRENCY: 0x26,
  CURREXP: 0x27,
  FISCALREF: 0x28,
  CARDTYPE: 0x29,
  REQNUM: 0x32,
  AUTHSYST: 0x35,
  VIRTMERCH: 0x36,
  FINTYPE: 0x3b,
  INSTALLMENTS: 0x3c,
  RESULTMSG: 0x42,
  CNFREQ: 0x43,
  AUTLOCREF: 0x44,
  AUTEXTREF: 0x45,
  AUTHCODE: 0x46,
  AUTRESPCODE: 0x47,
  CARDNAME: 0x4b,
  RCPTFULL: 0x52,
  RCPTMERCH: 0x53,
  RCPTCHOLDER: 0x54,
  RCPTCHSHORT: 0x55,
  PROCESSMSG: 0x6f,
  CARDNAMESTD: 0xc4,
  CARDPARCPAN: 0xc8,
  PAYMNTTYPE: 0x1f21,
  IDLEPROCTIME: 0x7f04,
  PNDAUTHSYST: 0x7f05,
  PNDVIRTMERCH: 0x7f06,
  PNDREQNUM: 0x7f07,
  PNDAUTLOCREF: 0x7f08,
  PNDAUTEXTREF: 0x7f09,
  PPINFO: 0x7f15,
};

/** bTipoDeDado de PW_GetData (exemplo C# oficial, Enums/PWDAT.cs). */
const PWDAT = {
  MENU: 1,
  TYPED: 2,
  CARDINF: 3,
  PPENTRY: 5,
  PPENCPIN: 6,
  CARDOFF: 9,
  CARDONL: 10,
  PPCONF: 11,
  BARCODE: 12,
  PPREMCRD: 13,
  PPGENCMD: 14,
  PPDATAPOSCNF: 16,
  USERAUTH: 17,
  DSPCHECKOUT: 18,
  TSTKEY: 19,
  DSPQRCODE: 20,
};

/** Status do PW_iConfirmation (doc "6 Funções", PW_iConfirmation). */
const PWCNF = {
  CNF_AUTO: 0x00000121, // confirmada automaticamente
  CNF_MANU_AUT: 0x00003221,
  REV_MANU_AUT: 0x00003231,
  REV_PRN_AUT: 0x00013131, // desfeita: erro na impressão do comprovante
  REV_DISP_AUT: 0x00023131,
  REV_COMM_AUT: 0x00033131, // desfeita: erro de comunicação com a automação
  REV_ABORT: 0x00043131, // desfeita: transação abortada
  REV_OTHER_AUT: 0x00073131, // desfeita: outro motivo da automação (venda não gravada)
  REV_PWR_AUT: 0x00083131, // desfeita: queda de energia (pendência achada na volta)
  REV_FISC_AUT: 0x00093131,
};

/** PWINFO_AUTCAP (soma): o que a automação sabe fazer (exemplo C#, PWINFO_AUTCAP.cs). */
const AUTCAP = {
  VALOR_FIXO: 4, // "valor fixo, sempre incluir"
  VIAS_DIFERENCIADAS: 8, // comprovante em vias separadas loja/cliente
  CUPOM_REDUZIDO: 16,
  REMOCAO_CARTAO: 64, // trata PWDAT_PPREMCRD
  DSP_CHECKOUT: 128, // mostra mensagens no "checkout" (a tela do totem)
  DSP_QRCODE: 256, // NÃO ligamos: o totem ainda não desenha QR da carteira digital
};

/** PWINFO_CARDTYPE: 1 crédito, 2 débito (dicionário de dados). */
const CARDTYPE = { credito: "1", debito: "2" };
/** PWINFO_FINTYPE: 1 à vista. */
const FINTYPE_A_VISTA = "1";
/** PWINFO_PAYMNTTYPE: 1 cartão. */
const PAYMNTTYPE_CARTAO = "1";
/** Real (ISO 4217) e 2 casas. */
const MOEDA_REAL = "986";
const MOEDA_EXPOENTE = "2";

/**
 * NÃO ACHEI (CONFERIR NO .h DO KIT):
 *  - os valores de `iEnv` do PW_iSetEnvironment (homologação x produção). A
 *    doc só mostra a assinatura `Int16 PW_iSetEnvironment(Int16 iEnv)`. Por
 *    isso o motor só chama a função se `tef.json` tiver "ambiente" numérico.
 *  - quando chamar PW_iIdleProc: a doc manda chamar no horário de
 *    PWINFO_IDLEPROCTIME; o formato desse horário não está na doc pública.
 *    O motor chama a cada `idleProcSegundos` (padrão 30) com o pinpad ocioso.
 *  - o tamanho máximo de PWINFO_FISCALREF (mandamos até 10 caracteres).
 */

module.exports = {
  PWOPER,
  PWRET,
  PWINFO,
  PWDAT,
  PWCNF,
  AUTCAP,
  CARDTYPE,
  FINTYPE_A_VISTA,
  PAYMNTTYPE_CARTAO,
  MOEDA_REAL,
  MOEDA_EXPOENTE,
  AUTCAP_DO_TOTEM: AUTCAP.VALOR_FIXO + AUTCAP.VIAS_DIFERENCIADAS + AUTCAP.REMOCAO_CARTAO + AUTCAP.DSP_CHECKOUT,
};
