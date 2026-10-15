package br.com.firehub.maquininha.pagamento

import android.content.Intent
import android.net.Uri
import android.util.Log
import br.com.firehub.maquininha.pagamento.ponte.CanalDaPonte
import br.com.firehub.maquininha.pagamento.ponte.CobradorPorDeeplink
import br.com.firehub.maquininha.rede.Cobranca
import br.com.firehub.maquininha.rede.TipoDePagamento

/**
 * Cobrança na Smart POS da Stone pelo deeplink de pagamento.
 *
 * Fonte: https://sdkandroid.stone.com.br/reference/pagamento-deeplink.md
 *
 * Ida (ACTION_VIEW, FLAG_ACTIVITY_NEW_TASK):
 *   payment-app://pay?return_scheme=firehubmaquininha&amount=<centavos>
 *     &transaction_type=CREDIT|DEBIT|VOUCHER|PIX&installment_type=NONE
 *     &editable_amount=0
 *
 * Volta (deeplink nosso, cai na PonteDaAdquirenteActivity):
 *   firehubmaquininha://pay-response?code=0&amount=&brand=&authorization_code=
 *     &atk=&itk=&pan=&type=&installment_count=&order_id=&authorization_date_time=
 *   code 0 = aprovado; qualquer outro = erro, com message/reason/response_code.
 *
 * O deeplink só funciona em POS da Stone. Fora dela (tablet, emulador sem o
 * simulador) o app de pagamento não existe e o impedimento aparece na tela.
 */
object CobradorStone : CobradorPorDeeplink() {

    private const val ETIQUETA = "CobradorStone"

    /** Tem que bater com o scheme do intent-filter da ponte no manifesto. */
    private const val ESQUEMA_DE_VOLTA = "firehubmaquininha"

    override val nome = "Stone"

    override val formasAceitas = listOf(
        TipoDePagamento.CREDITO,
        TipoDePagamento.DEBITO,
        TipoDePagamento.PIX,
        TipoDePagamento.VOUCHER,
    )

    /**
     * Sem consulta, mas com três tentativas (15 s): dá tempo de uma resposta
     * atrasada do app da Stone chegar antes de o registro ir para a lista de
     * atenção.
     */
    override val conferenciasAntesDeChamarGente = 3

    override val respostaPorResultado = false

    override fun intentDeTeste(): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("payment-app://pay?return_scheme=$ESQUEMA_DE_VOLTA"))

    override fun montarSaida(
        cobranca: Cobranca,
        tipo: TipoDePagamento,
        identificador: String,
    ): Pair<Intent?, String?> {
        val tipoStone = when (tipo) {
            TipoDePagamento.CREDITO -> "CREDIT"
            TipoDePagamento.DEBITO -> "DEBIT"
            TipoDePagamento.VOUCHER -> "VOUCHER"
            TipoDePagamento.PIX -> "PIX"
        }
        val uri = Uri.Builder()
            .scheme("payment-app")
            .authority("pay")
            .appendQueryParameter("return_scheme", ESQUEMA_DE_VOLTA)
            .appendQueryParameter("amount", cobranca.valorEmCentavos.toString())
            .appendQueryParameter("transaction_type", tipoStone)
            // À vista. A doc aceita installment_count só de 2 a 99, então com
            // NONE ele NÃO vai (mandar "1" pode ser rejeitado). CONFERIR NO
            // TERMINAL DE DEBUG que o app da Stone não pergunta parcelas.
            .appendQueryParameter("installment_type", "NONE")
            // 0 = o cliente não pode mudar o valor na tela da Stone.
            .appendQueryParameter("editable_amount", "0")
            // order_id NÃO vai: a doc exige número (até Long.MAX) e que a
            // função esteja habilitada no app de Ajustes do POS. O pedidoId do
            // FireHub é texto opaco ("mesa:<id>" inclusive), e mandar um
            // número inventado não ajudaria a conciliar nada.
            .build()

        val intent = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return intent to null
    }

    override fun interpretar(
        resposta: CanalDaPonte.Resposta,
        identificador: String,
        valorEmCentavos: Int,
        tipo: TipoDePagamento?,
    ): ResultadoDoSdk {
        val uri = (resposta as? CanalDaPonte.Resposta.PorUri)?.uri
            ?: return ResultadoDoSdk.incerto("A Stone respondeu num formato inesperado.", tipo)

        fun campo(nome: String): String? = uri.getQueryParameter(nome)?.trim()?.ifBlank { null }

        // A Stone não devolve nenhum identificador nosso (order_id não vai,
        // ver montarSaida). A única conferência possível de que a resposta é
        // desta cobrança é o valor, logo abaixo. Ver README, "riscos".
        val codigo = campo("code")
            ?: return ResultadoDoSdk.incerto("A Stone não disse se o cartão passou.", tipo)

        if (codigo != "0") {
            val motivo = campo("message")
                ?: campo("reason")?.let { "Não autorizado (" + it + ")." }
                ?: "Não autorizado (código " + codigo + ")."
            return ResultadoDoSdk.recusa(motivo, campo("response_code") ?: codigo, tipo)
        }

        // Aprovado. O valor de volta é a segunda conferência: o deeplink de
        // volta é um Intent que qualquer app do aparelho poderia disparar, e
        // um "code=0" com outro valor não fecha conta com nada.
        val valorDeVolta = campo("amount")?.filter { it.isDigit() }?.toIntOrNull()
        if (valorDeVolta != null && valorDeVolta != valorEmCentavos) {
            Log.e(ETIQUETA, "Aprovado com valor diferente: esperado $valorEmCentavos, veio $valorDeVolta.")
            return ResultadoDoSdk.incerto("A Stone aprovou um valor diferente do cobrado.", tipo)
        }

        // A Stone não devolve NSU com esse nome. Os identificadores da
        // transação são o ITK (do iniciador) e o ATK (do autorizador). O ATK é
        // o que identifica a venda do lado da Stone, então ele vai como "nsu";
        // os dois vão também em idsDaAdquirente, para a conciliação escolher
        // depois sem ninguém ter que ir até a maquininha. CONFERIR no portal da
        // Stone qual dos dois aparece no extrato.
        val atk = campo("atk")
        val itk = campo("itk")
        val ids = linkedMapOf<String, String>()
        atk?.let { ids["atk"] = it }
        itk?.let { ids["itk"] = it }
        campo("pan")?.let { ids["pan"] = it }
        campo("authorization_date_time")?.let { ids["authorization_date_time"] = it }

        return ResultadoDoSdk(
            aprovado = true,
            bandeira = campo("brand"),
            nsu = atk ?: itk,
            autorizacao = campo("authorization_code"),
            parcelas = campo("installment_count")?.toIntOrNull()?.takeIf { it > 0 } ?: 1,
            tipo = when (campo("type")?.uppercase()) {
                "CREDIT" -> TipoDePagamento.CREDITO.codigoNoContrato
                "DEBIT" -> TipoDePagamento.DEBITO.codigoNoContrato
                "VOUCHER" -> TipoDePagamento.VOUCHER.codigoNoContrato
                "PIX", "INSTANT_PAYMENT" -> TipoDePagamento.PIX.codigoNoContrato
                else -> tipo?.codigoNoContrato
            },
            motivo = null,
            codigoDeErro = null,
            idsDaAdquirente = ids,
        )
    }

    override fun conferir(
        identificador: String,
        valorEmCentavos: Int,
        tipo: TipoDePagamento?,
    ): ConferenciaDaUltima = conferirPelaRespostaAtrasada(identificador, valorEmCentavos, tipo, nome)
}
