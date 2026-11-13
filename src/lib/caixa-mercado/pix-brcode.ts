/**
 * O PIX NA TELA DO CAIXA — o "copia e cola" (BR Code) estático COM valor e
 * txid, montado aqui, sem Asaas e sem taxa: o dinheiro cai direto na chave da
 * loja (a mesma que o robô manda, `chatbotConfig.pixDaLoja`).
 *
 * Formato EMV® QRCPS (Manual de Padrões para Iniciação do Pix, BACEN):
 *   00 versão "01" · 01 "11" (estático, opcional) · 26 conta Pix
 *   (00 "br.gov.bcb.pix", 01 chave) · 52 "0000" · 53 "986" · 54 valor ·
 *   58 "BR" · 59 nome (até 25) · 60 cidade (até 15) · 62 (05 txid) ·
 *   63 CRC16-CCITT (0x1021, início 0xFFFF) sobre tudo até "6304".
 *
 * Estático não avisa ninguém quando o cliente paga: quem confere é o operador
 * (no app do banco ou no Pix que apita) e aperta "recebido" — a venda grava
 * quem confirmou. O txid aparece no extrato do banco da loja na maioria dos
 * bancos, para achar o pagamento.
 *
 * Puro: sem banco, sem rede (scripts/teste-caixa-de-mercado.ts confere o CRC
 * contra o exemplo do manual do BACEN).
 */

/** CRC16-CCITT-FALSE em hexadecimal maiúsculo de 4 dígitos. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  const bytes = Buffer.from(texto, "utf8");
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const campo = (id: string, valor: string) => `${id}${String(Buffer.byteLength(valor, "utf8")).padStart(2, "0")}${valor}`;

/** Nome e cidade só com letras sem acento, números e espaço (o que todo banco lê). */
export function textoDoPix(v: string, max: number): string {
  return String(v || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, " ").replace(/\s+/g, " ").trim()
    .slice(0, max).trim();
}

/** txid do Pix estático: até 25 letras e números ("***" = sem txid). */
export function txidValido(txid: string): boolean {
  return txid === "***" || /^[A-Za-z0-9]{1,25}$/.test(txid);
}

export type DadosDoBrCode = {
  chave: string;
  nome: string;
  cidade: string;
  /** Sem valor (nulo) o cliente digita; o caixa sempre manda o valor. */
  valorCentavos?: number | null;
  txid?: string;
  /** "11" = estático. O exemplo do manual não traz o campo 01. */
  pontoDeIniciacao?: "11" | null;
  descricao?: string | null;
};

export function montarBrCode(d: DadosDoBrCode): string {
  const chave = String(d.chave || "").trim();
  if (!chave) throw new Error("Chave Pix vazia.");
  const txid = d.txid || "***";
  if (!txidValido(txid)) throw new Error("txid inválido (até 25 letras e números).");
  const nome = textoDoPix(d.nome, 25) || "LOJA";
  const cidade = textoDoPix(d.cidade, 15) || "BRASIL";
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", chave) + (d.descricao ? campo("02", textoDoPix(d.descricao, 40)) : "");
  let corpo = campo("00", "01");
  if (d.pontoDeIniciacao) corpo += campo("01", d.pontoDeIniciacao);
  corpo += campo("26", conta) + campo("52", "0000") + campo("53", "986");
  if (d.valorCentavos != null) {
    if (!Number.isInteger(d.valorCentavos) || d.valorCentavos <= 0) throw new Error("Valor do Pix em centavos inteiros.");
    corpo += campo("54", (d.valorCentavos / 100).toFixed(2));
  }
  corpo += campo("58", "BR") + campo("59", nome) + campo("60", cidade) + campo("62", campo("05", txid)) + "6304";
  return corpo + crc16(corpo);
}

/** Um txid novo para a venda: "CX" + 18 letras/números (cabe nos 25). */
export function novoTxid(aleatorio: () => number = Math.random): string {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "CX";
  for (let i = 0; i < 18; i++) s += alfabeto[Math.floor(aleatorio() * alfabeto.length)];
  return s;
}

/** A cidade do cadastro ("Cabo Frio - RJ") sem a UF. */
export function cidadeDoCadastro(city: string | null | undefined): string {
  return String(city || "").split(/\s+-\s+|\//)[0].trim();
}
