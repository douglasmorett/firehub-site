package br.com.firehub.maquininha.pagamento

import br.com.firehub.maquininha.BuildConfig
import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.util.Log
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.pagamento.ponte.CanalDaPonte
import br.com.firehub.maquininha.pagamento.ponte.CobradorPorDeeplink
import br.com.firehub.maquininha.rede.Cobranca
import br.com.firehub.maquininha.rede.PedidoDeEstorno
import br.com.firehub.maquininha.rede.TipoDePagamento
import org.json.JSONArray
import org.json.JSONObject

/**
 * Cobrança na Cielo Smart (família LIO) pela integração por URI ("deep link").
 *
 * Manifesto do flavor: meta-data cs_integration_type = "uri", <queries> do
 * scheme lio, e a ponte recebendo firehubcielo://response.
 *
 * Ida:
 *   lio://payment?request=<Base64(JSON)>&urlCallback=firehubcielo://response
 *   JSON = {"accessToken","clientID","reference","email","installments":0,
 *           "items":[{"name","quantity":1,"sku","unitOfMeasure":"unidade",
 *                     "unitPrice":<centavos>}],
 *           "paymentCode":"CREDITO_AVISTA|DEBITO_AVISTA|PIX|VOUCHER_REFEICAO",
 *           "value":"<centavos>"}
 *
 * Volta:
 *   firehubcielo://response?response=<Base64(JSON)>
 *   com o pedido da Cielo; o pagamento aprovado vem em payments[0]
 *   (brand, authCode, cieloCode, paymentFields{...}).
 *
 * Regras da Cielo que valem só para este APK (build.gradle.kts): minSdk 24,
 * targetSdk 29, e WebView proibida (o app não usa nenhuma).
 */
object CobradorCielo : CobradorPorDeeplink() {

    private const val ETIQUETA = "CobradorCielo"
    private val CALLBACK = "firehubcielo" + BuildConfig.SUFIXO_DO_ESQUEMA + "://response"

    override val nome = "Cielo"

    override val formasAceitas = listOf(
        TipoDePagamento.CREDITO,
        TipoDePagamento.DEBITO,
        TipoDePagamento.PIX,
        TipoDePagamento.VOUCHER,
    )

    /** Sem consulta pela URI; ver CobradorPorDeeplink.conferirPelaRespostaAtrasada. */
    override val conferenciasAntesDeChamarGente = 3

    override val respostaPorResultado = false

    override fun intentDeTeste(): Intent = Intent(Intent.ACTION_VIEW, Uri.parse("lio://payment"))

    override fun montarSaida(
        cobranca: Cobranca,
        tipo: TipoDePagamento,
        identificador: String,
    ): Pair<Intent?, String?> {
        val credenciais = cobranca.credenciais
            ?: return null to contexto?.getString(R.string.recusa_sem_credencial_cielo)

        val codigoDoPagamento = when (tipo) {
            TipoDePagamento.CREDITO -> "CREDITO_AVISTA"
            TipoDePagamento.DEBITO -> "DEBITO_AVISTA"
            TipoDePagamento.PIX -> "PIX"
            // Restaurante: o voucher que entra no balcão é o de refeição.
            // VOUCHER_ALIMENTACAO existe e é o de mercado. CONFERIR se a Cielo
            // recusa refeição quando o cliente passa um cartão alimentação, e
            // se for o caso, oferecer os dois botões só neste APK.
            TipoDePagamento.VOUCHER -> "VOUCHER_REFEICAO"
        }

        // CONFERIR NO TERMINAL DE DEBUG: o manual não deixa claro se "value" e
        // "unitPrice" são em centavos ou em reais. Os exemplos publicados usam
        // inteiros sem vírgula (ex. 10000 para R$ 100,00), então vão centavos.
        // Se a tela da Cielo mostrar o valor 100x maior, é aqui.
        val centavos = cobranca.valorEmCentavos
        val item = JSONObject()
            .put("name", cobranca.descricao.take(60))
            .put("quantity", 1)
            .put("sku", alfanumerico(cobranca.pedidoId).takeLast(20).ifBlank { "PEDIDO" })
            .put("unitOfMeasure", "unidade")
            .put("unitPrice", centavos)

        val pedido = JSONObject()
            .put("accessToken", credenciais.accessToken)
            .put("clientID", credenciais.clientId)
            // A referência é o identificador desta tentativa: é ela que aparece
            // no pedido da Cielo e no histórico da maquininha, e é o código que
            // a lista de atenção manda procurar.
            .put("reference", identificador)
            // CONFERIR: o manual lista email como campo do pedido. Sem e-mail
            // cadastrado na loja, vai vazio.
            .put("email", credenciais.email ?: "")
            // 0 = à vista.
            .put("installments", 0)
            .put("items", JSONArray().put(item))
            .put("paymentCode", codigoDoPagamento)
            .put("value", centavos.toString())

        // NO_WRAP: o Base64.DEFAULT quebra linha a cada 76 caracteres e a
        // quebra iria parar no meio da URI. appendQueryParameter codifica o
        // "+" e o "/" — sem isso, getQueryParameter do outro lado transforma
        // "+" em espaço e o JSON chega corrompido.
        val base64 = Base64.encodeToString(pedido.toString().toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        val uri = Uri.Builder()
            .scheme("lio")
            .authority("payment")
            .appendQueryParameter("request", base64)
            .appendQueryParameter("urlCallback", CALLBACK)
            .build()

        return Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) to null
    }

    override fun interpretar(
        resposta: CanalDaPonte.Resposta,
        identificador: String,
        valorEmCentavos: Int,
        tipo: TipoDePagamento?,
    ): ResultadoDoSdk {
        val uri = (resposta as? CanalDaPonte.Resposta.PorUri)?.uri
            ?: return ResultadoDoSdk.incerto("A Cielo respondeu num formato inesperado.", tipo)

        val bruto = uri.getQueryParameter("response")
            ?: return ResultadoDoSdk.incerto("A Cielo voltou sem dizer o resultado.", tipo)

        val json = decodificar(bruto)
            ?: return ResultadoDoSdk.incerto("A resposta da Cielo veio ilegível.", tipo)

        // A Cielo devolve a "reference" que mandamos. Se veio e é outra, esta
        // resposta é de uma cobrança anterior que chegou atrasada.
        val referenciaDeVolta = json.optString("reference", "").trim()
        if (referenciaDeVolta.isNotEmpty() && referenciaDeVolta != identificador) {
            Log.e(ETIQUETA, "Resposta de outra venda: $referenciaDeVolta (esperada $identificador).")
            return ResultadoDoSdk.incerto("A Cielo respondeu sobre outra venda.", tipo)
        }

        val pagamentos = json.optJSONArray("payments")
        val pagamento = if (pagamentos != null && pagamentos.length() > 0) pagamentos.optJSONObject(0) else null

        if (pagamento == null) {
            // Sem pagamento no pedido. A Cielo devolve, em cancelamento e erro,
            // um JSON com "code"/"reason" (CONFERIR o formato exato no
            // terminal). Se veio motivo, é recusa; se não veio nada que se
            // reconheça, é incerto — na dúvida, nunca recusa.
            val motivo = json.optString("reason", "").ifBlank { null }
                ?: json.optString("message", "").ifBlank { null }
            val codigo = if (json.has("code")) json.opt("code")?.toString() else null
            val status = json.optString("status", "").uppercase()
            return if (motivo != null || codigo != null || status == "CANCELED" || status == "CANCELLED") {
                ResultadoDoSdk.recusa(motivo ?: "Pagamento não concluído na Cielo.", codigo, tipo)
            } else {
                Log.e(ETIQUETA, "Resposta sem pagamento e sem motivo: chaves=" + json.keys().asSequence().toList())
                ResultadoDoSdk.incerto("A Cielo não disse se o cartão passou.", tipo)
            }
        }

        val campos = pagamento.optJSONObject("paymentFields") ?: JSONObject()
        fun texto(vararg chaves: String): String? {
            for (chave in chaves) {
                pagamento.optString(chave, "").trim().ifBlank { null }?.let { return it }
                campos.optString(chave, "").trim().ifBlank { null }?.let { return it }
            }
            return null
        }

        // Valor pago: segunda conferência, como na Stone. CONFERIR a unidade
        // (centavos) — se vier em reais, isto marca incerto e o log mostra.
        val pago = pagamento.optLong("amount", -1L).takeIf { it >= 0 }
            ?: json.optLong("paidAmount", -1L).takeIf { it >= 0 }
        if (pago != null && pago != valorEmCentavos.toLong()) {
            Log.e(ETIQUETA, "Pago $pago, esperado $valorEmCentavos.")
            return ResultadoDoSdk.incerto("A Cielo aprovou um valor diferente do cobrado.", tipo)
        }

        val ids = linkedMapOf<String, String>()
        texto("cieloCode")?.let { ids["cieloCode"] = it }
        json.optString("id", "").ifBlank { null }?.let { ids["orderId"] = it }
        texto("v40Code", "primaryProductName")?.let { ids["produto"] = it }

        return ResultadoDoSdk(
            aprovado = true,
            bandeira = texto("brand", "cardBrand"),
            nsu = texto("nsu", "cieloCode"),
            autorizacao = texto("authCode", "authorizationCode"),
            parcelas = campos.optString("numberOfQuotas", "").toIntOrNull()?.takeIf { it > 0 } ?: 1,
            tipo = tipo?.codigoNoContrato,
            motivo = null,
            codigoDeErro = null,
            idsDaAdquirente = ids,
        )
    }

    /**
     * A resposta vem em Base64 dentro da query. getQueryParameter já
     * decodificou o percent-encoding — e transformou "+" em espaço, que aqui
     * volta a ser "+". Aceita também a variante URL-safe por precaução.
     */
    private fun decodificar(bruto: String): JSONObject? {
        val limpo = bruto.trim().replace(' ', '+')
        for (modo in intArrayOf(Base64.DEFAULT, Base64.URL_SAFE)) {
            try {
                val texto = String(Base64.decode(limpo, modo), Charsets.UTF_8)
                return JSONObject(texto)
            } catch (erro: Exception) {
                // tenta o próximo
            }
        }
        // Algumas versões podem mandar o JSON cru. Não custa tentar.
        return try {
            JSONObject(bruto)
        } catch (erro: Exception) {
            null
        }
    }

    override fun conferir(
        identificador: String,
        valorEmCentavos: Int,
        tipo: TipoDePagamento?,
    ): ConferenciaDaUltima = conferirPelaRespostaAtrasada(identificador, valorEmCentavos, tipo, nome)

    /**
     * Estorno (cancelamento da venda), pela mesma ponte da cobrança.
     *
     * Ida (docs.cielo.com.br/cielo-smart/docs/cancelamento):
     *   lio://payment-reversal?request=<Base64(JSON)>&urlCallback=firehubcielo://response
     *   JSON = {"id":<id da ordem>,"clientID","accessToken","cieloCode","authCode","value":<centavos, número>}
     *
     * Volta:
     *   sucesso: a ordem, com payments[] — o do cancelamento traz
     *            paymentFields.statusCode = "2" (o do pagamento, "1");
     *   erro:    {"code":1,"reason":"CANCELADO PELO USUÁRIO"}.
     *
     * A documentação não fala de prazo, cartão presente nem senha. Qualquer
     * resposta que não seja uma dessas duas é INCERTO: nunca dizer estornado
     * sem o statusCode 2 na mão.
     */
    override fun estornar(estorno: PedidoDeEstorno, aoProgredir: (String) -> Unit): ResultadoDoEstorno {
        exigirThreadDeTrabalho()
        val app = contexto
            ?: return ResultadoDoEstorno(ResultadoDoEstorno.NAO_ABRIU, "Aplicação não iniciada.")
        val credenciais = estorno.credenciais
            ?: return ResultadoDoEstorno(ResultadoDoEstorno.RECUSADO, app.getString(R.string.recusa_sem_credencial_cielo))
        val ordem = estorno.ordemDaAdquirente
            ?: return ResultadoDoEstorno(ResultadoDoEstorno.RECUSADO, app.getString(R.string.estorno_sem_ordem))

        val pedido = JSONObject()
            .put("id", ordem)
            .put("clientID", credenciais.clientId)
            .put("accessToken", credenciais.accessToken)
            .put("cieloCode", estorno.cieloCode ?: "")
            .put("authCode", estorno.autorizacao ?: "")
            .put("value", estorno.valorEmCentavos)

        // Mesmo cuidado da cobrança: NO_WRAP e appendQueryParameter.
        val base64 = Base64.encodeToString(pedido.toString().toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
        val uri = Uri.Builder()
            .scheme("lio")
            .authority("payment-reversal")
            .appendQueryParameter("request", base64)
            .appendQueryParameter("urlCallback", CALLBACK)
            .build()
        val saida = Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        aoProgredir(app.getString(R.string.andamento_estorno_no_app_da_adquirente))

        return when (val desfecho = abrirNaPonte(saida, "ESTORNO" + alfanumerico(estorno.estornoId))) {
            // Nada chegou à Cielo: o servidor devolve o estorno para a fila.
            is CanalDaPonte.Desfecho.NaoAbriu -> ResultadoDoEstorno(
                ResultadoDoEstorno.NAO_ABRIU,
                if (desfecho.telaForaDaFrente) app.getString(R.string.recusa_app_em_segundo_plano)
                else app.getString(R.string.recusa_app_da_adquirente_nao_abriu),
            )

            is CanalDaPonte.Desfecho.SemResposta ->
                ResultadoDoEstorno(ResultadoDoEstorno.INCERTO, app.getString(R.string.incerto_estorno_sem_resposta))

            is CanalDaPonte.Desfecho.Respondeu -> interpretarEstorno(desfecho.resposta, ordem)
        }
    }

    private fun interpretarEstorno(resposta: CanalDaPonte.Resposta, ordem: String): ResultadoDoEstorno {
        val incerto = { motivo: String -> ResultadoDoEstorno(ResultadoDoEstorno.INCERTO, motivo) }
        val uri = (resposta as? CanalDaPonte.Resposta.PorUri)?.uri
            ?: return incerto("A Cielo respondeu num formato inesperado.")
        val json = uri.getQueryParameter("response")?.let { decodificar(it) }
            ?: return incerto("A resposta da Cielo veio ilegível.")

        val pagamentos = json.optJSONArray("payments")
        if (pagamentos == null || pagamentos.length() == 0) {
            // O erro documentado: {"code":1,"reason":"..."}. Com motivo é
            // recusa (o estorno não saiu); sem nada reconhecível, incerto.
            val motivo = json.optString("reason", "").trim().ifBlank { null }
            return if (motivo != null && json.has("code")) {
                ResultadoDoEstorno(ResultadoDoEstorno.RECUSADO, motivo)
            } else {
                Log.e(ETIQUETA, "Estorno sem payments e sem motivo: chaves=" + json.keys().asSequence().toList())
                incerto("A Cielo não disse se o estorno saiu.")
            }
        }

        // A volta chega pela ponte sem dizer de qual chamada é: a ordem tem
        // que ser a que mandamos estornar, senão é resposta atrasada de outra.
        val ordemDeVolta = json.optString("id", "").trim()
        if (ordemDeVolta.isNotEmpty() && ordemDeVolta != ordem) {
            Log.e(ETIQUETA, "Estorno respondido para outra ordem: $ordemDeVolta (esperada $ordem).")
            return incerto("A Cielo respondeu sobre outra venda.")
        }

        for (i in 0 until pagamentos.length()) {
            val pagamento = pagamentos.optJSONObject(i) ?: continue
            val campos = pagamento.optJSONObject("paymentFields") ?: JSONObject()
            val status = campos.opt("statusCode")?.toString()?.trim() ?: pagamento.opt("statusCode")?.toString()?.trim()
            if (status == "2") {
                val ids = linkedMapOf("orderId" to ordem)
                pagamento.optString("cieloCode", "").ifBlank { campos.optString("cieloCode", "") }
                    .trim().ifBlank { null }?.let { ids["cieloCodeDoEstorno"] = it }
                pagamento.optString("authCode", "").trim().ifBlank { null }?.let { ids["autorizacaoDoEstorno"] = it }
                return ResultadoDoEstorno(ResultadoDoEstorno.ESTORNADO, null, ids)
            }
        }
        Log.e(ETIQUETA, "Ordem $ordem voltou sem pagamento com statusCode 2.")
        return incerto("A Cielo devolveu a venda sem o cancelamento.")
    }
}
