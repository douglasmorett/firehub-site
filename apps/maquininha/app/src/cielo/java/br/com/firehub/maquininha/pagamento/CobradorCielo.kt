package br.com.firehub.maquininha.pagamento

import android.content.Intent
import android.net.Uri
import android.util.Base64
import android.util.Log
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.pagamento.ponte.CanalDaPonte
import br.com.firehub.maquininha.pagamento.ponte.CobradorPorDeeplink
import br.com.firehub.maquininha.rede.Cobranca
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
    private const val CALLBACK = "firehubcielo://response"

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
}
