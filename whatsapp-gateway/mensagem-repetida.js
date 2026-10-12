/**
 * A MESMA MENSAGEM DUAS VEZES
 *
 * O Baileys 7 às vezes entrega o mesmo `messages.upsert` ("notify") duas vezes
 * no mesmo milissegundo. Pizzaria 17, 12/10/2026 19h10: a cliente pediu uma
 * reserva UMA vez e recebeu as regras, as 2 fotos de decoração e a ficha em
 * dobro — o log tinha duas linhas "mensagem recebida" iguais às 22:10:35.077,
 * e o FireHub respondeu as duas. Foi 1 em 48 mensagens daquela hora.
 *
 * O id da mensagem (key.id) é único na conversa: visto há menos de 10 minutos
 * na mesma instância e no mesmo contato, a segunda não vai ao FireHub. Quem
 * chama marca só mensagem COM conteúdo: a que não decifrou (sem `message`)
 * volta com o mesmo id quando o celular reenvia, e essa tem de passar.
 */
const JANELA_MS = 10 * 60 * 1000;
const LIMITE = 5000;

function criarFiltroDeRepetidas({ janelaMs = JANELA_MS, limite = LIMITE, agora = () => Date.now() } = {}) {
  const vistas = new Map(); // chave → quando foi vista

  return function jaVista(instanceName, msg) {
    const id = msg && msg.key && msg.key.id;
    if (!id) return false;
    const chave = `${instanceName}|${msg.key.remoteJid || ""}|${msg.key.fromMe ? 1 : 0}|${id}`;
    const t = agora();
    const antes = vistas.get(chave);
    if (antes !== undefined && t - antes < janelaMs) return true;
    vistas.set(chave, t);

    if (vistas.size > limite) {
      for (const [k, quando] of vistas) if (t - quando >= janelaMs) vistas.delete(k);
      // Rajada maior que o limite dentro da janela: sai a mais antiga.
      while (vistas.size > limite) vistas.delete(vistas.keys().next().value);
    }
    return false;
  };
}

module.exports = { criarFiltroDeRepetidas, JANELA_MS };
