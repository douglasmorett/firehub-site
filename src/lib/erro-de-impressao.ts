/**
 * O erro que o Assistente de Impressão registra numa comanda presa, em
 * português de balcão.
 *
 * O texto cru é "Falha ao enviar dados para impressora 'ELGIN i8' (Win32
 * 1801)" — certo para o log, inútil para quem está com a fila de pedidos
 * parada. Os códigos abaixo são os que aparecem em loja; qualquer outro sai
 * como veio, com o número, para o suporte procurar.
 */
const WIN32: Record<string, string> = {
  "1801": "o Windows não tem impressora com esse nome (renomeada, ou cadastrada com o nome errado)",
  "5": "o Windows negou acesso à impressora (usuário sem permissão)",
  "6": "o Windows perdeu a conexão com a impressora (cabo USB solto?)",
  "1722": "o serviço de impressão do Windows (spooler) não está respondendo — reinicie o PC",
  "1727": "o serviço de impressão do Windows (spooler) não está respondendo — reinicie o PC",
  "1906": "a impressora está pausada ou em erro no Windows",
  "2": "o Windows não encontrou o driver da impressora",
};

export function traduzErroDeImpressao(erro: string | null | undefined): string {
  const texto = String(erro || "").trim();
  if (!texto) return "";
  if (/nao respondeu em \d+ s/i.test(texto)) {
    return "a impressora não respondeu (desligada, sem papel ou cabo solto)";
  }
  const win32 = texto.match(/Win32 (\d+)/i)?.[1];
  if (win32 && WIN32[win32]) return WIN32[win32];
  return texto.split("\n")[0].slice(0, 140);
}
