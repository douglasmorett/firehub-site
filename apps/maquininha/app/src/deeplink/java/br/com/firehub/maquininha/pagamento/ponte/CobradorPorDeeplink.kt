package br.com.firehub.maquininha.pagamento.ponte

import android.content.Context
import android.content.Intent
import android.os.Looper
import br.com.firehub.maquininha.Ajustes
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.pagamento.CobradorDaAdquirente
import br.com.firehub.maquininha.pagamento.ConferenciaDaUltima
import br.com.firehub.maquininha.pagamento.Impedimento
import br.com.firehub.maquininha.pagamento.ResultadoDoSdk
import br.com.firehub.maquininha.rede.Cobranca
import br.com.firehub.maquininha.rede.TipoDePagamento

/**
 * O que Stone, Cielo e Getnet têm em comum: nosso app não lê cartão, abre o
 * app de pagamento da adquirente pela [CanalDaPonte] e interpreta a resposta.
 *
 * Cada adquirente só diz como montar o Intent ([montarSaida]) e como ler a
 * resposta ([interpretar]). A regra de dinheiro fica aqui, uma vez:
 *  - não abriu → recusa (o cartão não foi tocado);
 *  - abriu e não voltou → INCERTO (o serviço segura o marcador);
 *  - voltou → a adquirente interpreta, e na dúvida devolve incerto.
 */
abstract class CobradorPorDeeplink : CobradorDaAdquirente {

    @Volatile
    protected var contexto: Context? = null

    override val podeAbortar = false

    override fun guardarContexto(context: Context) {
        contexto = context.applicationContext
    }

    override fun abortar() = Unit

    override fun intentDeAtivacao(context: Context): Intent? = null

    /** O Intent de cobrança. Nulo com motivo quando não dá para montar. */
    protected abstract fun montarSaida(
        cobranca: Cobranca,
        tipo: TipoDePagamento,
        identificador: String,
    ): Pair<Intent?, String?>

    /** true = Getnet (startActivityForResult); false = volta por deeplink. */
    protected abstract val respostaPorResultado: Boolean

    /**
     * Lê a resposta do app da adquirente. `identificador` é o desta cobrança:
     * quando a adquirente o devolve (Cielo: reference; Getnet: callerId) e ele
     * não bate, a resposta é de OUTRA cobrança (uma atrasada) e o resultado
     * tem que ser incerto, nunca aprovado nem recusado no lugar desta.
     */
    protected abstract fun interpretar(
        resposta: CanalDaPonte.Resposta,
        identificador: String,
        valorEmCentavos: Int,
        tipo: TipoDePagamento?,
    ): ResultadoDoSdk

    /** Um Intent qualquer do app de pagamento, só para ver se ele existe. */
    protected abstract fun intentDeTeste(): Intent

    override fun impedimentoParaCobrar(): Impedimento {
        val app = contexto ?: return Impedimento.FalhaAoConsultar("Aplicação não iniciada.")
        // Precisa do <queries> do manifesto do flavor: sem ele, do Android 11
        // em diante, resolveActivity responde "não existe" mesmo existindo.
        val existe = app.packageManager.resolveActivity(intentDeTeste(), 0) != null
        return if (existe) Impedimento.Nenhum else Impedimento.ServicoNaoInstalado
    }

    override fun cobrar(
        cobranca: Cobranca,
        tipo: TipoDePagamento,
        identificador: String,
        aoProgredir: (String) -> Unit,
    ): ResultadoDoSdk {
        exigirThreadDeTrabalho()
        val app = contexto
            ?: return ResultadoDoSdk.recusa("Aplicação não iniciada.", null, tipo)

        if (tipo !in formasAceitas) {
            return ResultadoDoSdk.recusa("Forma de pagamento não aceita nesta maquininha.", null, tipo)
        }

        val (saida, motivo) = montarSaida(cobranca, tipo, identificador)
        if (saida == null) {
            return ResultadoDoSdk.recusa(motivo ?: "Não foi possível montar a cobrança.", null, tipo)
        }

        aoProgredir(app.getString(R.string.andamento_no_app_da_adquirente))

        return when (
            val desfecho = CanalDaPonte.executar(
                app,
                saida,
                respostaPorResultado,
                identificador,
                Ajustes.PRAZO_NO_APP_DA_ADQUIRENTE_MS,
            )
        ) {
            is CanalDaPonte.Desfecho.NaoAbriu -> ResultadoDoSdk.recusa(
                if (desfecho.telaForaDaFrente) {
                    app.getString(R.string.recusa_app_em_segundo_plano)
                } else {
                    app.getString(R.string.recusa_app_da_adquirente_nao_abriu)
                },
                null,
                tipo,
            )

            is CanalDaPonte.Desfecho.SemResposta ->
                ResultadoDoSdk.incerto(app.getString(R.string.incerto_sem_resposta), tipo)

            is CanalDaPonte.Desfecho.Respondeu ->
                interpretar(desfecho.resposta, identificador, cobranca.valorEmCentavos, tipo)
        }
    }

    /**
     * Recuperação para adquirente SEM consulta (Stone, Cielo).
     *
     * DECISÃO: nenhuma das duas publica, no deeplink, uma forma de perguntar
     * "a venda X passou?". O que dá para fazer é olhar se a resposta do app
     * da adquirente chegou depois de o serviço desistir de esperar. Se não
     * chegou, a resposta é "não deu para conferir" — e, esgotadas as poucas
     * tentativas, o registro vai para a lista de atenção com o recado de
     * conferir no app da adquirente.
     *
     * O que NÃO se faz é virar recusa: recusa devolve o pedido para a fila, e
     * se o cartão tiver passado o cliente paga duas vezes. Um registro na
     * lista de atenção custa uma pessoa olhando o histórico da maquininha;
     * uma cobrança dupla custa o cliente.
     */
    protected fun conferirPelaRespostaAtrasada(
        identificador: String,
        valorEmCentavos: Int,
        tipo: TipoDePagamento?,
        nomeDaAdquirente: String,
    ): ConferenciaDaUltima {
        val atrasada = CanalDaPonte.respostaAtrasada(identificador)
            ?: return ConferenciaDaUltima.NaoDeuParaConferir(
                "a $nomeDaAdquirente não oferece consulta da venda pelo app",
            )
        val lido = interpretar(atrasada, identificador, valorEmCentavos, tipo)
        return when {
            lido.incerto -> ConferenciaDaUltima.NaoDeuParaConferir(
                lido.motivo ?: "resposta ilegível do app da $nomeDaAdquirente",
            )
            lido.aprovado -> ConferenciaDaUltima.FoiEsta(lido)
            else -> ConferenciaDaUltima.NaoFoiEsta
        }
    }

    protected fun exigirThreadDeTrabalho() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            throw IllegalStateException("A cobrança bloqueia: chame de uma thread de trabalho.")
        }
    }

    /** Só letras e números, para caber em qualquer campo de referência. */
    protected fun alfanumerico(texto: String): String =
        texto.filter { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' }

    /**
     * Identificador único POR TOQUE DE CARTÃO, não por pedido.
     *
     * O servidor não incrementa a tentativa quando devolve um pedido recusado
     * para a fila (ver README), então "<pedido>:<tentativa>" se repete. Para a
     * Getnet isso seria grave: a consulta é por callerId, e um callerId
     * repetido poderia devolver a recusa da tentativa anterior como resposta
     * da atual. O relógio no fim desempata.
     *
     * Formato: últimos 10 alfanuméricos do pedido + "T" + tentativa + base36
     * do relógio. Ex.: "MESA1A2B3CT1LZ3K9QXA". Nada assume formato do
     * pedidoId: "mesa:<id>" vira "mesa<id>".
     */
    override fun montarIdentificador(cobranca: Cobranca): String {
        val pedido = alfanumerico(cobranca.pedidoId).takeLast(10).uppercase()
        val tentativa = cobranca.tentativa.coerceIn(1, 99)
        val relogio = java.lang.Long.toString(System.currentTimeMillis(), 36).uppercase()
        return pedido + "T" + tentativa + relogio
    }
}
