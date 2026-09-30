import { garantirEstruturaDoCrm } from "@/lib/garantir-colunas";
import { mesmoTelefone } from "@/lib/telefone";
import { contatoDaConversa } from "@/lib/crm/contatos";
import { gravarMensagem } from "@/lib/crm/mensagens";
import { jidDoTelefone } from "@/lib/crm/telefone";
import { configDoAtendimento } from "./config";
import { enviarTexto } from "./whatsapp";

/**
 * Aviso do SISTEMA para um número (lojista cujo robô caiu, alerta interno)
 * saindo pelo WhatsApp do FireHub — `avisarNumeroPeloFireHub` tenta aqui
 * primeiro.
 *
 * Antes, o único "número do FireHub" era o da Hakim Centro: lojista recebia
 * "seu robô desconectou" de uma pizzaria. Com o número do atendimento
 * conectado, o aviso sai por ele e fica gravado na conversa — quando o lojista
 * responde "e agora?", a caixa de atendimento (e o robô de suporte) sabem do
 * que se trata. Fora do ar → `false`, e o chamador segue pelo caminho antigo.
 */
export async function avisoPeloNumeroDoFireHub(numero: string, texto: string): Promise<boolean> {
  try {
    if (!(await garantirEstruturaDoCrm())) return false;
    const config = await configDoAtendimento();
    if (config.conexao.conectado !== true) return false;
    if (config.conexao.telefone && mesmoTelefone(numero, config.conexao.telefone)) return false;
    const jid = jidDoTelefone(numero);
    if (!jid) return false;
    const envio = await enviarTexto(jid, texto);
    if (!envio.ok) return false;
    try {
      const contato = await contatoDaConversa({ telefone: numero, jid });
      await gravarMensagem({ contatoId: contato.id, direcao: "SAIDA", autor: "SISTEMA", autorNome: "Aviso automático", texto });
    } catch (err: any) {
      console.warn(`[Atendimento] Aviso saiu mas não ficou na conversa: ${err?.message}`);
    }
    return true;
  } catch {
    return false;
  }
}
