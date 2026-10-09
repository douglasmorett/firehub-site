/**
 * Emissor próprio de NFC-e: chave de acesso (DV, cNF) e URL do QR Code.
 *
 *   npx tsx scripts/teste-nfce-chave-qrcode.ts
 *
 * Os valores esperados do QR saem LITERALMENTE dos exemplos do "Manual de
 * Padrões — DANFE NFC-e e QR-Code" v6.0 (seções 4.3.6.1 e 4.3.6.2). O DV da
 * chave é conferido contra uma implementação independente da regra da NT
 * Conjunta 2025.001 (ASCII − 48, módulo 11, pesos 2–9 da direita).
 */
import {
  CNF_PROIBIDOS,
  chaveValida,
  codigoNumericoValido,
  digitoDaChave,
  gerarCodigoNumerico,
  lerChave,
  montarChave,
} from "../src/lib/nfce/chave";
import {
  digestEmHex,
  idCscSemZeros,
  parametrosV3Offline,
  qrCodeV2Offline,
  qrCodeV2Online,
  qrCodeV3Offline,
  qrCodeV3Online,
  urlsDaUf,
} from "../src/lib/nfce/qrcode";
import { urlDoServico } from "../src/lib/nfce/sefaz";
import { ufsDoEmissorProprio } from "../src/lib/nfce/pendencias";
import { assinarTextoRsaSha1, verificarTextoRsaSha1 } from "../src/lib/nfce/assinatura";
import { certificadoDeTeste, confere, terminar, verdade } from "./nfce-teste-apoio";

/** DV "de papel": escrito de novo, do jeito que a NT descreve, sem olhar o código de produção. */
function dvDePapel(c43: string): { dv: number; resto: number } {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  const valores = c43.split("").reverse().map((ch) => ch.charCodeAt(0) - 48);
  const soma = valores.reduce((s, v, i) => s + v * pesos[i % 8], 0);
  const resto = soma % 11;
  return { dv: resto === 0 || resto === 1 ? 0 : 11 - resto, resto };
}

console.log("\n— Dígito verificador —");
{
  // Exemplo resolvido do MOC 7.0 (Visão Geral, 2.2.6.2): soma 644, resto 6, DV 5.
  const doMoc = "5206043300991100250655012000000780026730161";
  confere("DV do exemplo resolvido do MOC 7.0 = 5", digitoDaChave(doMoc), 5);
  confere("a chave do MOC com o DV passa em chaveValida", chaveValida(doMoc + "5"), true);
  confere("a mesma chave com outro DV não passa", chaveValida(doMoc + "4"), false);
  // A chave do exemplo do Manual QR é HIPOTÉTICA: o DV dela não fecha (serve
  // só para o hash). Conferido aqui para ninguém usá-la como âncora de DV.
  confere("a chave hipotética do Manual QR não fecha o DV", chaveValida("28170800156225000131650110000151341562040824"), false);
  const daFocus = "41190612345678000123650010000000121743484310"; // exemplo de doc.focusnfe.com.br
  confere("DV da chave de exemplo da Focus = " + daFocus.slice(-1), digitoDaChave(daFocus.slice(0, 43)), dvDePapel(daFocus.slice(0, 43)).dv);

  // CNPJ alfanumérico (exemplo da Receita, NT Conjunta 2025.001): letra vale ASCII − 48.
  const alfa = montarChave({ uf: "DF", anoMes: "2609", cnpj: "12ABC34501DE35", serie: 1, numero: 42, tipoDeEmissao: 1, codigoNumerico: "38561927" });
  confere("chave com CNPJ alfanumérico tem 44 posições e letras no lugar do CNPJ", [alfa.length, alfa.slice(6, 20)], [44, "12ABC34501DE35"]);
  confere("DV da chave alfanumérica = regra ASCII−48", Number(alfa[43]), dvDePapel(alfa.slice(0, 43)).dv);
  confere("chave alfanumérica passa em chaveValida (schema TChNFe)", chaveValida(alfa), true);

  // Varredura: 5000 chaves sorteadas, o DV bate com a conta de papel; e as
  // de resto 0 e 1 dão DV 0.
  let erradas = 0;
  let restoZeroOuUm = 0;
  for (let i = 0; i < 5000; i++) {
    const cNF = gerarCodigoNumerico(i + 1);
    const ch = montarChave({ uf: "53", anoMes: "2609", cnpj: "64568087000180", serie: i % 999, numero: i + 1, tipoDeEmissao: i % 2 ? 9 : 1, codigoNumerico: cNF });
    const papel = dvDePapel(ch.slice(0, 43));
    if (Number(ch[43]) !== papel.dv) erradas++;
    if (papel.resto < 2) restoZeroOuUm++;
  }
  confere("5000 chaves: DV igual à conta de papel", erradas, 0);
  verdade("a varredura passou por restos 0 e 1 (DV 0)", restoZeroOuUm > 0, "nenhuma chave com resto 0/1");
}

console.log("\n— Composição da chave —");
{
  const ch = montarChave({ uf: "DF", anoMes: "2609", cnpj: "64.568.087/0001-80", serie: 1, numero: 123, tipoDeEmissao: 9, codigoNumerico: "84736251" });
  const p = lerChave(ch);
  confere("partes: cUF 53, AAMM, CNPJ, mod 65, série 001, nNF, tpEmis 9, cNF", [p.cUF, p.anoMes, p.cnpj, p.modelo, p.serie, p.numero, p.tipoDeEmissao, p.codigoNumerico], ["53", "2609", "64568087000180", 65, 1, 123, 9, "84736251"]);
  confere("posições 23–34: série 3 + nNF 9 com zeros", ch.slice(22, 34), "001000000123");
  const recusa = (oQue: string, f: () => unknown) => {
    try {
      f();
      verdade(oQue, false, "não recusou");
    } catch {
      verdade(oQue, true);
    }
  };
  recusa("UF desconhecida", () => montarChave({ uf: "XX", anoMes: "2609", cnpj: "64568087000180", serie: 1, numero: 1, tipoDeEmissao: 1, codigoNumerico: "84736251" }));
  recusa("mês 13", () => montarChave({ uf: "DF", anoMes: "2613", cnpj: "64568087000180", serie: 1, numero: 1, tipoDeEmissao: 1, codigoNumerico: "84736251" }));
  recusa("série 1000", () => montarChave({ uf: "DF", anoMes: "2609", cnpj: "64568087000180", serie: 1000, numero: 1, tipoDeEmissao: 1, codigoNumerico: "84736251" }));
  recusa("número 0", () => montarChave({ uf: "DF", anoMes: "2609", cnpj: "64568087000180", serie: 1, numero: 0, tipoDeEmissao: 1, codigoNumerico: "84736251" }));
  recusa("cNF proibido", () => montarChave({ uf: "DF", anoMes: "2609", cnpj: "64568087000180", serie: 1, numero: 1, tipoDeEmissao: 1, codigoNumerico: "12345678" }));
}

console.log("\n— cNF (regra B09-20, rejeição 897) —");
{
  confere("as 20 sequências proibidas", CNF_PROIBIDOS.size, 20);
  confere("nenhuma proibida passa", [...CNF_PROIBIDOS].filter((c) => codigoNumericoValido(c, 1)).length, 0);
  confere("cNF igual ao nNF não passa (00000123 × 123)", codigoNumericoValido("00000123", 123), false);
  confere("cNF com 7 dígitos não passa", codigoNumericoValido("1234567", 1), false);
  confere("cNF comum passa", codigoNumericoValido("38561927", 1), true);
  // Sorteador viciado: devolve primeiro o proibido, depois o nNF, depois um bom.
  const fila = [12345678, 55555555, 777, 38561927];
  confere("gerar pula proibidos e o próprio nNF", gerarCodigoNumerico(777, () => fila.shift()!), "38561927");
  const sorteados = Array.from({ length: 2000 }, (_, i) => gerarCodigoNumerico(i + 1));
  confere("2000 sorteados: todos com 8 dígitos e válidos", sorteados.filter((c, i) => !codigoNumericoValido(c, i + 1)).length, 0);
  verdade("sorteio é aleatório (quase sem repetição)", new Set(sorteados).size > 1990, `${new Set(sorteados).size} distintos`);
}

console.log("\n— QR Code v2 (exemplos do Manual QR 6.0) —");
{
  const URL = "http://www.sefazexemplo.gov.br/nfce/qrcode";
  const CSC = "SEU-CODIGO-CSC-CONTRIBUINTE-36-CARACTERES";
  confere(
    "v2 online: URL e hash DC6AE2C2… do exemplo 4.3.6.1",
    qrCodeV2Online({ urlBase: URL, chave: "28170800156225000131650110000151341562040824", ambiente: 1, idCsc: "000001", csc: CSC }),
    "http://www.sefazexemplo.gov.br/nfce/qrcode?p=28170800156225000131650110000151341562040824|2|1|1|DC6AE2C2B9A992BE59679AC365E29922DE6B7511"
  );
  confere("digVal em hex do exemplo 4.3.6.2", digestEmHex("yzGYhUx1/XYYzksWB+fPR3Qc50c="), "797a4759685578312f5859597a6b7357422b6650523351633530633d");
  confere(
    "v2 offline: URL e hash 4615A93B… do exemplo 4.3.6.2",
    qrCodeV2Offline({
      urlBase: URL,
      chave: "28170800156225000131650110000151349562040824",
      ambiente: 1,
      dia: "02",
      valorTotalEmCentavos: 6090,
      digestValue: "yzGYhUx1/XYYzksWB+fPR3Qc50c=",
      idCsc: 1,
      csc: CSC,
    }),
    "http://www.sefazexemplo.gov.br/nfce/qrcode?p=28170800156225000131650110000151349562040824|2|1|02|60.90|797a4759685578312f5859597a6b7357422b6650523351633530633d|1|4615A93BB0D7C4E780F8D30EE77EDD5BA55C7D66"
  );
  confere("idCSC sem zeros à esquerda", [idCscSemZeros("000001"), idCscSemZeros("12"), idCscSemZeros(3)], ["1", "12", "3"]);
  let recusou = false;
  try {
    qrCodeV2Online({ urlBase: URL, chave: "28170800156225000131650110000151341562040824", ambiente: 1, idCsc: "1", csc: "curto" });
  } catch {
    recusou = true;
  }
  confere("CSC vazio/cortado é recusado", recusou, true);
}

console.log("\n— QR Code v3 (NT 2025.001) —");
{
  const cert = certificadoDeTeste();
  const chave = "53260964568087000180650010000001239847362510";
  const chaveOff = montarChave({ uf: "DF", anoMes: "2609", cnpj: "64568087000180", serie: 1, numero: 123, tipoDeEmissao: 9, codigoNumerico: "84736251" });
  confere("v3 online: só chave|3|tpAmb", qrCodeV3Online({ urlBase: "http://www.fazenda.df.gov.br/nfce/qrcode", chave, ambiente: 2 }), `http://www.fazenda.df.gov.br/nfce/qrcode?p=${chave}|3|2`);
  const semDest = parametrosV3Offline({ chave: chaveOff, ambiente: 2, dia: "29", valorTotalEmCentavos: 1560 });
  confere("v3 offline sem destinatário: só os separadores", semDest, `${chaveOff}|3|2|29|15.60||`);
  const comCpf = parametrosV3Offline({ chave: chaveOff, ambiente: 2, dia: "29", valorTotalEmCentavos: 1560, destinatario: { tipo: 2, id: "529.982.247-25" } });
  confere("v3 offline com CPF: tipo 2 + CPF limpo", comCpf, `${chaveOff}|3|2|29|15.60|2|52998224725`);
  const url = qrCodeV3Offline({
    urlBase: "http://www.fazenda.df.gov.br/nfce/qrcode",
    chave: chaveOff,
    ambiente: 2,
    dia: "29",
    valorTotalEmCentavos: 1560,
    destinatario: { tipo: 2, id: "52998224725" },
    assinar: (t) => assinarTextoRsaSha1(t, cert.chavePrivadaPem),
  });
  const assinatura = url.split("|").pop()!;
  verdade("v3 offline: assinatura RSA-SHA1 dos parâmetros 1–7 confere com o certificado", verificarTextoRsaSha1(comCpf, assinatura, cert.certificadoPem));
  verdade("v3 offline: assinatura NÃO confere com outro valor", !verificarTextoRsaSha1(comCpf.replace("15.60", "15.61"), assinatura, cert.certificadoPem));
}

console.log("\n— Endereços por UF —");
{
  confere("DF produção", urlsDaUf("DF", 1), { qrCode: "http://www.fazenda.df.gov.br/nfce/qrcode", urlChave: "www.fazenda.df.gov.br/nfce/consulta" });
  confere("DF homologação (mesmo endereço)", urlsDaUf("df", 2).qrCode, "http://www.fazenda.df.gov.br/nfce/qrcode");
  confere("MG homologação: urlChave hportalsped", urlsDaUf("MG", 2).urlChave, "https://hportalsped.fazenda.mg.gov.br/portalnfce");
  confere("PA homologação: portal-homologacao", urlsDaUf("PA", 2).qrCode, "https://appnfc.sefa.pa.gov.br/portal-homologacao/view/consultas/nfce/nfceForm.seam");
  confere("RJ: consultadfe", urlsDaUf("RJ", 1).qrCode, "https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode");
  // As 27 UF (09/10/2026): cada uma com QR Code E urlChave nos dois
  // ambientes, dentro do que o schema aceita, e com autorizador conhecido.
  const TODAS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
  confere("o emissor atende as 27 UF", ufsDoEmissorProprio(), TODAS);
  for (const uf of TODAS) {
    for (const amb of [1, 2] as const) {
      const { qrCode, urlChave } = urlsDaUf(uf, amb);
      verdade(`urlChave ${uf}/${amb} cabe no schema (21–85)`, urlChave.length >= 21 && urlChave.length <= 85, `${urlChave.length}`);
      verdade(`qrCode ${uf}/${amb} é http(s) sem "?" no fim`, /^https?:\/\/\S+[^?]$/.test(qrCode), qrCode);
      for (const servico of ["autorizacao", "retAutorizacao", "consulta", "status", "evento", "inutilizacao"] as const) {
        const url = urlDoServico(uf, amb, servico);
        verdade(`webservice ${uf}/${amb}/${servico} é https sem "?wsdl"`, /^https:\/\/\S+$/.test(url) && !/\?/.test(url), url);
      }
    }
  }
  confere("SP produção: QR do portal", urlsDaUf("SP", 1).qrCode, "https://www.nfce.fazenda.sp.gov.br/qrcode");
  confere("SP homologação: webservice de homologação", urlDoServico("SP", 2, "autorizacao"), "https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx");
  confere("BA vai na SVRS (NFC-e, não NF-e)", urlDoServico("BA", 1, "status"), "https://nfce.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx");
  confere("GO: sem ?wsdl na chamada", urlDoServico("GO", 1, "evento"), "https://nfe.sefaz.go.gov.br/nfe/services/NFeRecepcaoEvento4");
  let recusou = false;
  try {
    urlsDaUf("ZZ", 1);
  } catch {
    recusou = true;
  }
  confere("UF sem tabela: recusa em vez de inventar", recusou, true);
}

terminar();
