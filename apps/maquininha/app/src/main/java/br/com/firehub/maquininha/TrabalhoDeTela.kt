package br.com.firehub.maquininha

import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executors

/**
 * Tira da thread principal o que as telas precisam pedir ao SDK e ao servidor.
 *
 * Uma thread só, de propósito. Toda operação do PlugPag é bloqueante e não
 * admite concorrência: com uma fila única, dois toques rápidos no botão de
 * ativar viram duas tarefas em sequência, e não duas chamadas simultâneas ao
 * serviço do PagBank devolvendo "serviço ocupado".
 */
object TrabalhoDeTela {

    private val fila = Executors.newSingleThreadExecutor { tarefa ->
        Thread(tarefa, "trabalho-de-tela").apply { isDaemon = true }
    }

    private val threadPrincipal = Handler(Looper.getMainLooper())

    /**
     * Roda `tarefa` fora da thread principal e entrega o resultado de volta nela.
     *
     * Exceção não derruba o app: o retorno vem embrulhado em Result, e cada tela
     * decide o que dizer ao operador. Um crash aqui apagaria a única mensagem
     * que explicaria o que houve.
     */
    fun <T> fazer(tarefa: () -> T, aoTerminar: (Result<T>) -> Unit) {
        fila.execute {
            val resultado = try {
                Result.success(tarefa())
            } catch (erro: Throwable) {
                Result.failure(erro)
            }
            threadPrincipal.post { aoTerminar(resultado) }
        }
    }
}
