package br.com.firehub.maquininha.servico

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import br.com.firehub.maquininha.CofreDoToken

/**
 * Faz a maquininha voltar a receber pedido sozinha depois de reiniciar.
 *
 * O terminal fica ligado na tomada e reinicia por conta própria: atualização do
 * PagBank, queda de energia, alguém que segurou o botão. Sem isto, a loja abre e
 * o primeiro pedido do dia fica esperando na fila até alguém reparar que o app
 * não subiu — e ninguém repara, porque a tela do terminal mostra o launcher
 * normal.
 */
class ReceptorDeBoot : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val acao = intent?.action ?: return
        if (acao != Intent.ACTION_BOOT_COMPLETED && acao != ACAO_BOOT_RAPIDO) return

        // Sem pareamento não há o que fazer: o serviço subiria só para descobrir
        // que não tem crachá e se desligar em seguida. Nesse caso quem abre o
        // app é uma pessoa, para digitar o código.
        if (!CofreDoToken.estaPareada(context)) {
            Log.i(ETIQUETA, "Boot sem pareamento; o serviço não vai subir.")
            return
        }

        Log.i(ETIQUETA, "Boot concluído; subindo o serviço de cobrança.")
        ServicoDeCobranca.ligar(context)
    }

    private companion object {
        const val ETIQUETA = "ReceptorDeBoot"

        /** Alguns terminais mandam isto em vez de BOOT_COMPLETED. */
        const val ACAO_BOOT_RAPIDO = "android.intent.action.QUICKBOOT_POWERON"
    }
}
