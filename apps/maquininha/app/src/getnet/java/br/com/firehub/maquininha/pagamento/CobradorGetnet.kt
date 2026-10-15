package br.com.firehub.maquininha.pagamento

import android.content.Intent
import android.net.Uri
import android.util.Log
import br.com.firehub.maquininha.Ajustes
import br.com.firehub.maquininha.pagamento.ponte.CanalDaPonte
import br.com.firehub.maquininha.pagamento.ponte.CobradorPorDeeplink
import br.com.firehub.maquininha.rede.Cobranca
import br.com.firehub.maquininha.rede.TipoDePagamento

/**
 * Cobrança na Get Smart (Getnet/Santander) pelo deeplink do app de pagamento.
 *
 * A especificação oficial é fechada (só para parceiro). O formato abaixo segue
 * as duas integrações comunitárias que estão em produção:
 *  - https://github.com/CarvalhoWesley/getnet_payments (DeeplinkUsecase.kt)
 *  - https://github.com/ControleOnline/react-native-getnet-payment (Getnet.java)
 *
 * As duas mandam os parâmetros como QUERY STRING na URI (e não como extras de
 * Bundle), e é isso que vale aqui. Os mesmos valores também vão como extras,
 * o que é inofensivo e cobre a variante descrita em material antigo.
 * CONFERIR NO TERMINAL DE DEBUG.
 *
 * Ida (startActivityForResult, ACTION_VIEW):
 *   getnet://pagamento/v3/payment?paymentType=credit|debit|voucher|pix
 *     &amount=000000004590&callerId=<único>&installments=1
 *     &allowPrintCurrentTransaction=false&orderId=<ref>
 *   amount = 12 dígitos, em centavos. creditType só vai com parcelas > 1.
 *
 * Volta (extras do Intent de resultado):
 *   result: "0" aprovado, "1" negado, "2" cancelado, "3" falha,
 *           "4" desconhecido, "5" pendente
 *   nsu, cvNumber, authorizationCode, brand, cardLastDigits, installments,
 *   amount, callerId, type, resultDetails...
 *
 * Consulta (recuperação): getnet://pagamento/v1/checkstatus?callerId=<o mesmo>
 */
object CobradorGetnet : CobradorPorDeeplink() {

    private const val ETIQUETA = "CobradorGetnet"

    override val nome = "Getnet"

    override val formasAceitas = listOf(
        TipoDePagamento.CREDITO,
        TipoDePagamento.DEBITO,
        TipoDePagamento.PIX,
        TipoDePagamento.VOUCHER,
    )

    /** Existe consulta de verdade (checkstatus): vale insistir um minuto. */
    override val conferenciasAntesDeChamarGente = 12

    override val respostaPorResultado = true

    override fun intentDeTeste(): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("getnet://pagamento/v3/payment"))

    override fun montarSaida(
        cobranca: Cobranca,
        tipo: TipoDePagamento,
        identificador: String,
    ): Pair<Intent?, String?> {
        val tipoGetnet = when (tipo) {
            TipoDePagamento.CREDITO -> "credit"
            TipoDePagamento.DEBITO -> "debit"
            TipoDePagamento.VOUCHER -> "voucher"
            TipoDePagamento.PIX -> "pix"
        }
        // 12 dígitos em centavos: R$ 45,90 -> "000000004590". Do inteiro, sem
        // passar por double (as libs comunitárias fazem amount * 100 em double,
        // que é como R$ 0,29 vira 28 centavos).
        val valor = String.format(java.util.Locale.ROOT, "%012d", cobranca.valorEmCentavos.toLong())

        val parametros = linkedMapOf(
            "paymentType" to tipoGetnet,
            "amount" to valor,
            "callerId" to identificador,
            "installments" to "1",
            // A via do estabelecimento não é impressa: quem imprime o pedido é
            // o FireHub, na impressora da cozinha.
            "allowPrintCurrentTransaction" to "false",
            "orderId" to identificador,
        )

        val construtor = Uri.Builder().scheme("getnet").authority("pagamento").appendPath("v3").appendPath("payment")
        parametros.forEach { (chave, valorDoParametro) -> construtor.appendQueryParameter(chave, valorDoParametro) }

        val intent = Intent(Intent.ACTION_VIEW, construtor.build())
        parametros.forEach { (chave, valorDoParametro) -> intent.putExtra(chave, valorDoParametro) }
        return intent to null
    }

    override fun interpretar(
        resposta: CanalDaPonte.Resposta,
        identificador: String,
        valorEmCentavos: Int,
        tipo: TipoDePagamento?,
    ): ResultadoDoSdk {
        val porResultado = resposta as? CanalDaPonte.Resposta.PorResultado
            ?: return ResultadoDoSdk.incerto("A Getnet respondeu num formato inesperado.", tipo)
        val dados = porResultado.dados

        // As libs comunitárias tratam RESULT_CANCELED sem dados como
        // "cancelado". Aqui NÃO: sem dados ninguém sabe se o app da Getnet
        // fechou antes ou depois de debitar (pode ter caído). Vira incerto, e a
        // recuperação pergunta pelo checkstatus — que, se o cliente de fato
        // cancelou, responde "não foi" e o pedido volta para a fila em
        // segundos.
        if (dados == null || dados.getStringExtra("result") == null) {
            Log.w(ETIQUETA, "Volta sem resultado (resultCode=" + porResultado.codigo + ").")
            return ResultadoDoSdk.incerto("A Getnet voltou sem dizer o resultado.", tipo)
        }
        // O callerId de volta tem que ser o desta cobrança; outro é resposta
        // atrasada de uma cobrança anterior.
        val callerIdDeVolta = dados.getStringExtra("callerId")?.trim()?.ifBlank { null }
        if (callerIdDeVolta != null && callerIdDeVolta != identificador) {
            Log.e(ETIQUETA, "Resposta de outra venda: $callerIdDeVolta (esperada $identificador).")
            return ResultadoDoSdk.incerto("A Getnet respondeu sobre outra venda.", tipo)
        }
        return lerExtras(dados, valorEmCentavos, tipo)
    }

    private fun lerExtras(dados: Intent, valorEmCentavos: Int, tipo: TipoDePagamento?): ResultadoDoSdk {
        fun campo(nome: String): String? = dados.getStringExtra(nome)?.trim()?.ifBlank { null }

        val resultado = campo("result")
        val detalhe = campo("resultDetails")

        return when (resultado) {
            "0" -> {
                val valorDeVolta = campo("amount")?.filter { it.isDigit() }?.toLongOrNull()
                if (valorDeVolta != null && valorDeVolta != valorEmCentavos.toLong()) {
                    Log.e(ETIQUETA, "Aprovado com valor $valorDeVolta, esperado $valorEmCentavos.")
                    return ResultadoDoSdk.incerto("A Getnet aprovou um valor diferente do cobrado.", tipo)
                }
                val ids = linkedMapOf<String, String>()
                campo("cvNumber")?.let { ids["cvNumber"] = it }
                campo("nsuLocal")?.let { ids["nsuLocal"] = it }
                campo("callerId")?.let { ids["callerId"] = it }
                campo("cardLastDigits")?.let { ids["cardLastDigits"] = it }
                campo("gmtDateTime")?.let { ids["gmtDateTime"] = it }

                ResultadoDoSdk(
                    aprovado = true,
                    bandeira = campo("brand"),
                    nsu = campo("nsu") ?: campo("cvNumber"),
                    autorizacao = campo("authorizationCode"),
                    parcelas = campo("installments")?.toIntOrNull()?.takeIf { it > 0 } ?: 1,
                    tipo = when (campo("type")?.lowercase()) {
                        "credit", "credito" -> TipoDePagamento.CREDITO.codigoNoContrato
                        "debit", "debito" -> TipoDePagamento.DEBITO.codigoNoContrato
                        "voucher" -> TipoDePagamento.VOUCHER.codigoNoContrato
                        "pix" -> TipoDePagamento.PIX.codigoNoContrato
                        else -> tipo?.codigoNoContrato
                    },
                    motivo = null,
                    codigoDeErro = null,
                    idsDaAdquirente = ids,
                )
            }
            "1" -> ResultadoDoSdk.recusa(detalhe ?: "Pagamento negado.", "1", tipo)
            "2" -> ResultadoDoSdk.recusa(detalhe ?: "Cancelado na maquininha.", "2", tipo)
            "3" -> ResultadoDoSdk.recusa(detalhe ?: "Falha no pagamento.", "3", tipo)
            // 4 (desconhecido), 5 (pendente) e qualquer coisa nova: ninguém
            // sabe. Incerto, e o checkstatus decide.
            else -> ResultadoDoSdk.incerto(
                "A Getnet não confirmou o pagamento (resultado " + (resultado ?: "vazio") + ").",
                tipo,
            )
        }
    }

    /**
     * Recuperação pelo checkstatus, com o MESMO callerId da cobrança.
     *
     * O identificador é único por toque de cartão (ver montarIdentificador):
     * o checkstatus não tem como confundir esta tentativa com uma anterior do
     * mesmo pedido.
     *
     * Abre o app da Getnet por um instante — então precisa da tela do FireHub
     * em primeiro plano, como a cobrança. Se não estiver (boot, operador em
     * outro app), a resposta é "não deu para conferir" e o serviço tenta de
     * novo na volta seguinte.
     *
     * CONFERIR NO TERMINAL: o que o checkstatus devolve para um callerId que
     * a Getnet não conhece (cliente cancelou antes de qualquer coisa). Se for
     * "3"/"2", o pedido volta para a fila; se for "4", vai para a lista de
     * atenção depois de um minuto, que é o lado seguro.
     */
    override fun conferir(
        identificador: String,
        valorEmCentavos: Int,
        tipo: TipoDePagamento?,
    ): ConferenciaDaUltima {
        exigirThreadDeTrabalho()
        val app = contexto ?: return ConferenciaDaUltima.NaoDeuParaConferir("Aplicação não iniciada.")
        if (identificador.isBlank()) {
            return ConferenciaDaUltima.NaoDeuParaConferir("O marcador não trazia o callerId.")
        }

        val uri = Uri.Builder().scheme("getnet").authority("pagamento")
            .appendPath("v1").appendPath("checkstatus")
            .appendQueryParameter("callerId", identificador)
            .build()
        val consulta = Intent(Intent.ACTION_VIEW, uri).putExtra("callerId", identificador)

        val desfecho = CanalDaPonte.executar(
            app,
            consulta,
            porResultado = true,
            identificador = identificador,
            prazoMs = Ajustes.PRAZO_DA_CONSULTA_NA_ADQUIRENTE_MS,
        )

        val dados = when (desfecho) {
            is CanalDaPonte.Desfecho.NaoAbriu -> return ConferenciaDaUltima.NaoDeuParaConferir(desfecho.motivo)
            is CanalDaPonte.Desfecho.SemResposta ->
                return ConferenciaDaUltima.NaoDeuParaConferir("a Getnet não respondeu à consulta")
            is CanalDaPonte.Desfecho.Respondeu ->
                (desfecho.resposta as? CanalDaPonte.Resposta.PorResultado)?.dados
        }
        if (dados == null || dados.getStringExtra("result") == null) {
            Log.w(ETIQUETA, "checkstatus sem resultado: " + desfecho)
            return ConferenciaDaUltima.NaoDeuParaConferir("a Getnet não devolveu o status da venda")
        }

        // Se a Getnet devolveu o callerId e ele é de outra venda, não é esta.
        val callerIdDeVolta = dados.getStringExtra("callerId")?.trim()?.ifBlank { null }
        if (callerIdDeVolta != null && callerIdDeVolta != identificador) {
            Log.w(ETIQUETA, "checkstatus devolveu outra venda: $callerIdDeVolta")
            return ConferenciaDaUltima.NaoDeuParaConferir("a Getnet devolveu o status de outra venda")
        }

        val lido = lerExtras(dados, valorEmCentavos, tipo)
        return when {
            lido.incerto -> ConferenciaDaUltima.NaoDeuParaConferir(lido.motivo ?: "status indefinido")
            lido.aprovado -> ConferenciaDaUltima.FoiEsta(lido)
            else -> ConferenciaDaUltima.NaoFoiEsta
        }
    }
}
