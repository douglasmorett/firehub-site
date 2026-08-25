package br.com.firehub.maquininha.servico

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.SystemClock
import br.com.firehub.maquininha.Ajustes

/**
 * De quanto em quanto tempo perguntar ao servidor se tem cobrança.
 *
 * Duas variáveis mandam nisso: quanto tempo faz que houve movimento, e por onde
 * o aparelho está falando. Loja parada não precisa ser perguntada de 2 em 2
 * segundos; chip de operadora não aguenta ser perguntado de 2 em 2 segundos.
 *
 * A conta de consumo que sustenta os números está no README.
 */
class RitmoDoPolling(context: Context) {

    private val app = context.applicationContext

    /**
     * elapsedRealtime, não currentTimeMillis, de propósito.
     *
     * O terminal acerta o relógio pela rede assim que pega sinal. Se isso
     * acontecer no meio do expediente, o relógio pula, e uma conta de "faz
     * quanto tempo" feita em currentTimeMillis daria horas ou um número
     * negativo. elapsedRealtime só anda para a frente, desde o último boot.
     */
    @Volatile
    private var ultimoMovimento: Long = SystemClock.elapsedRealtime()

    /**
     * Reinicia a escada para o degrau mais rápido.
     *
     * "Movimento" é qualquer sinal de que a loja está viva: cobrança recebida,
     * resultado enviado, o operador abrindo a tela. Restaurante tem pedido em
     * rajada — um pedido quase sempre significa outro pedido logo atrás, e é
     * exatamente aí que o cliente não pode esperar.
     */
    fun houveMovimento() {
        ultimoMovimento = SystemClock.elapsedRealtime()
    }

    fun intervaloMs(): Long {
        val parado = SystemClock.elapsedRealtime() - ultimoMovimento
        val escada = if (estaNoWifi()) Ajustes.ESCADA_NO_WIFI else Ajustes.ESCADA_NO_CHIP
        // O último degrau cujo tempo de espera já foi ultrapassado.
        return escada.last { degrau -> parado >= degrau.depoisDeParadoMs }.intervaloMs
    }

    /**
     * Wi-Fi ou cabo contam como rede da loja: nos dois o tráfego é da loja e não
     * há franquia para proteger.
     *
     * Quando não dá para saber, a resposta é "não". Errar para o lado do chip
     * custa alguns segundos a mais de espera; errar para o lado do Wi-Fi custa a
     * franquia do mês inteiro numa tarde.
     */
    fun estaNoWifi(): Boolean {
        val gerente = app.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return false
        val rede = gerente.activeNetwork ?: return false
        val recursos = gerente.getNetworkCapabilities(rede) ?: return false
        return recursos.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            recursos.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    /** Para a notificação e para o log: "Wi-Fi, a cada 2 s". */
    fun descricao(): String {
        val onde = if (estaNoWifi()) "Wi-Fi" else "chip"
        val segundos = intervaloMs() / 1000
        return onde + ", a cada " + segundos + " s"
    }
}
