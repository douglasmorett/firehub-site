package br.com.firehub.maquininha.tela

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import br.com.firehub.maquininha.CofreDoToken
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.TrabalhoDeTela
import br.com.firehub.maquininha.garcom.Dinheiro
import br.com.firehub.maquininha.garcom.ModoGarcom
import br.com.firehub.maquininha.motoboy.ApiDoMotoboy
import br.com.firehub.maquininha.motoboy.CofreDoMotoboy
import br.com.firehub.maquininha.motoboy.textoDe
import br.com.firehub.maquininha.servico.ServicoDeCobranca
import br.com.firehub.maquininha.servico.ServicoDeLocalizacao
import org.json.JSONObject

/**
 * App FireHub Motoboy, na maquininha que o motoboy leva.
 *
 * Três telas: entrar (telefone/nome e senha, os mesmos do app do celular),
 * entregas (a lista do turno) e receber (cobrar na porta).
 *
 * Receber: o motoboy passa o cartão/Pix na maquininha pelo valor que quiser
 * (pode ser parte) e informa o resto em dinheiro. Igual ao garçom, esta tela
 * NÃO cobra: manda a passada para a fila endereçada a esta maquininha e o
 * serviço de cobrança abre a tela da adquirente; no fim a frente volta para cá
 * (ModoGarcom.voltarAoGarcom, que a OperacaoActivity usa para os dois apps).
 * O que passou no cartão fica conferido no servidor; "Entregar" fecha o
 * pagamento (/receber) e marca a entrega (PATCH de sempre).
 */
class MotoboyActivity : AppCompatActivity() {

    private lateinit var pecas: Pecas
    private lateinit var conteudo: LinearLayout
    private lateinit var rodape: LinearLayout
    private lateinit var txtQuem: TextView
    private lateinit var rolagem: ScrollView

    /** O pedido aberto na tela de receber (null = lista). */
    private var aberto: JSONObject? = null
    private val relogio = Handler(Looper.getMainLooper())

    /** A tela está na frente (onResume..onPause): só então a lista se atualiza sozinha. */
    private var naTela = false

    override fun onCreate(estadoSalvo: Bundle?) {
        super.onCreate(estadoSalvo)
        pecas = Pecas(this)
        montarEsqueleto()
        pedirLocalizacao()
    }

    override fun onResume() {
        super.onResume()
        naTela = true
        ModoGarcom.voltarAoGarcom = false
        val pedido = aberto
        when {
            CofreDoMotoboy.token(this) == null -> telaDeEntrar()
            pedido != null -> telaDeReceber(pedido)
            else -> carregarEntregas()
        }
    }

    override fun onPause() {
        naTela = false
        relogio.removeCallbacksAndMessages(null)
        super.onPause()
    }

    @Deprecated("Volta do Android")
    override fun onBackPressed() {
        if (aberto != null) {
            aberto = null
            carregarEntregas()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    // ------------------------------------------------------------------ esqueleto

    private fun montarEsqueleto() {
        val raiz = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(pecas.cor(R.color.fundo))
            setPadding(pecas.dp(14), pecas.dp(12), pecas.dp(14), pecas.dp(10))
        }
        val topo = pecas.linha().apply { setPadding(0, 0, 0, pecas.dp(8)) }
        topo.addView(ImageView(this).apply {
            setImageResource(R.drawable.logo_firehub)
            layoutParams = LinearLayout.LayoutParams(pecas.dp(40), pecas.dp(40))
        })
        val nomes = pecas.coluna().apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { leftMargin = pecas.dp(10) }
        }
        nomes.addView(pecas.texto(CofreDoToken.lojaNome(this) ?: getString(R.string.nome_do_app), 18f, negrito = true))
        txtQuem = pecas.texto("", 14f, R.color.texto_fraco)
        nomes.addView(txtQuem)
        topo.addView(nomes)
        raiz.addView(topo)

        rolagem = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
            isFillViewport = true
        }
        conteudo = pecas.coluna()
        rolagem.addView(conteudo)
        raiz.addView(rolagem)
        rodape = pecas.coluna()
        raiz.addView(rodape)
        setContentView(raiz)
    }

    private fun limpar() {
        relogio.removeCallbacksAndMessages(null)
        conteudo.removeAllViews()
        rodape.removeAllViews()
        rolagem.scrollTo(0, 0)
        txtQuem.text = CofreDoMotoboy.nome(this)?.let { "Motoboy: $it" } ?: ""
    }

    private fun aviso(texto: String, corId: Int = R.color.atencao) {
        conteudo.addView(pecas.texto(texto, 16f, corId, negrito = true, margemTopo = 10))
    }

    // ------------------------------------------------------------------ entrar

    private fun telaDeEntrar(erro: String? = null) {
        aberto = null
        limpar()
        val slug = CofreDoToken.lojaSlug(this)
        conteudo.addView(pecas.texto("Entrar", 24f, negrito = true, margemTopo = 6))
        if (slug == null) {
            aviso("Esta maquininha ainda não está ligada a uma loja. Toque em Voltar e digite o código do painel.")
            return
        }
        conteudo.addView(pecas.texto("Use o telefone (ou nome) e a senha do app do motoboy.", 15f, R.color.texto_fraco, margemTopo = 4))
        val campoLogin = pecas.campo("Telefone ou nome", InputType.TYPE_CLASS_TEXT, margemTopo = 14)
        CofreDoMotoboy.ultimoLogin(this)?.let { campoLogin.setText(it) }
        val campoSenha = pecas.campo("Senha", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD)
        conteudo.addView(campoLogin)
        conteudo.addView(campoSenha)
        erro?.let { aviso(it, R.color.recusado) }

        lateinit var botao: View
        botao = pecas.botao("Entrar") {
            val login = campoLogin.text.toString().trim()
            val senha = campoSenha.text.toString()
            if (login.isEmpty() || senha.isEmpty()) return@botao
            pecas.habilitar(botao, false)
            TrabalhoDeTela.fazer(
                tarefa = { ApiDoMotoboy.entrar(slug, login, senha) },
                aoTerminar = { r ->
                    pecas.habilitar(botao, true)
                    when (val resp = r.getOrNull()) {
                        is ApiDoMotoboy.Resposta.Ok -> {
                            val token = textoDe(resp.json, "token")
                            if (token == null) telaDeEntrar("O FireHub não devolveu a sessão. Tente de novo.")
                            else {
                                CofreDoMotoboy.guardar(this, token, textoDe(resp.json, "motoboyName"), login)
                                ServicoDeLocalizacao.ligar(this)
                                carregarEntregas()
                            }
                        }
                        is ApiDoMotoboy.Resposta.Recusada -> telaDeEntrar(resp.mensagem)
                        is ApiDoMotoboy.Resposta.SemRede -> telaDeEntrar(resp.mensagem)
                        else -> telaDeEntrar("Telefone/nome ou senha incorretos.")
                    }
                },
            )
        }
        rodape.addView(botao)
    }

    private fun sessaoCaiu() {
        CofreDoMotoboy.sair(this)
        ServicoDeLocalizacao.desligar(this)
        telaDeEntrar("Sua sessão expirou. Entre de novo.")
    }

    // ------------------------------------------------------------------ entregas

    private fun carregarEntregas() {
        aberto = null
        limpar()
        conteudo.addView(pecas.texto("Suas entregas", 24f, negrito = true, margemTopo = 6))
        aviso("Carregando…", R.color.texto_fraco)
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        TrabalhoDeTela.fazer(
            tarefa = { ApiDoMotoboy.entregas(token) },
            aoTerminar = { r ->
                when (val resp = r.getOrNull()) {
                    is ApiDoMotoboy.Resposta.Ok -> desenharEntregas(resp.json)
                    is ApiDoMotoboy.Resposta.SessaoExpirada -> sessaoCaiu()
                    is ApiDoMotoboy.Resposta.Recusada -> { limpar(); aviso(resp.mensagem, R.color.recusado); botaoAtualizar() }
                    is ApiDoMotoboy.Resposta.SemRede -> { limpar(); aviso(resp.mensagem, R.color.recusado); botaoAtualizar() }
                    null -> { limpar(); aviso("Falha ao carregar.", R.color.recusado); botaoAtualizar() }
                }
            },
        )
    }

    private fun botaoAtualizar() {
        rodape.addView(pecas.botao("Atualizar", principal = false) { carregarEntregas() })
        rodape.addView(pecas.botao("Sair", principal = false, alturaDp = 48) {
            CofreDoMotoboy.sair(this)
            ServicoDeLocalizacao.desligar(this)
            telaDeEntrar()
        })
    }

    private fun desenharEntregas(json: JSONObject) {
        limpar()
        conteudo.addView(pecas.texto("Suas entregas", 24f, negrito = true, margemTopo = 6))
        val lista = json.optJSONArray("orders")
        val abertas = (0 until (lista?.length() ?: 0))
            .mapNotNull { lista!!.optJSONObject(it) }
            .filter { o ->
                val s = o.optString("status")
                s != "ENTREGUE" && s != "CANCELADO" && !o.optBoolean("cancelado")
            }
        if (abertas.isEmpty()) aviso("Nenhuma entrega com você agora.", R.color.texto_fraco)
        for (o in abertas) {
            val cartao = pecas.cartao(margemTopo = 10)
            val numero = textoDe(o, "numero")?.let { "#$it " } ?: ""
            cartao.addView(pecas.texto(numero + (textoDe(o, "customerName") ?: "Cliente"), 19f, negrito = true))
            textoDe(o, "endereco")?.let { cartao.addView(pecas.texto(it, 15f, R.color.texto_fraco, margemTopo = 2)) }
            val cobrar = o.optJSONObject("cobrarNaEntrega")
            cartao.addView(
                if (cobrar == null) pecas.texto("Pago — só entregar", 16f, R.color.aprovado, negrito = true, margemTopo = 6)
                else pecas.texto(
                    "Cobrar " + Dinheiro.formatarReais(cobrar.optDouble("valor", o.optDouble("totalAmount"))) +
                        " · " + (textoDe(cobrar, "metodo") ?: "a combinar"),
                    16f, R.color.atencao, negrito = true, margemTopo = 6,
                ),
            )
            cartao.setOnClickListener { telaDeReceber(o) }
            conteudo.addView(cartao)
        }
        botaoAtualizar()
        relogio.postDelayed({ atualizarSozinho() }, ATUALIZAR_LISTA_MS)
    }

    /**
     * A lista se atualiza sozinha enquanto está na tela (Douglas, 29/10/2026:
     * a entrega nova só aparecia tocando em "Atualizar"). Sem "Carregando…":
     * redesenha quando a resposta chega e guarda a rolagem. Abrir um pedido
     * (limpar) ou sair da tela (onPause) desliga o relógio.
     */
    private fun atualizarSozinho() {
        if (aberto != null || !naTela) return
        val token = CofreDoMotoboy.token(this) ?: return
        TrabalhoDeTela.fazer(
            tarefa = { ApiDoMotoboy.entregas(token) },
            aoTerminar = { r ->
                if (aberto != null || !naTela) return@fazer
                when (val resp = r.getOrNull()) {
                    is ApiDoMotoboy.Resposta.Ok -> {
                        val rolagemAntes = rolagem.scrollY
                        desenharEntregas(resp.json)
                        rolagem.post { rolagem.scrollTo(0, rolagemAntes) }
                    }
                    is ApiDoMotoboy.Resposta.SessaoExpirada -> sessaoCaiu()
                    // Sem rede ou recusa: fica a lista que está na tela e tenta de novo.
                    else -> relogio.postDelayed({ atualizarSozinho() }, ATUALIZAR_LISTA_MS)
                }
            },
        )
    }

    // ------------------------------------------------------------------ receber

    private fun telaDeReceber(pedido: JSONObject, erro: String? = null) {
        aberto = pedido
        limpar()
        val id = pedido.optString("id")
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        val numero = textoDe(pedido, "numero")?.let { "#$it" } ?: ""
        conteudo.addView(pecas.texto("Entrega $numero", 24f, negrito = true, margemTopo = 6))
        conteudo.addView(pecas.texto(textoDe(pedido, "customerName") ?: "", 17f))
        textoDe(pedido, "endereco")?.let { conteudo.addView(pecas.texto(it, 15f, R.color.texto_fraco)) }
        erro?.let { aviso(it, R.color.recusado) }
        aviso("Carregando…", R.color.texto_fraco)

        TrabalhoDeTela.fazer(
            tarefa = { ApiDoMotoboy.situacaoDoRecebimento(token, id) },
            aoTerminar = { r ->
                when (val resp = r.getOrNull()) {
                    is ApiDoMotoboy.Resposta.Ok -> desenharReceber(pedido, resp.json, erro)
                    is ApiDoMotoboy.Resposta.SessaoExpirada -> sessaoCaiu()
                    is ApiDoMotoboy.Resposta.Recusada -> { aberto = null; carregarEntregas() }
                    else -> desenharReceber(pedido, null, "Sem conexão com o FireHub. Confira a internet.")
                }
            },
        )
    }

    private fun desenharReceber(pedido: JSONObject, situacao: JSONObject?, erro: String?) {
        limpar()
        val numero = textoDe(pedido, "numero")?.let { "#$it" } ?: ""
        conteudo.addView(pecas.texto("Entrega $numero", 24f, negrito = true, margemTopo = 6))
        conteudo.addView(pecas.texto(textoDe(pedido, "customerName") ?: "", 17f))
        textoDe(pedido, "endereco")?.let { conteudo.addView(pecas.texto(it, 15f, R.color.texto_fraco)) }
        erro?.let { aviso(it, R.color.recusado) }

        val cobrarNaEntrega = pedido.optJSONObject("cobrarNaEntrega")
        val total = situacao?.optLong("totalCentavos") ?: Dinheiro.centavos(pedido.optDouble("totalAmount"))
        val naMaquininha = situacao?.optLong("naMaquininhaCentavos") ?: 0L
        val falta = situacao?.optLong("faltaCentavos") ?: total

        val resumo = pecas.cartao(margemTopo = 12)
        resumo.addView(pecas.linhaDeValor("Total do pedido", Dinheiro.formatar(total), grande = true))
        if (cobrarNaEntrega == null) {
            resumo.addView(pecas.texto("Já está pago. É só entregar.", 16f, R.color.aprovado, negrito = true, margemTopo = 6))
        } else {
            textoDe(cobrarNaEntrega, "metodo")?.let { resumo.addView(pecas.linhaDeValor("Cliente disse", it)) }
            situacao?.optJSONArray("partes")?.let { partes ->
                for (i in 0 until partes.length()) {
                    val p = partes.getJSONObject(i)
                    resumo.addView(pecas.linhaDeValor("✓ " + (textoDe(p, "forma") ?: "Cartão"), Dinheiro.formatar(p.optLong("valorCentavos")), corId = R.color.aprovado))
                }
            }
            if (naMaquininha > 0) resumo.addView(pecas.linhaDeValor("Falta", Dinheiro.formatar(falta), grande = true, corId = R.color.atencao))
        }
        conteudo.addView(resumo)

        val pedeCodigo = pedido.optBoolean("pedeCodigoEntrega")
        val campoCodigo = if (pedeCodigo) pecas.campo("Código de entrega do cliente", InputType.TYPE_CLASS_NUMBER, maximo = 8, margemTopo = 14) else null
        campoCodigo?.let { conteudo.addView(it) }

        // Cartão e dinheiro andam juntos: o que não vai no cartão vai no dinheiro
        // e vice-versa, e a entrega só fecha com o total coberto (Douglas,
        // 29/10/2026: "não pode ficar faltando pagamento").
        val id = pedido.optString("id")
        val temQueCobrar = cobrarNaEntrega != null && falta > 0
        var campoDinheiro: EditText? = null
        if (temQueCobrar) {
            val clienteVaiDeDinheiro = textoDe(cobrarNaEntrega!!, "metodo")?.contains("Dinheiro", ignoreCase = true) == true
            val restoNoDinheiro = if (naMaquininha > 0) id in RESTO_EM_DINHEIRO else clienteVaiDeDinheiro

            // Cartão/Pix na maquininha: o valor que faltar (ou parte dele).
            conteudo.addView(pecas.texto("No cartão ou Pix (maquininha)", 16f, R.color.texto_fraco, negrito = true, margemTopo = 16))
            val campoCartao = campoDeValor("Valor")
            campoCartao.setText(Dinheiro.paraCampo(if (restoNoDinheiro) 0L else falta))
            conteudo.addView(campoCartao)
            conteudo.addView(pecas.botao("💳 Cobrar na maquininha") {
                val valor = Dinheiro.lerCampo(campoCartao.text.toString())
                when {
                    valor == null || valor <= 0 || valor > falta ->
                        telaDeReceber(pedido, "Valor do cartão entre R$ 0,01 e " + Dinheiro.formatar(falta) + ".")
                    valor < falta -> AlertDialog.Builder(this)
                        .setTitle("Faltam " + Dinheiro.formatar(falta - valor))
                        .setMessage("O cartão vai cobrir " + Dinheiro.formatar(valor) + " de " + Dinheiro.formatar(falta) + ". Como o cliente paga o resto?")
                        .setPositiveButton("Resto em dinheiro") { _, _ -> RESTO_EM_DINHEIRO.add(id); cobrar(pedido, valor) }
                        .setNeutralButton("Outro cartão ou Pix") { _, _ -> RESTO_EM_DINHEIRO.remove(id); cobrar(pedido, valor) }
                        .setNegativeButton("Voltar", null)
                        .show()
                    else -> { RESTO_EM_DINHEIRO.remove(id); cobrar(pedido, valor) }
                }
            })

            // Dinheiro: o que sobrar depois da maquininha. Troco é da parte em dinheiro.
            conteudo.addView(pecas.texto("O resto em dinheiro", 16f, R.color.texto_fraco, negrito = true, margemTopo = 16))
            val dinheiroDaEntrega = campoDeValor("Dinheiro recebido", margemTopo = 4)
            dinheiroDaEntrega.setText(Dinheiro.paraCampo(if (restoNoDinheiro) falta else 0L))
            conteudo.addView(dinheiroDaEntrega)
            ligarCartaoEDinheiro(campoCartao, dinheiroDaEntrega, falta)
            campoDinheiro = dinheiroDaEntrega
        }
        val campoTroco = campoDinheiro?.let {
            campoDeValor("Troco para (nota do cliente, opcional)").also { c -> conteudo.addView(c) }
        }

        rodape.addView(pecas.botao("✅ Entregar") {
            val codigo = campoCodigo?.text?.toString()?.trim()
            if (pedeCodigo && codigo.isNullOrEmpty()) {
                telaDeReceber(pedido, "Peça ao cliente o código de entrega.")
                return@botao
            }
            val trocoPara = campoTroco?.let { Dinheiro.lerCampo(it.text.toString()) }
            if (!temQueCobrar) {
                entregar(pedido, naMaquininha, 0L, trocoPara, codigo, cobrarNaEntrega != null)
                return@botao
            }
            val dinheiro = campoDinheiro?.let { Dinheiro.lerCampo(it.text.toString()) } ?: 0L
            when {
                dinheiro < falta -> avisoNaTela(
                    "Faltam " + Dinheiro.formatar(falta - dinheiro) + ". Cobre na maquininha ou receba em dinheiro: " +
                        "a entrega só fecha com o total do pedido.",
                )
                dinheiro > falta -> avisoNaTela(
                    "O dinheiro (" + Dinheiro.formatar(dinheiro) + ") passou do que falta (" + Dinheiro.formatar(falta) + "). " +
                        "Se o cliente deu nota maior, ponha em \"Troco para\".",
                )
                else -> AlertDialog.Builder(this)
                    .setTitle("Receber em dinheiro?")
                    .setMessage("Confirma " + Dinheiro.formatar(dinheiro) + " em dinheiro para fechar o pedido?")
                    .setPositiveButton("Sim, recebi") { _, _ ->
                        RESTO_EM_DINHEIRO.remove(id)
                        entregar(pedido, naMaquininha, dinheiro, trocoPara, codigo, true)
                    }
                    .setNegativeButton("Voltar", null)
                    .show()
            }
        })
        rodape.addView(pecas.botao("Voltar às entregas", principal = false, alturaDp = 48) { carregarEntregas() })
    }

    /** Campo de reais que aceita vírgula e ponto, como o do garçom (Dinheiro.lerCampo lê os dois). */
    private fun campoDeValor(dica: String, margemTopo: Int = 8): EditText =
        pecas.campo(dica, InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL, margemTopo = margemTopo).apply {
            keyListener = android.text.method.DigitsKeyListener.getInstance("0123456789,.")
        }

    /** O que sai de um campo entra no outro: cartão + dinheiro = o que falta. */
    private fun ligarCartaoEDinheiro(cartao: EditText, dinheiro: EditText, falta: Long) {
        var mexendo = false
        fun espelhar(de: EditText, para: EditText) = de.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, inicio: Int, antes: Int, depois: Int) {}
            override fun onTextChanged(s: CharSequence?, inicio: Int, antes: Int, depois: Int) {}
            override fun afterTextChanged(s: Editable?) {
                if (mexendo) return
                val valor = Dinheiro.lerCampo(s?.toString().orEmpty()) ?: return
                mexendo = true
                para.setText(Dinheiro.paraCampo((falta - valor).coerceAtLeast(0L)))
                mexendo = false
            }
        })
        espelhar(cartao, dinheiro)
        espelhar(dinheiro, cartao)
    }

    /** Recado que não apaga o que o motoboy digitou (o telaDeReceber redesenha). */
    private fun avisoNaTela(texto: String) {
        AlertDialog.Builder(this).setMessage(texto).setPositiveButton("Ok", null).show()
    }

    private fun cobrar(pedido: JSONObject, valorCentavos: Long) {
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        val terminalId = CofreDoToken.terminalId(this)
        if (terminalId == null) {
            telaDeReceber(pedido, "A maquininha ainda não falou com o FireHub. Espere aparecer \"Conectado\" e tente de novo.")
            return
        }
        TrabalhoDeTela.fazer(
            tarefa = { ApiDoMotoboy.cobrarNaMaquininha(token, pedido.optString("id"), Dinheiro.reais(valorCentavos), terminalId) },
            aoTerminar = { r ->
                when (val resp = r.getOrNull()) {
                    is ApiDoMotoboy.Resposta.Ok -> {
                        // O serviço pega da fila e a tela da adquirente vem para a
                        // frente; no fim a OperacaoActivity devolve para cá.
                        ModoGarcom.voltarAoGarcom = true
                        ServicoDeCobranca.acordar(this)
                    }
                    is ApiDoMotoboy.Resposta.SessaoExpirada -> sessaoCaiu()
                    is ApiDoMotoboy.Resposta.Recusada -> telaDeReceber(pedido, resp.mensagem)
                    is ApiDoMotoboy.Resposta.SemRede -> telaDeReceber(pedido, resp.mensagem)
                    null -> telaDeReceber(pedido, "Falha ao mandar a cobrança.")
                }
            },
        )
    }

    private fun entregar(
        pedido: JSONObject, naMaquininha: Long, dinheiro: Long, trocoPara: Long?, codigo: String?, temCobranca: Boolean,
    ) {
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        val id = pedido.optString("id")
        TrabalhoDeTela.fazer(
            tarefa = {
                // Passou cartão: fecha o pagamento (cartões conferidos + dinheiro)
                // ANTES do entregue, e o entregue vai sem `pagamento`.
                if (naMaquininha > 0) {
                    val r = ApiDoMotoboy.receber(token, id, Dinheiro.reais(dinheiro), trocoPara?.let { Dinheiro.reais(it) })
                    if (r !is ApiDoMotoboy.Resposta.Ok) return@fazer r
                }
                val pagamento = if (temCobranca && naMaquininha == 0L) "Dinheiro" else null
                ApiDoMotoboy.entregar(token, id, codigo, pagamento)
            },
            aoTerminar = { r ->
                when (val resp = r.getOrNull()) {
                    is ApiDoMotoboy.Resposta.Ok -> { aberto = null; carregarEntregas() }
                    is ApiDoMotoboy.Resposta.SessaoExpirada -> sessaoCaiu()
                    is ApiDoMotoboy.Resposta.Recusada -> telaDeReceber(pedido, resp.mensagem)
                    is ApiDoMotoboy.Resposta.SemRede -> telaDeReceber(pedido, resp.mensagem)
                    null -> telaDeReceber(pedido, "Falha ao marcar a entrega.")
                }
            },
        )
    }

    // ------------------------------------------------------------------ GPS

    private fun pedirLocalizacao() {
        if (ServicoDeLocalizacao.temPermissao(this)) {
            ServicoDeLocalizacao.ligar(this)
            return
        }
        val pedir = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) pedir.add(Manifest.permission.POST_NOTIFICATIONS)
        requestPermissions(pedir.toTypedArray(), PEDIDO_DE_LOCALIZACAO)
    }

    override fun onRequestPermissionsResult(codigo: Int, permissoes: Array<out String>, resultados: IntArray) {
        super.onRequestPermissionsResult(codigo, permissoes, resultados)
        if (codigo != PEDIDO_DE_LOCALIZACAO) return
        if (resultados.isNotEmpty() && resultados[0] == PackageManager.PERMISSION_GRANTED) {
            ServicoDeLocalizacao.ligar(this)
        } else {
            limpar()
            aviso("Sem a localização a loja não vê você no mapa. Libere em Configurações › Apps › FireHub Motoboy › Permissões.")
        }
    }

    private companion object {
        const val PEDIDO_DE_LOCALIZACAO = 41
        const val ATUALIZAR_LISTA_MS = 15_000L

        /**
         * Pedidos em que o motoboy escolheu "resto em dinheiro" ao passar só parte
         * no cartão. Fica fora da Activity porque a tela da adquirente vem para a
         * frente e a volta pode recriar esta tela.
         */
        val RESTO_EM_DINHEIRO = mutableSetOf<String>()
    }
}
