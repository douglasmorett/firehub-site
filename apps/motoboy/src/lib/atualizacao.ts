// Atualização pelo ar (EAS Update): mudança de tela chega sem passar pelas lojas.
//
// Até a 1.0 o app tinha o expo-updates mas não o endereço do servidor
// (app.json sem `updates.url`): nada que mudasse no app chegava ao celular sem
// build novo e revisão da Apple e do Google. Em 15/10/2026 a pendência do
// acerto ficou parada por isso.
//
// O nativo já baixa sozinho ao abrir, mas só APLICA na próxima vez que o app
// for aberto do zero — e entregador deixa o app aberto o dia inteiro. Aqui a
// gente procura e aplica nos dois momentos em que ninguém está no meio de uma
// entrega: quando o app abre e quando ele volta para a frente depois de um
// tempo fora. Recarregar só reinicia a parte em JavaScript; a tarefa do GPS é
// do sistema e continua.
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import * as Updates from "expo-updates";

/** Não procurar de novo antes disto: cada consulta é uma ida à rede. */
const INTERVALO_MS = 10 * 60 * 1000;

async function procurarEAplicar() {
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) return;
    const baixada = await Updates.fetchUpdateAsync();
    if (baixada.isNew) await Updates.reloadAsync();
  } catch {
    // Sem rede ou servidor fora: segue com a versão que já está no celular.
  }
}

export function useAtualizacaoAutomatica() {
  const ultima = useRef(0);
  useEffect(() => {
    const talvez = () => {
      if (Date.now() - ultima.current < INTERVALO_MS) return;
      ultima.current = Date.now();
      void procurarEAplicar();
    };
    talvez();
    const sub = AppState.addEventListener("change", (estado) => {
      if (estado === "active") talvez();
    });
    return () => sub.remove();
  }, []);
}
