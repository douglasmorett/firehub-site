package br.com.firehub.maquininha.estado

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import br.com.firehub.maquininha.rede.Cobranca
import br.com.firehub.maquininha.rede.TipoDePagamento
import java.util.concurrent.CopyOnWriteArrayList

/**
 * O ponto de encontro entre o serviço, que faz o trabalho numa thread própria, e
 * a tela, que só pode ser tocada na thread principal.
 *
 * Serviço e Activity vivem no mesmo processo, então um objeto compartilhado
 * resolve sem broadcast e sem binder. As mudanças de situação sempre chegam à
 * tela pela thread principal; o caminho de volta (o cliente escolhendo crédito
 * ou débito) usa espera com cadeado, porque a thread do serviço precisa ficar
 * parada até alguém decidir.
 */
object EstadoDoTerminal {

    /** O que a tela de operação está mostrando agora. */
    sealed class Situacao {

        /** Esperando pedido. É o estado em que o app passa 99% do tempo. */
        data class Ocioso(
            val terminal: String?,
            val conectado: Boolean,
            val detalhe: String?,
        ) : Situacao()

        /** Chegou cobrança; o cliente precisa escolher a forma de pagamento. */
        data class Escolhendo(val cobranca: Cobranca) : Situacao()

        /** Transação em andamento; `andamento` é a mensagem do próprio pinpad. */
        data class Cobrando(val cobranca: Cobranca, val andamento: String) : Situacao()

        data class Aprovado(val cobranca: Cobranca, val numeroDoPedido: String?) : Situacao()

        data class Recusado(val cobranca: Cobranca, val motivo: String?) : Situacao()

        /** Token recusado pelo servidor: só o pareamento resolve. */
        data class PrecisaParear(val mensagem: String) : Situacao()

        /** Terminal não ativado junto ao PagBank. */
        data class PrecisaAtivar(val mensagem: String) : Situacao()

        /** O serviço de pagamento do PagBank não está neste aparelho. */
        data class SemServicoDoPagBank(val mensagem: String) : Situacao()
    }

    /** O que o cliente respondeu na tela de escolha. */
    sealed class Escolha {
        data class Forma(val tipo: TipoDePagamento) : Escolha()
        object Cancelar : Escolha()
    }

    fun interface Ouvinte {
        fun mudou(situacao: Situacao)
    }

    @Volatile
    var situacao: Situacao = Situacao.Ocioso(terminal = null, conectado = false, detalhe = null)
        private set

    /**
     * Quantos resultados de cartão estão presos esperando o servidor. A tela
     * mostra esse número porque ele é dinheiro já debitado que o FireHub ainda
     * não sabe que existe.
     */
    @Volatile
    var resultadosPresos: Int = 0
        private set

    @Volatile
    var resultadosTravados: Int = 0
        private set

    /**
     * O motivo do registro mais recente da lista de atenção.
     *
     * O contador sozinho ("2 pagamentos precisam de atenção") não diz a quem
     * está no balcão o que fazer. O motivo diz: qual código de venda procurar no
     * extrato do PagBank, ou qual pedido não pode ser cobrado de novo.
     *
     * Vive junto do contador de propósito. Some quando a lista de atenção é
     * marcada como resolvida, e não antes — é recado sobre cartão, não sobre
     * fila.
     */
    @Volatile
    var motivoDaAtencao: String? = null
        private set

    /**
     * Um recado sobre a FILA, não sobre cartão.
     *
     * Existe para um caso concreto: um pedido que ninguém pagou fica voltando
     * para a fila e, como a fila é atendida por ordem de criação, ele é sempre o
     * primeiro que a maquininha recebe. Quem está atrás dele não consegue pagar.
     * O app não tem como tirar o pedido da fila — quem pode fazer isso é uma
     * pessoa no painel do FireHub — então o mínimo é dizer qual pedido é.
     *
     * Fica separado de `motivoDaAtencao` porque os dois têm vidas diferentes:
     * este some assim que alguém paga alguma coisa; aquele só some quando uma
     * pessoa confirma que conferiu o cartão. Juntos num campo só, o primeiro
     * apagaria o segundo — e o segundo é o que fala de dinheiro.
     */
    @Volatile
    var avisoDaFila: String? = null
        private set

    fun publicarAviso(texto: String?) {
        if (texto == avisoDaFila) return
        avisoDaFila = texto
        val atual = situacao
        threadPrincipal.post { ouvintes.forEach { it.mudou(atual) } }
    }

    /**
     * A cobrança que a tela de pareamento pegou sem querer.
     *
     * Validar o token exige chamar a rota da fila, e essa rota RESERVA a
     * cobrança que devolve. Se o lojista parear a maquininha no exato momento em
     * que há pedido esperando, a validação leva o pedido junto. Jogar fora
     * deixaria o cliente cinco minutos parado na frente do totem até o servidor
     * destravar sozinho, então a cobrança fica guardada aqui e o serviço a
     * consome antes de perguntar por outra.
     */
    @Volatile
    var cobrancaAdiantada: Cobranca? = null

    private val ouvintes = CopyOnWriteArrayList<Ouvinte>()
    private val threadPrincipal = Handler(Looper.getMainLooper())

    fun observar(ouvinte: Ouvinte) {
        ouvintes.add(ouvinte)
        // A tela pode ter aberto no meio de uma transação: sem este primeiro
        // aviso ela ficaria em branco até o próximo evento do pinpad.
        val atual = situacao
        threadPrincipal.post { ouvinte.mudou(atual) }
    }

    fun deixarDeObservar(ouvinte: Ouvinte) {
        ouvintes.remove(ouvinte)
    }

    fun publicar(nova: Situacao) {
        situacao = nova
        threadPrincipal.post { ouvintes.forEach { it.mudou(nova) } }
    }

    fun publicarContadores(presos: Int, travados: Int, motivo: String?) {
        if (presos == resultadosPresos && travados == resultadosTravados && motivo == motivoDaAtencao) return
        resultadosPresos = presos
        resultadosTravados = travados
        motivoDaAtencao = motivo
        val atual = situacao
        threadPrincipal.post { ouvintes.forEach { it.mudou(atual) } }
    }

    // ------------------------------------------------------ escolha da forma

    private val travaDaEscolha = java.lang.Object()

    private var escolhaFeita: Escolha? = null

    /**
     * Limpa a escolha anterior. Chamado ANTES de a tela de escolha aparecer.
     *
     * Sem isso, um toque perdido da venda anterior ficaria guardado e a próxima
     * cobrança começaria sozinha, com a forma de pagamento que o cliente
     * anterior escolheu.
     */
    fun prepararEscolha() {
        synchronized(travaDaEscolha) { escolhaFeita = null }
    }

    /**
     * Trava a thread do serviço até o cliente decidir.
     *
     * Devolve null se o tempo acabar. Quem chamou trata isso como desistência e
     * devolve a cobrança para a fila — o pedido não pode ficar reservado numa
     * maquininha que ninguém está olhando.
     */
    fun aguardarEscolha(limiteMs: Long): Escolha? {
        synchronized(travaDaEscolha) {
            val prazo = SystemClock.elapsedRealtime() + limiteMs
            while (escolhaFeita == null) {
                val restante = prazo - SystemClock.elapsedRealtime()
                if (restante <= 0L) return null
                try {
                    travaDaEscolha.wait(restante)
                } catch (interrompida: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return null
                }
            }
            return escolhaFeita
        }
    }

    /** Chamado pela tela, na thread principal. */
    fun escolher(escolha: Escolha) {
        synchronized(travaDaEscolha) {
            escolhaFeita = escolha
            travaDaEscolha.notifyAll()
        }
    }
}
