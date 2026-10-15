package br.com.firehub.maquininha.pagamento.ponte

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.lang.ref.WeakReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * A conversa entre a thread do serviço (que precisa de uma resposta
 * bloqueante, como o doPayment do PagBank) e o app de pagamento da adquirente
 * (que só se abre a partir de uma Activity e responde por deeplink ou por
 * onActivityResult).
 *
 * O caminho de uma cobrança:
 *
 *   serviço ──executar()──▶ PonteDaAdquirenteActivity ──Intent──▶ app da adquirente
 *   serviço ◀──latch─────── PonteDaAdquirenteActivity ◀──resposta── app da adquirente
 *
 * Três desfechos, e a diferença entre eles é dinheiro:
 *  - [Desfecho.NaoAbriu]: nada chegou ao app da adquirente. O cartão não foi
 *    tocado; recusar é seguro.
 *  - [Desfecho.Respondeu]: o app da adquirente devolveu alguma coisa; quem
 *    interpreta é o cobrador de cada adquirente.
 *  - [Desfecho.SemResposta]: o app da adquirente ABRIU e não voltou no prazo.
 *    Ninguém sabe se o cartão passou. Isto é "incerto", nunca "recusado".
 *
 * Só uma chamada por vez, por construção (cadeado) — o laço do serviço já é
 * sequencial, e uma segunda cobrança abrindo por cima da primeira faria a
 * resposta de uma ser atribuída à outra.
 */
object CanalDaPonte {

    private const val ETIQUETA = "CanalDaPonte"

    /**
     * Quanto esperar a ponte aparecer depois de pedir para abri-la.
     *
     * Se a tela do FireHub não estiver em primeiro plano, o Android (API 29+)
     * bloqueia abrir Activity a partir do serviço em silêncio: startActivity
     * não dá erro, a ponte só não aparece. Sem este prazo a cobrança ficaria
     * esperando os três minutos inteiros por uma tela que nunca abriu.
     */
    private const val ESPERA_PARA_A_PONTE_ABRIR_MS = 10_000L

    sealed class Resposta {
        /** Stone e Cielo: o app da adquirente chama um deeplink nosso. */
        data class PorUri(val uri: Uri) : Resposta()

        /** Getnet: startActivityForResult. `dados` pode vir nulo. */
        data class PorResultado(val codigo: Int, val dados: Intent?) : Resposta()
    }

    sealed class Desfecho {
        data class NaoAbriu(val motivo: String, val telaForaDaFrente: Boolean = false) : Desfecho()
        data class Respondeu(val resposta: Resposta) : Desfecho()
        object SemResposta : Desfecho()
    }

    /** Uma cobrança (ou consulta) em curso. */
    class Chamada(
        val id: Long,
        val saida: Intent,
        val porResultado: Boolean,
        val identificador: String,
    ) {
        internal val abriu = CountDownLatch(1)
        internal val fim = CountDownLatch(1)

        /** A ponte já disparou o Intent para o app da adquirente. */
        @Volatile internal var lancada = false

        /** Ninguém mais espera por esta chamada (prazo acabou ou nem abriu). */
        @Volatile internal var encerrada = false

        @Volatile internal var desfecho: Desfecho? = null
    }

    private val proximoId = AtomicLong(1)
    private val cadeado = Any()
    private val threadPrincipal = Handler(Looper.getMainLooper())

    @Volatile
    private var atual: Chamada? = null

    /** A ponte que está aberta agora, para fechá-la quando a resposta chegar por outra. */
    @Volatile
    private var ponteAberta: WeakReference<Activity>? = null

    /**
     * Resposta que chegou DEPOIS de o serviço desistir de esperar.
     *
     * Acontece: o cliente demora mais que o prazo digitando a senha. Nesse
     * momento o serviço já tratou a cobrança como incerta e segurou o marcador.
     * Guardar a resposta aqui deixa a recuperação (`conferir`) encontrá-la e
     * fechar a conta certo, em vez de mandar o registro para a lista de atenção.
     * Fica só em memória: se o processo morreu, a resposta se perdeu de
     * qualquer jeito e o caminho é a pessoa conferir na maquininha.
     */
    private val respostasAtrasadas = HashMap<String, Resposta>()

    /**
     * Abre o app da adquirente e espera a resposta. BLOQUEANTE.
     */
    fun executar(
        context: Context,
        saida: Intent,
        porResultado: Boolean,
        identificador: String,
        prazoMs: Long,
    ): Desfecho {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            throw IllegalStateException("A ponte bloqueia: chame de uma thread de trabalho.")
        }

        synchronized(cadeado) {
            val chamada = Chamada(proximoId.getAndIncrement(), saida, porResultado, identificador)
            atual = chamada

            try {
                context.startActivity(
                    Intent(context, PonteDaAdquirenteActivity::class.java)
                        .putExtra(PonteDaAdquirenteActivity.EXTRA_CHAMADA, chamada.id)
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (erro: Exception) {
                Log.e(ETIQUETA, "Não foi possível abrir a ponte.", erro)
                encerrar(chamada)
                return Desfecho.NaoAbriu("A tela do FireHub não pôde ser aberta.")
            }

            if (!chamada.abriu.await(ESPERA_PARA_A_PONTE_ABRIR_MS, TimeUnit.MILLISECONDS)) {
                // A ponte não apareceu. Se ela aparecer depois, `podeLancar`
                // devolve false e ela se fecha sem abrir o app da adquirente —
                // a cobrança abandonada aqui não pode virar uma tela de
                // pagamento órfã minutos depois.
                synchronized(chamada) {
                    if (!chamada.lancada) {
                        encerrar(chamada)
                        return Desfecho.NaoAbriu("A tela do FireHub não estava em primeiro plano.", telaForaDaFrente = true)
                    }
                }
            }

            chamada.fim.await(prazoMs, TimeUnit.MILLISECONDS)
            synchronized(chamada) {
                encerrar(chamada)
                val desfecho = chamada.desfecho
                if (desfecho != null) return desfecho
                return if (chamada.lancada) Desfecho.SemResposta
                else Desfecho.NaoAbriu("O aplicativo de pagamento não foi aberto.")
            }
        }
    }

    /** Pega (e consome) uma resposta que chegou depois do prazo. */
    fun respostaAtrasada(identificador: String): Resposta? = synchronized(respostasAtrasadas) {
        respostasAtrasadas.remove(identificador)
    }

    // ------------------------------------------------- chamado pela ponte

    internal fun chamada(id: Long): Chamada? = atual?.takeIf { it.id == id }

    /**
     * A ponte vai disparar o Intent. Devolve false se o serviço já desistiu —
     * nesse caso a ponte fecha sem abrir nada.
     */
    internal fun podeLancar(chamada: Chamada, ponte: Activity): Boolean = synchronized(chamada) {
        if (chamada.encerrada) return false
        chamada.lancada = true
        ponteAberta = WeakReference(ponte)
        chamada.abriu.countDown()
        true
    }

    /** O startActivity para o app da adquirente estourou: nada foi aberto. */
    internal fun naoAbriu(chamada: Chamada, motivo: String) = synchronized(chamada) {
        chamada.lancada = false
        if (chamada.desfecho == null) chamada.desfecho = Desfecho.NaoAbriu(motivo)
        chamada.abriu.countDown()
        chamada.fim.countDown()
    }

    /**
     * Chegou resposta. Para Getnet vem com o id da chamada (onActivityResult na
     * mesma ponte); para Stone e Cielo vem por deeplink, sem id — e então é da
     * chamada em curso, que é sempre uma só.
     */
    internal fun entregar(idDaChamada: Long?, resposta: Resposta) {
        val chamada = atual
        if (chamada == null || (idDaChamada != null && idDaChamada != chamada.id)) {
            Log.w(ETIQUETA, "Resposta sem chamada correspondente; descartada: " + resposta)
            fecharPonte()
            return
        }
        synchronized(chamada) {
            if (chamada.encerrada) {
                Log.w(ETIQUETA, "Resposta atrasada para " + chamada.identificador + "; guardada.")
                synchronized(respostasAtrasadas) { respostasAtrasadas[chamada.identificador] = resposta }
            } else if (chamada.desfecho == null) {
                chamada.desfecho = Desfecho.Respondeu(resposta)
                chamada.fim.countDown()
            }
        }
        fecharPonte()
    }

    private fun encerrar(chamada: Chamada) {
        chamada.encerrada = true
        chamada.abriu.countDown()
        fecharPonte()
    }

    /**
     * A ponte é transparente e fica por cima da tela de operação. Esquecida
     * aberta, ela comeria os toques do próximo cliente.
     */
    private fun fecharPonte() {
        val ponte = ponteAberta?.get() ?: return
        threadPrincipal.post { if (!ponte.isFinishing) ponte.finish() }
    }

    internal fun ponteFechou(ponte: Activity) {
        if (ponteAberta?.get() === ponte) ponteAberta = null
    }
}
