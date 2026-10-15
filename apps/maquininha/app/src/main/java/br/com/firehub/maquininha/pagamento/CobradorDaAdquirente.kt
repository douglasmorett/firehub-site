package br.com.firehub.maquininha.pagamento

import android.content.Context
import android.content.Intent
import br.com.firehub.maquininha.rede.Cobranca
import br.com.firehub.maquininha.rede.TipoDePagamento

/**
 * O que o serviço de cobrança precisa de uma adquirente — e nada além disso.
 *
 * Existe uma implementação por flavor (`Adquirente.cobrador`, em
 * src/<flavor>/java): PlugPag no PagBank, deeplink na Stone, Cielo e Getnet. O
 * serviço, a fila em disco, o marcador e as telas não sabem qual delas está no
 * APK. É isso que deixa as quatro defesas contra perder ou repetir cobrança
 * (ver README, "O caso que o app existe para não deixar acontecer") escritas
 * uma vez só.
 *
 * Todo método que fala com a adquirente BLOQUEIA e tem que ser chamado da
 * thread de trabalho do serviço, uma cobrança por vez.
 */
interface CobradorDaAdquirente {

    /** "PagBank", "Stone"... Vai para a tela de operação. */
    val nome: String

    /**
     * As formas que esta adquirente cobra, na ordem em que os botões aparecem.
     *
     * No PagBank são só crédito, débito e voucher: a homologação dele reprova
     * app que ofereça forma de pagamento que o terminal não processa por
     * cartão. Pix aparece nas outras três, que cobram Pix no próprio app.
     */
    val formasAceitas: List<TipoDePagamento>

    /**
     * Se o botão "Cancelar" durante a transação faz alguma coisa.
     *
     * No PagBank, abort() pede ao pinpad para parar. Nos deeplinks a tela da
     * adquirente está por cima da nossa e o cliente cancela nela; não existe
     * chamada para interromper de fora.
     */
    val podeAbortar: Boolean

    /**
     * Quantas vezes perguntar à adquirente o que houve com um cartão antes de
     * desistir e mandar o registro para a lista de atenção.
     *
     * Onde existe consulta de verdade (PagBank, Getnet) vale insistir por um
     * minuto, porque a consulta falha por motivo que passa (serviço subindo
     * depois do boot). Onde não existe (Stone, Cielo), insistir não muda a
     * resposta: o número é pequeno e serve só para dar tempo de uma resposta
     * atrasada do app da adquirente chegar.
     */
    val conferenciasAntesDeChamarGente: Int

    /** Chamado uma vez, na subida do processo, com o Context da aplicação. */
    fun guardarContexto(context: Context)

    /** Por que não dá para cobrar agora. Bloqueante. */
    fun impedimentoParaCobrar(): Impedimento

    /**
     * O código desta tentativa de cobrança junto à adquirente.
     *
     * É gravado no marcador ANTES de o cartão ser tocado, e é por ele que a
     * recuperação pergunta "esta venda passou?". Cada adquirente tem a sua
     * regra (o PagBank aceita 10 alfanuméricos; a Getnet usa como callerId da
     * consulta). Nunca assume formato do pedidoId: ele é texto opaco e pode
     * ser "mesa:<id>".
     */
    fun montarIdentificador(cobranca: Cobranca): String

    /**
     * Cobra. Bloqueia até o cliente terminar, desistir ou o prazo acabar.
     *
     * NUNCA devolve aprovação inventada, e NUNCA devolve recusa quando não sabe
     * o que houve: nesse caso devolve `incerto = true` e o serviço segura o
     * marcador para conferir depois.
     */
    fun cobrar(
        cobranca: Cobranca,
        tipo: TipoDePagamento,
        identificador: String,
        aoProgredir: (String) -> Unit,
    ): ResultadoDoSdk

    /**
     * Recuperação: a venda com este identificador passou?
     *
     * Três respostas, e tratá-las como duas é como se perde dinheiro (ver
     * [ConferenciaDaUltima]). Adquirente sem consulta responde sempre
     * "não deu para conferir", e o registro termina na lista de atenção com
     * o recado de conferir na maquininha — nunca como recusa silenciosa.
     */
    fun conferir(identificador: String, valorEmCentavos: Int, tipo: TipoDePagamento?): ConferenciaDaUltima

    /** Pede para interromper a transação em curso, quando a adquirente deixa. */
    fun abortar()

    /** A tela de ativação do terminal, se esta adquirente tiver uma no app. */
    fun intentDeAtivacao(context: Context): Intent?
}

/**
 * Resultado da transação já no vocabulário do FireHub, sem nenhum tipo de SDK
 * ou de deeplink vazando para fora do cobrador.
 */
data class ResultadoDoSdk(
    val aprovado: Boolean,
    val bandeira: String?,
    val nsu: String?,
    val autorizacao: String?,
    val parcelas: Int?,
    val tipo: String?,
    val motivo: String?,
    val codigoDeErro: String?,
    /**
     * Verdadeiro quando NINGUÉM sabe o que aconteceu com o cartão.
     *
     * É diferente de `aprovado = false`. Recusa é uma resposta: o cartão não
     * passou, o pedido volta para a fila e o cliente tenta outro. Incerto é a
     * ausência de resposta — a chamada estourou, o app da adquirente não
     * devolveu nada a tempo, e não deu para consultar.
     *
     * Quem recebe isto NÃO pode mandar recusa para o servidor: se o cartão
     * tiver sido debitado, o pedido voltaria para a fila e o cliente pagaria
     * de novo. O caminho certo é segurar o marcador em disco e reconferir nas
     * próximas voltas do laço, que é o que `ServicoDeCobranca` faz.
     */
    val incerto: Boolean = false,
    /**
     * Identificadores próprios da adquirente que não cabem em nsu/autorizacao
     * (ATK e ITK da Stone, cvNumber da Getnet, cieloCode...). Vão no POST de
     * resultado para a conciliação.
     */
    val idsDaAdquirente: Map<String, String> = emptyMap(),
) {
    companion object {
        fun recusa(motivo: String, codigo: String?, tipo: TipoDePagamento?) = ResultadoDoSdk(
            aprovado = false,
            bandeira = null,
            nsu = null,
            autorizacao = null,
            parcelas = null,
            tipo = tipo?.codigoNoContrato,
            motivo = motivo,
            codigoDeErro = codigo,
        )

        fun incerto(motivo: String, tipo: TipoDePagamento?) =
            recusa(motivo, null, tipo).copy(incerto = true)
    }
}

/**
 * O que a adquirente respondeu quando lhe perguntamos se uma venda específica
 * chegou a ser aprovada.
 *
 * "Não foi esta" é informação (a venda não aconteceu); "não deu para conferir"
 * é a falta dela (o cartão pode ter sido debitado e ninguém sabe). Quem trata
 * as duas como "não" apaga a única pista que havia de uma cobrança já paga.
 */
sealed class ConferenciaDaUltima {
    /** A venda consultada foi aprovada. */
    data class FoiEsta(val resultado: ResultadoDoSdk) : ConferenciaDaUltima()

    /** A adquirente afirma que esta venda não foi paga. */
    object NaoFoiEsta : ConferenciaDaUltima()

    /** Não respondeu, respondeu algo ilegível, ou não existe consulta. */
    data class NaoDeuParaConferir(val motivo: String) : ConferenciaDaUltima()
}

/** Por que a maquininha não pode cobrar agora. */
sealed class Impedimento {
    object Nenhum : Impedimento()

    /** O serviço (PagBank) ou o app de pagamento (deeplink) não está no aparelho. */
    object ServicoNaoInstalado : Impedimento()

    object TerminalNaoAtivado : Impedimento()
    data class FalhaAoConsultar(val mensagem: String) : Impedimento()
}
