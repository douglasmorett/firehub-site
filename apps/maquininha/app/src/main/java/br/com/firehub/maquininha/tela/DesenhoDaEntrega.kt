package br.com.firehub.maquininha.tela

import android.graphics.Color
import android.location.Location
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.garcom.Dinheiro
import br.com.firehub.maquininha.motoboy.LeituraDoPedido
import br.com.firehub.maquininha.motoboy.textoDe
import org.json.JSONObject

/**
 * As partes de uma entrega na tela do motoboy: o cartão da lista e os blocos
 * do detalhe. Montadas por código, com as Pecas, como o resto do app.
 *
 * O que mostrar já vem pronto do servidor (formato=app); o que cada parte diz
 * é o que o app do celular diz (apps/motoboy/src/components/CartaoDoPedido.tsx).
 * Sem mapa desenhado: a maquininha não tem WebView nem Google Maps. Tocar no
 * endereço abre o app de mapa que houver, e a distância vem do GPS dela.
 */
class DesenhoDaEntrega(private val pecas: Pecas) {

    /** O cartão da lista. Tocar abre o pedido; tocar no endereço abre o mapa. */
    fun cartaoDaLista(
        o: JSONObject,
        ordem: Int,
        agora: Long,
        limites: LeituraDoPedido.Limites?,
        aqui: Location?,
        aoAbrir: () -> Unit,
        aoMapa: () -> Unit,
    ): LinearLayout {
        val cartao = pecas.cartao(margemTopo = 10)
        val urgencia = LeituraDoPedido.urgencia(o, agora, limites)
        // A borda na cor da urgência, como o cartão do celular.
        urgencia?.let { cartao.background = pecas.fundoArredondado(R.color.fundo_cartao, corDaFaixa(it.faixa), 2) }
        cartao.addView(cabecalho(o, ordem))
        etiquetas(o)?.let { cartao.addView(it) }
        urgencia?.let { cartao.addView(textoDaUrgencia(it)) }
        cartao.addView(pecas.texto(textoDe(o, "customerName") ?: "Cliente", 18f, negrito = true, margemTopo = 4))
        cartao.addView(endereco(o, aqui, aoMapa))
        cartao.addView(pagamento(o))
        troco(o)?.let { cartao.addView(it) }
        observacao(o)?.let { cartao.addView(it) }
        resumoDaSacola(o)?.let { cartao.addView(it) }
        if (o.optBoolean("pedeCodigoEntrega")) {
            cartao.addView(
                pecas.texto("🔐 Pede o código do " + (textoDe(o, "canalDoCodigo") ?: "iFood"), 15f, R.color.atencao, negrito = true, margemTopo = 4),
            )
        }
        cartao.setOnClickListener { aoAbrir() }
        return cartao
    }

    /** "1º · #47 · app 7731": a ordem na rota, o número do painel e o do aplicativo. */
    fun cabecalho(o: JSONObject, ordem: Int?): TextView {
        val partes = mutableListOf<String>()
        ordem?.let { partes.add("${it}º") }
        partes.add("#" + (textoDe(o, "numero") ?: ""))
        textoDe(o, "refDaPlataforma")?.let { partes.add("app $it") }
        return pecas.texto(partes.joinToString("  ·  "), 20f, negrito = true)
    }

    /** A rota (na cor dela) e o canal do pedido. */
    fun etiquetas(o: JSONObject): LinearLayout? {
        val linha = pecas.linha().apply { setPadding(0, pecas.dp(4), 0, 0) }
        o.optJSONObject("routeSchedule")?.let { rota ->
            textoDe(rota, "routeNumber")?.let { numero -> linha.addView(pecas.selo(numero, corDaRota(textoDe(rota, "color")))) }
        }
        textoDe(o, "source")?.let { linha.addView(pecas.selo(it, pecas.cor(R.color.cinza_botao))) }
        return if (linha.childCount > 0) linha else null
    }

    fun urgencia(o: JSONObject, agora: Long, limites: LeituraDoPedido.Limites?): TextView? =
        LeituraDoPedido.urgencia(o, agora, limites)?.let { textoDaUrgencia(it) }

    private fun textoDaUrgencia(u: LeituraDoPedido.Urgencia): TextView =
        pecas.texto("⏰ " + u.texto, 16f, corDaFaixa(u.faixa), negrito = true, margemTopo = 4)

    /**
     * O endereço, a distância e a direção até ele pelo GPS da maquininha, e o
     * aviso de ponto aproximado. Tocar abre o app de mapa (geo:).
     */
    fun endereco(o: JSONObject, aqui: Location?, aoMapa: () -> Unit): LinearLayout {
        val caixa = pecas.coluna(margemTopo = 4)
        caixa.addView(pecas.texto("📍 " + (textoDe(o, "endereco") ?: "Endereço a confirmar"), 16f, negrito = true))
        val ponto = LeituraDoPedido.ponto(o)
        val temMapa = LeituraDoPedido.enderecoDoMapa(o) != null
        val dicas = mutableListOf<String>()
        if (ponto != null && aqui != null) {
            val idade = (System.currentTimeMillis() - aqui.time) / 60_000
            dicas.add(LeituraDoPedido.distanciaEDirecao(aqui, ponto) + (if (idade >= 3) " · GPS de $idade min atrás" else ""))
        }
        if (temMapa) dicas.add("toque para abrir no mapa")
        if (dicas.isNotEmpty()) caixa.addView(pecas.texto(dicas.joinToString(" · "), 14f, R.color.destaque, margemTopo = 2))
        if (ponto?.aproximado == true) {
            caixa.addView(pecas.texto("⚠️ Ponto aproximado (pelo bairro). Confira o número na rua.", 14f, R.color.atencao, margemTopo = 2))
        }
        if (temMapa) caixa.setOnClickListener { aoMapa() }
        return caixa
    }

    /** "Cobrar R$ 87,00 · Dinheiro" ou "Pago — só entregar". */
    fun pagamento(o: JSONObject): TextView {
        val cobrar = o.optJSONObject("cobrarNaEntrega")
            ?: return pecas.texto("Pago — só entregar", 16f, R.color.aprovado, negrito = true, margemTopo = 6)
        return pecas.texto(
            "Cobrar " + Dinheiro.formatarReais(cobrar.optDouble("valor", o.optDouble("totalAmount"))) +
                " · " + (textoDe(cobrar, "metodo") ?: "a combinar"),
            16f, R.color.atencao, negrito = true, margemTopo = 6,
        )
    }

    /**
     * O troco que ele tem de levar no bolso antes de sair da loja. O servidor
     * já fez a conta (`levarDeTroco`); sem cobrança, vale o `changeAmount` ou a
     * observação que fala em troco.
     */
    fun troco(o: JSONObject): TextView? {
        val cobrar = o.optJSONObject("cobrarNaEntrega")
        val trocoPara = cobrar?.optDouble("trocoPara", 0.0) ?: 0.0
        val texto = when {
            cobrar != null && trocoPara > 0 ->
                "💵 Levar " + Dinheiro.formatarReais(cobrar.optDouble("levarDeTroco", 0.0)) +
                    " de troco (cliente paga com " + Dinheiro.formatarReais(trocoPara) + ")"
            cobrar != null -> null
            o.optDouble("changeAmount", 0.0) > 0 -> "💵 Levar troco para " + Dinheiro.formatarReais(o.optDouble("changeAmount", 0.0))
            falaEmTroco(textoDe(o, "observacao")) -> "💵 Atenção: " + textoDe(o, "observacao")
            else -> null
        } ?: return null
        return pecas.texto(texto, 15f, R.color.atencao, negrito = true, margemTopo = 4)
    }

    /** A observação do cliente (a que fala em troco já saiu no troco). */
    fun observacao(o: JSONObject): TextView? {
        val obs = textoDe(o, "observacao") ?: return null
        if (falaEmTroco(obs)) return null
        return pecas.texto("📌 Obs/Ref: $obs", 15f, margemTopo = 4)
    }

    private fun falaEmTroco(texto: String?) = texto != null && texto.contains("troco", ignoreCase = true)

    /** "📞 (11) 98765-4321 · ID para a central: 19612595". A maquininha não liga. */
    fun telefone(o: JSONObject): TextView? {
        val tel = o.optJSONObject("telefone") ?: return null
        val discar = textoDe(tel, "discar") ?: return null
        val id = textoDe(tel, "id")
        return pecas.texto(
            "📞 " + LeituraDoPedido.telefoneLegivel(discar) + (id?.let { " · ID para a central: $it" } ?: ""),
            16f, margemTopo = 4,
        )
    }

    /** Uma linha com o resumo da sacola, para o cartão da lista. */
    private fun resumoDaSacola(o: JSONObject): TextView? {
        val sacola = o.optJSONObject("sacola") ?: return null
        val resumo = textoDe(sacola, "resumo") ?: return null
        return pecas.texto("🛍 " + (if (sacola.optInt("bebidas") > 0) "🥤 " else "") + resumo, 14f, R.color.texto_fraco, margemTopo = 4)
    }

    /** "Ver pedido": abre e fecha os itens ali mesmo, sem redesenhar a tela. */
    fun sacola(o: JSONObject): LinearLayout? {
        val sacola = o.optJSONObject("sacola") ?: return null
        val linhas = sacola.optJSONArray("linhas") ?: return null
        if (linhas.length() == 0) return null
        val itens = pecas.coluna().apply { visibility = View.GONE }
        for (i in 0 until linhas.length()) linhas.optJSONObject(i)?.let { itens.addView(item(it)) }
        val resumo = (if (sacola.optInt("bebidas") > 0) "🥤 " else "") + (textoDe(sacola, "resumo") ?: "")
        lateinit var botao: Button
        botao = pecas.botao("▾ Ver pedido · $resumo", principal = false, alturaDp = 48, margemTopo = 0) {
            val abrir = itens.visibility != View.VISIBLE
            itens.visibility = if (abrir) View.VISIBLE else View.GONE
            botao.text = (if (abrir) "▴ Fechar pedido · " else "▾ Ver pedido · ") + resumo
        }
        return pecas.coluna(margemTopo = 8).apply {
            addView(botao)
            addView(itens)
        }
    }

    private fun item(l: JSONObject): LinearLayout {
        val caixa = pecas.cartao(margemTopo = 6, corDoFundo = R.color.fundo)
        val quantidade = l.optInt("quantidade", 1)
        val bebida = l.optBoolean("bebida")
        caixa.addView(
            pecas.texto(
                "${quantidade}x " + (if (bebida) "🥤 " else "") + (textoDe(l, "nome") ?: ""),
                16f, if (bebida) R.color.destaque else R.color.texto, negrito = true,
            ),
        )
        val escolhas = l.optJSONArray("escolhas")
        if (escolhas != null && escolhas.length() > 0) {
            val partes = (0 until escolhas.length()).mapNotNull { escolhas.optJSONObject(it) }.map { e ->
                val q = e.optInt("quantidade", 1)
                (if (e.optBoolean("bebida")) "🥤 " else "") + (if (q > 1) "${q}x " else "") + (textoDe(e, "nome") ?: "")
            }
            caixa.addView(
                pecas.texto((if (quantidade > 1) "cada: " else "") + partes.joinToString(" · "), 14f, R.color.texto_fraco, margemTopo = 2),
            )
        }
        textoDe(l, "obs")?.let { caixa.addView(pecas.texto("✏️ $it", 14f, R.color.atencao, margemTopo = 2)) }
        return caixa
    }

    fun corDaFaixa(faixa: LeituraDoPedido.Faixa): Int = when (faixa) {
        LeituraDoPedido.Faixa.ATRASADO, LeituraDoPedido.Faixa.VERMELHO -> R.color.recusado
        LeituraDoPedido.Faixa.AMARELO -> R.color.atencao
        LeituraDoPedido.Faixa.NO_PRAZO -> R.color.aprovado
    }

    /** A cor que a loja deu à rota ("#2563EB"); sem cor válida, a do FireHub. */
    private fun corDaRota(hex: String?): Int =
        try {
            if (hex == null) pecas.cor(R.color.destaque) else Color.parseColor(hex)
        } catch (e: IllegalArgumentException) {
            pecas.cor(R.color.destaque)
        }
}
