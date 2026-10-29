package br.com.firehub.maquininha.motoboy

import android.location.Location
import android.net.Uri
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.math.floor

/**
 * O que o app do motoboy lê de cada pedido da lista (GET /api/motoboys/orders
 * ?formato=app) sem precisar de tela: ordem, urgência, ponto no mapa,
 * distância, telefone.
 *
 * O servidor manda tudo pronto; as poucas contas que sobram são as do app do
 * celular (apps/motoboy: entregas.tsx, CartaoDoPedido.tsx, lib/urgencia.ts).
 * Mudar a regra lá e aqui juntos.
 */
object LeituraDoPedido {

    /** A única forma que a tela trata à parte: é a que pede o campo de dinheiro. */
    const val DINHEIRO = "Dinheiro"

    /** ENTREGUE e ENCERRADO são finalizados (o celular conta os dois em "Concluídas hoje"). */
    fun finalizado(o: JSONObject): Boolean {
        val s = o.optString("status")
        return s == "ENTREGUE" || s == "ENCERRADO"
    }

    fun cancelado(o: JSONObject): Boolean {
        val s = o.optString("status")
        return s == "CANCELADO" || s == "CANCELED" || s == "CANCELLED" || o.optBoolean("cancelado")
    }

    fun pedidos(lista: JSONObject): List<JSONObject> {
        val a = lista.optJSONArray("orders") ?: return emptyList()
        return (0 until a.length()).mapNotNull { a.optJSONObject(it) }
    }

    /** A ordem em que ele RODA: a sequência que a loja montou no mapa, depois o mais antigo. */
    fun naOrdemDaRota(pedidos: List<JSONObject>): List<JSONObject> =
        pedidos.sortedWith(
            compareBy<JSONObject>(
                { o -> if (o.isNull("routeSequence")) Int.MAX_VALUE else o.optInt("routeSequence", Int.MAX_VALUE) },
                { o -> instante(textoDe(o, "createdAt")) ?: Long.MAX_VALUE },
            ),
        )

    /** As datas do servidor vêm de toISOString(): "2026-10-29T21:15:00.000Z". */
    fun instante(iso: String?): Long? {
        if (iso.isNullOrBlank()) return null
        for (formato in arrayOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'")) {
            try {
                val leitor = SimpleDateFormat(formato, Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                    isLenient = false
                }
                return leitor.parse(iso)?.time
            } catch (e: Exception) {
                // tenta o outro formato
            }
        }
        return null
    }

    /** "Não vou levar este pedido" ainda vale (o servidor dá 10 min depois de puxar)? */
    fun podeDevolver(o: JSONObject, agora: Long): Boolean =
        instante(textoDe(o, "podeDevolverAte"))?.let { it > agora } ?: false

    // ------------------------------------------------------------ urgência

    enum class Faixa { ATRASADO, VERMELHO, AMARELO, NO_PRAZO }

    class Limites(val amareloAtivo: Boolean, val amareloMin: Int, val vermelhoAtivo: Boolean, val vermelhoMin: Int)

    class Urgencia(val faixa: Faixa, val minutos: Long, val hora: String) {
        /** "Entregar até 20:45 · faltam 12 min" / "… · atrasado 7 min". */
        val texto: String
            get() = if (faixa == Faixa.ATRASADO) "Entregar até $hora · atrasado ${-minutos} min"
            else "Entregar até $hora · faltam $minutos min"
    }

    /** Os minutos de amarelo/vermelho da loja (`alertaDeTempo`, os do KDS). */
    fun limitesDe(json: JSONObject?): Limites =
        if (json == null) Limites(true, 10, true, 5)
        else Limites(
            json.optBoolean("amareloAtivo", true), json.optInt("amareloMin", 10),
            json.optBoolean("vermelhoAtivo", true), json.optInt("vermelhoMin", 5),
        )

    /** A cor da entrega pela PREVISÃO DE ENTREGA (lib/urgencia.ts do celular). */
    fun urgencia(o: JSONObject, agora: Long, limites: Limites?): Urgencia? {
        val prazo = instante(o.optJSONObject("previsaoEntrega")?.let { textoDe(it, "em") }) ?: return null
        val minutos = floor((prazo - agora) / 60_000.0).toLong()
        val hora = SimpleDateFormat("HH:mm", Locale.US)
            .apply { timeZone = TimeZone.getTimeZone("America/Sao_Paulo") }
            .format(Date(prazo))
        val l = limites ?: limitesDe(null)
        val faixa = when {
            minutos < 0 -> Faixa.ATRASADO
            l.vermelhoAtivo && minutos <= l.vermelhoMin -> Faixa.VERMELHO
            l.amareloAtivo && minutos <= l.amareloMin -> Faixa.AMARELO
            else -> Faixa.NO_PRAZO
        }
        return Urgencia(faixa, minutos, hora)
    }

    // ------------------------------------------------------------ mapa

    class Ponto(val lat: Double, val lng: Double, val aproximado: Boolean)

    /**
     * O ponto do cliente: o exato (`destino.ponto`, que guia a navegação),
     * senão o do mapa (`mapa`, que pode ser só o centro do bairro).
     */
    fun ponto(o: JSONObject): Ponto? {
        o.optJSONObject("destino")?.optJSONObject("ponto")?.let { p ->
            coordenadas(p)?.let { (lat, lng) -> return Ponto(lat, lng, false) }
        }
        o.optJSONObject("mapa")?.let { m ->
            coordenadas(m)?.let { (lat, lng) -> return Ponto(lat, lng, m.optBoolean("aproximado")) }
        }
        return null
    }

    private fun coordenadas(p: JSONObject): Pair<Double, Double>? {
        val lat = p.optDouble("lat", Double.NaN)
        val lng = p.optDouble("lng", Double.NaN)
        return if (lat.isNaN() || lng.isNaN()) null else lat to lng
    }

    /**
     * O `geo:` que abre o app de mapa da maquininha. Ponto exato primeiro; o
     * aproximado (centro do bairro) perde para o texto do endereço, que o app de
     * mapa geocodifica melhor — e só vale quando não há texto.
     */
    fun enderecoDoMapa(o: JSONObject): Uri? {
        val p = ponto(o)
        val texto = o.optJSONObject("destino")?.let { textoDe(it, "texto") }
        return when {
            p != null && !p.aproximado -> Uri.parse("geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}")
            texto != null -> Uri.parse("geo:0,0?q=" + Uri.encode(texto))
            p != null -> Uri.parse("geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}")
            else -> null
        }
    }

    private val DIRECOES = arrayOf("ao norte", "a nordeste", "a leste", "a sudeste", "ao sul", "a sudoeste", "a oeste", "a noroeste")

    /** "1,2 km a nordeste (em linha reta)", de onde a maquininha está até o ponto. */
    fun distanciaEDirecao(de: Location, ate: Ponto): String {
        val r = FloatArray(2)
        Location.distanceBetween(de.latitude, de.longitude, ate.lat, ate.lng, r)
        val metros = r[0]
        if (metros < 50f) return "Você está a menos de 50 m"
        val distancia = if (metros < 1000f) "${Math.round(metros / 10f) * 10} m"
        else String.format(Locale("pt", "BR"), "%.1f km", metros / 1000f)
        val rumo = ((r[1] % 360f) + 360f) % 360f
        return distancia + " " + DIRECOES[((rumo + 22.5f) / 45f).toInt() % 8] + " (em linha reta)"
    }

    // ------------------------------------------------------------ telefone

    /** "(11) 98765-4321"; o 0800 do iFood e o resto ficam como vieram. */
    fun telefoneLegivel(digitos: String): String {
        val d = if (digitos.length >= 12 && digitos.startsWith("55")) digitos.substring(2) else digitos
        return when {
            d.startsWith("0") -> d
            d.length == 11 -> "(${d.substring(0, 2)}) ${d.substring(2, 7)}-${d.substring(7)}"
            d.length == 10 -> "(${d.substring(0, 2)}) ${d.substring(2, 6)}-${d.substring(6)}"
            else -> d
        }
    }
}
