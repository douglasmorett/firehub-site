package br.com.firehub.maquininha.tela

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
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
import br.com.firehub.maquininha.motoboy.ApiDoMotoboy.Resposta
import br.com.firehub.maquininha.motoboy.CofreDoMotoboy
import br.com.firehub.maquininha.motoboy.LeituraDoPedido
import br.com.firehub.maquininha.motoboy.LeituraDoPedido.DINHEIRO
import br.com.firehub.maquininha.motoboy.textoDe
import br.com.firehub.maquininha.servico.ServicoDeCobranca
import br.com.firehub.maquininha.servico.ServicoDeLocalizacao
import org.json.JSONObject

/**
 * App FireHub Motoboy, na maquininha que o motoboy leva.
 *
 * Telas: entrar (telefone/nome e senha, os mesmos do app do celular),
 * entregas (a lista do turno), o pedido (receber na porta) e trocar a senha.
 *
 * Na porta, a mesma fila do app do celular (FluxoDaEntrega.tsx):
 *   1. CÓDIGO do iFood/99, conferido com a plataforma ANTES de tudo e sem dar
 *      baixa: "só abro a bag depois que tenho o código". Antes de passar o
 *      cartão a maquininha ainda pergunta ao servidor se o pedido pede código
 *      (a lista pode estar velha) — o cartão nunca passa antes do código;
 *   2. RECEBER: o motoboy passa o cartão/Pix na maquininha pelo valor que
 *      quiser (pode ser parte) e informa o resto em dinheiro; se nada passou
 *      na maquininha, ele marca com o que o cliente pagou. Igual ao garçom,
 *      esta tela NÃO cobra: manda a passada para a fila endereçada a esta
 *      maquininha e o serviço de cobrança abre a tela da adquirente; no fim a
 *      frente volta para cá (ModoGarcom.voltarAoGarcom, que a OperacaoActivity
 *      usa para os dois apps);
 *   3. BEBIDAS: "você entregou a 2x Coca?". Sem pergunta nenhuma, "Entregou?".
 * "Entregar" fecha o pagamento (/receber, quando passou cartão) e marca a
 * entrega (PATCH de sempre).
 */
class MotoboyActivity : AppCompatActivity() {

    private lateinit var pecas: Pecas
    private lateinit var desenho: DesenhoDaEntrega
    private lateinit var conteudo: LinearLayout
    private lateinit var rodape: LinearLayout
    private lateinit var txtQuem: TextView
    private lateinit var rolagem: ScrollView

    /** O pedido aberto na tela de receber (null = lista). */
    private var aberto: JSONObject? = null

    /** A situação do recebimento do pedido aberto: trocar a forma redesenha sem ir à rede. */
    private var situacaoAberta: JSONObject? = null

    /** Na tela de trocar a senha. */
    private var naSenha = false
    private val relogio = Handler(Looper.getMainLooper())

    /** A tela está na frente (onResume..onPause): só então a lista se atualiza sozinha. */
    private var naTela = false

    /** A última lista que chegou: abrir "Concluídas hoje" redesenha sem ir à rede. */
    private var ultimaLista: JSONObject? = null
    private var verConcluidas = false

    /** O recado do topo da lista ("✅ Pedido #47 entregue!"); some na atualização seguinte. */
    private var recado: String? = null
    private var recadoCor = R.color.aprovado
    private var recadoEm = 0L

    private enum class Gps { LIGADO, LIGANDO, SEM_PERMISSAO, DESLIGADO_NO_APARELHO, FORA_DO_HORARIO }

    override fun onCreate(estadoSalvo: Bundle?) {
        super.onCreate(estadoSalvo)
        pecas = Pecas(this)
        desenho = DesenhoDaEntrega(pecas)
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
            naSenha -> Unit
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
        if (aberto != null || naSenha) {
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
        txtQuem.text = if (CofreDoMotoboy.token(this) == null) "" else
            listOfNotNull(CofreDoMotoboy.nome(this)?.let { "Motoboy: $it" }, textoDoGps(estadoDoGps())).joinToString(" · ")
    }

    private fun titulo(texto: String) {
        conteudo.addView(pecas.texto(texto, 24f, negrito = true, margemTopo = 6))
    }

    private fun aviso(texto: String, corId: Int = R.color.atencao, aoTocar: (() -> Unit)? = null) {
        val t = pecas.texto(texto, 16f, corId, negrito = true, margemTopo = 10)
        if (aoTocar != null) t.setOnClickListener { aoTocar() }
        conteudo.addView(t)
    }

    /**
     * A tela ainda existe? Resposta de rede que chega depois de a Activity ir
     * embora não pode abrir diálogo (o Android derruba o app).
     */
    private fun viva(): Boolean = !isFinishing && !isDestroyed

    /** Recado que não apaga o que o motoboy digitou (o telaDeReceber redesenha). */
    private fun avisoNaTela(texto: String) {
        if (!viva()) return
        AlertDialog.Builder(this).setMessage(texto).setPositiveButton("Ok", null).show()
    }

    /** "Conferindo…" que segura a tela enquanto a rede responde: sem segundo toque. */
    private fun esperar(texto: String): AlertDialog =
        AlertDialog.Builder(this).setMessage(texto).setCancelable(false).show()

    private fun fecharEspera(espera: AlertDialog) {
        try {
            espera.dismiss()
        } catch (e: IllegalArgumentException) {
            // A tela já foi embora.
        }
    }

    /** Duas peças lado a lado, meio a meio. */
    private fun <V : View> lado(v: V, comMargem: Boolean): V = v.apply {
        layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            topMargin = pecas.dp(6)
            if (comMargem) leftMargin = pecas.dp(8)
        }
    }

    private fun deixarRecado(texto: String, corId: Int = R.color.aprovado) {
        recado = texto
        recadoCor = corId
        recadoEm = System.currentTimeMillis()
    }

    // ------------------------------------------------------------------ entrar

    private fun telaDeEntrar(erro: String? = null) {
        aberto = null
        naSenha = false
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
                        is Resposta.Ok -> {
                            val token = textoDe(resp.json, "token")
                            if (token == null) telaDeEntrar("O FireHub não devolveu a sessão. Tente de novo.")
                            else {
                                CofreDoMotoboy.guardar(
                                    this, token, textoDe(resp.json, "motoboyName"), login,
                                    textoDe(resp.json, "motoboyId"), resp.json.optBoolean("mustChangePassword"),
                                )
                                esquecerTudo()
                                ServicoDeLocalizacao.foraDoHorario = false
                                ServicoDeLocalizacao.ligar(this)
                                carregarEntregas()
                            }
                        }
                        is Resposta.Recusada -> telaDeEntrar(resp.mensagem)
                        is Resposta.SemRede -> telaDeEntrar(resp.mensagem)
                        else -> telaDeEntrar("Telefone/nome ou senha incorretos.")
                    }
                },
            )
        }
        rodape.addView(botao)
    }

    /** 401 com `precisaLogin`/`precisaRelogar`: senha trocada ou cadastro desativado. */
    private fun sessaoCaiu() {
        ServicoDeLocalizacao.desligar(this)
        CofreDoMotoboy.sair(this)
        esquecerTudo()
        telaDeEntrar("Sua entrada terminou (senha trocada ou acesso encerrado pela loja). Entre de novo.")
    }

    private fun confirmarSaida() {
        AlertDialog.Builder(this)
            .setTitle("Sair desta maquininha?")
            .setMessage("A loja deixa de ver você no mapa. Para voltar, entre com o telefone e a senha.")
            .setNegativeButton("Ficar", null)
            .setPositiveButton("Sair") { _, _ -> sair() }
            .show()
    }

    /**
     * Sai e some do mapa da loja na hora (DELETE /api/motoboys/location), como
     * o "Sair" do celular. O GPS para ANTES, para nenhuma posição atrasada pôr
     * o motoboy de volta no mapa. Sem rede ou sessão vencida: sai do mesmo jeito.
     */
    private fun sair() {
        val token = CofreDoMotoboy.token(this)
        ServicoDeLocalizacao.desligar(this)
        CofreDoMotoboy.sair(this)
        esquecerTudo()
        if (token != null) TrabalhoDeTela.fazer(tarefa = { ApiDoMotoboy.sairDoMapa(token) }, aoTerminar = { })
        telaDeEntrar()
    }

    /** O que esta maquininha lembra de um pedido (código, forma, cobrança) acaba com ele. */
    private fun esquecer(id: String) {
        RESTO_EM_DINHEIRO.remove(id)
        CODIGO_OK.remove(id)
        SEM_CODIGO.remove(id)
        PEDIU_CODIGO.remove(id)
        FORMA_ESCOLHIDA.remove(id)
        COBRANCA_NO_AR.remove(id)
    }

    private fun esquecerTudo() {
        RESTO_EM_DINHEIRO.clear()
        CODIGO_OK.clear()
        SEM_CODIGO.clear()
        PEDIU_CODIGO.clear()
        FORMA_ESCOLHIDA.clear()
        COBRANCA_NO_AR.clear()
        ultimaLista = null
        recado = null
    }

    // ------------------------------------------------------------------ entregas

    private fun carregarEntregas() {
        aberto = null
        naSenha = false
        limpar()
        titulo("Suas entregas")
        aviso("Carregando…", R.color.texto_fraco)
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        TrabalhoDeTela.fazer(
            tarefa = { ApiDoMotoboy.entregas(token) },
            aoTerminar = { r ->
                if (aberto != null || naSenha) return@fazer
                when (val resp = r.getOrNull()) {
                    is Resposta.Ok -> desenharEntregas(resp.json)
                    is Resposta.SessaoExpirada -> sessaoCaiu()
                    is Resposta.Recusada -> falhaNaLista(resp.mensagem)
                    is Resposta.SemRede -> falhaNaLista(resp.mensagem)
                    null -> falhaNaLista("Falha ao carregar.")
                }
            },
        )
    }

    private fun falhaNaLista(mensagem: String) {
        limpar()
        titulo("Suas entregas")
        aviso(mensagem, R.color.recusado)
        rodapeDaLista()
        // Volta sozinha quando a internet voltar.
        relogio.postDelayed({ atualizarSozinho() }, ATUALIZAR_LISTA_MS)
    }

    private fun rodapeDaLista() {
        rodape.addView(pecas.botao("Atualizar", principal = false) { carregarEntregas() })
        val linha = pecas.linha()
        linha.addView(lado(pecas.botao("Trocar senha", principal = false, alturaDp = 48) { telaDeSenha() }, comMargem = false))
        linha.addView(lado(pecas.botao("Sair", principal = false, alturaDp = 48) { confirmarSaida() }, comMargem = true))
        rodape.addView(linha)
    }

    /** O que a lista traz além dos pedidos: formas, regras da loja, cores e o GPS. */
    private fun lerConfiguracao(json: JSONObject) {
        json.optJSONArray("formasDePagamento")?.let { a ->
            formasDePagamento = (0 until a.length()).mapNotNull { a.optString(it).ifBlank { null } }
        }
        val cfg = json.optJSONObject("appConfig")
        // As mesmas leituras do celular: `permitirSemCodigo !== false` e `permitirSemLocalizacao === false`.
        permitirSemCodigo = cfg?.optBoolean("permitirSemCodigo", true) ?: true
        exigeLocalizacao = cfg?.opt("permitirSemLocalizacao") == false
        limites = LeituraDoPedido.limitesDe(json.optJSONObject("alertaDeTempo"))
        if (json.has("gpsForaDoHorario")) acertarGps(json.optBoolean("gpsForaDoHorario"))
    }

    private fun desenharEntregas(json: JSONObject) {
        ultimaLista = json
        lerConfiguracao(json)
        limpar()
        val gps = estadoDoGps()
        // A loja que exige a localização (App Motoboys › configurações) trava a
        // lista sem ela, como o celular. Fora do horário não trava.
        if (exigeLocalizacao && (gps == Gps.SEM_PERMISSAO || gps == Gps.DESLIGADO_NO_APARELHO)) {
            desenharTravaSemGps(gps)
            relogio.postDelayed({ atualizarSozinho() }, ATUALIZAR_LISTA_MS)
            return
        }
        val agora = System.currentTimeMillis()
        titulo("Suas entregas")
        recado?.let { if (agora - recadoEm < RECADO_MS) aviso(it, recadoCor) else recado = null }
        if (CofreDoMotoboy.trocarSenha(this)) {
            aviso("🔑 Você ainda usa a senha padrão. Toque aqui para trocar.", R.color.atencao) { telaDeSenha() }
        }
        avisoDoGps(gps, agora)
        conteudo.addView(pecas.botao("# Puxar pedido pela comanda", principal = false, alturaDp = 56, margemTopo = 10) { pedirNumeroDaComanda() })

        val todos = LeituraDoPedido.pedidos(json)
        val ativos = LeituraDoPedido.naOrdemDaRota(todos.filter { !LeituraDoPedido.finalizado(it) && !LeituraDoPedido.cancelado(it) })
        val concluidas = todos.filter { LeituraDoPedido.finalizado(it) }
        conteudo.addView(
            pecas.texto("Pendentes: ${ativos.size}   ·   Concluídas hoje: ${concluidas.size}", 16f, R.color.texto_fraco, negrito = true, margemTopo = 12),
        )
        if (ativos.isEmpty()) aviso("Nenhuma entrega com você agora.", R.color.texto_fraco)
        val aqui = ServicoDeLocalizacao.posicaoRecente(this)
        ativos.forEachIndexed { i, o ->
            conteudo.addView(desenho.cartaoDaLista(o, i + 1, agora, limites, aqui, aoAbrir = { telaDeReceber(o) }, aoMapa = { abrirNoMapa(o) }))
        }
        if (concluidas.isNotEmpty()) {
            conteudo.addView(
                pecas.botao((if (verConcluidas) "▴ " else "▾ ") + "Concluídas hoje (${concluidas.size})", principal = false, alturaDp = 48, margemTopo = 16) {
                    verConcluidas = !verConcluidas
                    redesenharLista()
                },
            )
            if (verConcluidas) for (o in concluidas) {
                conteudo.addView(
                    pecas.linhaDeValor(
                        "✓ #" + (textoDe(o, "numero") ?: "") + " · " + (textoDe(o, "customerName") ?: ""),
                        Dinheiro.formatarReais(o.optDouble("totalAmount", 0.0)), corId = R.color.aprovado,
                    ),
                )
            }
        }
        rodapeDaLista()
        relogio.postDelayed({ atualizarSozinho() }, ATUALIZAR_LISTA_MS)
    }

    private fun redesenharLista() {
        val lista = ultimaLista ?: return carregarEntregas()
        val y = rolagem.scrollY
        desenharEntregas(lista)
        rolagem.post { rolagem.scrollTo(0, y) }
    }

    /**
     * A lista se atualiza sozinha enquanto está na tela (Douglas, 29/10/2026:
     * a entrega nova só aparecia tocando em "Atualizar"). Sem "Carregando…":
     * redesenha quando a resposta chega e guarda a rolagem. Abrir um pedido
     * (limpar) ou sair da tela (onPause) desliga o relógio.
     */
    private fun atualizarSozinho() {
        if (aberto != null || naSenha || !naTela) return
        val token = CofreDoMotoboy.token(this) ?: return
        TrabalhoDeTela.fazer(
            tarefa = { ApiDoMotoboy.entregas(token) },
            aoTerminar = { r ->
                if (aberto != null || naSenha || !naTela) return@fazer
                when (val resp = r.getOrNull()) {
                    is Resposta.Ok -> {
                        val rolagemAntes = rolagem.scrollY
                        desenharEntregas(resp.json)
                        rolagem.post { rolagem.scrollTo(0, rolagemAntes) }
                    }
                    is Resposta.SessaoExpirada -> sessaoCaiu()
                    // Sem rede ou recusa: fica a lista que está na tela e tenta de novo.
                    else -> relogio.postDelayed({ atualizarSozinho() }, ATUALIZAR_LISTA_MS)
                }
            },
        )
    }

    // ------------------------------------------------------------------ puxar pela comanda

    private fun pedirNumeroDaComanda() {
        val campo = pecas.campo("Ex.: 47", InputType.TYPE_CLASS_NUMBER, maximo = 6, margemTopo = 0)
        val moldura = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pecas.dp(20), pecas.dp(8), pecas.dp(20), 0)
            addView(campo)
        }
        AlertDialog.Builder(this)
            .setTitle("Número da comanda")
            .setMessage("É o número grande no topo do papel.")
            .setView(moldura)
            .setNegativeButton("Cancelar", null)
            .setPositiveButton("Puxar pedido") { _, _ ->
                val numero = campo.text.toString().filter { it.isDigit() }
                if (numero.isNotEmpty()) confirmarPuxar(numero)
            }
            .show()
    }

    /** A confirmação mostra só o NÚMERO: nada do cliente antes de o pedido ser dele. */
    private fun confirmarPuxar(numero: String) {
        AlertDialog.Builder(this)
            .setTitle("Puxar o pedido #$numero?")
            .setMessage("Ele entra na sua lista, a loja vê o seu nome nele e o cliente fica sabendo que saiu.")
            .setNegativeButton("Cancelar", null)
            .setPositiveButton("Sim, é minha entrega") { _, _ -> puxar(numero, puxarRota = false) }
            .show()
    }

    private fun puxar(codigo: String, puxarRota: Boolean) {
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        val espera = esperar(if (puxarRota) "Puxando a rota…" else "Puxando o pedido…")
        TrabalhoDeTela.fazer(
            tarefa = { ApiDoMotoboy.puxar(token, codigo, puxarRota) },
            aoTerminar = { r ->
                fecharEspera(espera)
                when (val resp = r.getOrNull()) {
                    is Resposta.Ok -> {
                        val j = resp.json
                        if (puxarRota) {
                            val quantos = j.optJSONArray("numeros")?.length() ?: 1
                            deixarRecado(if (quantos > 1) "✅ $quantos pedidos são seus. Boa entrega." else "✅ O pedido é seu. Boa entrega.")
                            carregarEntregas()
                        } else {
                            deixarRecado(
                                if (j.optBoolean("jaEraSeu")) "✅ Este pedido já era seu!"
                                else "✅ Pedido #" + (textoDe(j, "numero") ?: codigo) + " é seu! Boa entrega.",
                            )
                            carregarEntregas()
                            perguntarARota(codigo, j.optJSONObject("rota"))
                        }
                    }
                    is Resposta.SessaoExpirada -> sessaoCaiu()
                    is Resposta.Recusada -> recusaDoPuxar(resp)
                    is Resposta.SemRede -> avisoNaTela(
                        if (puxarRota) "Sem conexão — os outros pedidos NÃO foram puxados. Tente de novo."
                        else "Sem conexão — o pedido NÃO foi puxado. Tente de novo.",
                    )
                    null -> avisoNaTela("Não consegui puxar. Confirme com a loja.")
                }
            },
        )
    }

    /**
     * Rota 100% automatizada: o pedido tem companhia na rota. A pergunta só
     * mostra os NÚMEROS — os outros ainda não são dele.
     */
    private fun perguntarARota(codigo: String, rota: JSONObject?) {
        if (rota == null || !viva()) return
        val outros = rota.optJSONArray("outros") ?: return
        if (outros.length() == 0) return
        val numeros = (0 until outros.length())
            .mapNotNull { outros.optJSONObject(it)?.let { o -> textoDe(o, "numero") } }
            .joinToString(", ") { "#$it" }
        AlertDialog.Builder(this)
            .setTitle(textoDe(rota, "routeNumber") ?: "Rota")
            .setMessage("Este pedido tem mais ${outros.length()} com ele ($numeros). Puxar também?")
            .setNegativeButton("Só este", null)
            .setPositiveButton("Sim, puxar todos") { _, _ -> puxar(codigo, puxarRota = true) }
            .show()
    }

    private fun recusaDoPuxar(resp: Resposta.Recusada) {
        val erro = resp.json?.let { textoDe(it, "erro") }
        val titulo = when {
            erro == "ROTA_DE_OUTRO" -> "Esta rota é de outro entregador"
            erro == "PEGO" -> "Pedido já puxado"
            resp.status == 404 -> "Pedido não encontrado"
            resp.status == 429 -> "Espere um instante"
            else -> "Não deu para puxar"
        }
        val texto = if (resp.status == 429) "Muitas tentativas seguidas. Aguarde um instante e tente de novo." else resp.mensagem
        if (!viva()) return
        AlertDialog.Builder(this).setTitle(titulo).setMessage(texto).setPositiveButton("Ok", null).show()
    }

    /** "Não vou levar este pedido": volta para a loja (só nos 10 min depois de puxar). */
    private fun devolver(pedido: JSONObject) {
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        val id = pedido.optString("id")
        AlertDialog.Builder(this)
            .setTitle("Devolver o pedido #" + (textoDe(pedido, "numero") ?: "") + "?")
            .setMessage("Ele volta para a loja e sai da sua lista.")
            .setNegativeButton("Não", null)
            .setPositiveButton("Devolver") { _, _ ->
                TrabalhoDeTela.fazer(
                    tarefa = { ApiDoMotoboy.devolver(token, id) },
                    aoTerminar = { r ->
                        when (val resp = r.getOrNull()) {
                            is Resposta.Ok -> {
                                esquecer(id)
                                deixarRecado("↩️ Pedido devolvido para a loja.", R.color.atencao)
                                carregarEntregas()
                            }
                            is Resposta.SessaoExpirada -> sessaoCaiu()
                            is Resposta.Recusada -> avisoNaTela(resp.mensagem)
                            is Resposta.SemRede -> avisoNaTela("Sem conexão — o pedido NÃO foi devolvido. Tente de novo.")
                            null -> avisoNaTela("Não consegui devolver. Fale com a loja.")
                        }
                    },
                )
            }
            .show()
    }

    /** Devolver só antes de passar cartão: depois disso o dinheiro já está com o pedido. */
    private fun botaoDevolver(pedido: JSONObject) {
        val id = pedido.optString("id")
        val passouCartao = (situacaoAberta?.optLong("naMaquininhaCentavos") ?: 0L) > 0
        if (passouCartao || COBRANCA_NO_AR.containsKey(id) || !LeituraDoPedido.podeDevolver(pedido, System.currentTimeMillis())) return
        conteudo.addView(pecas.botao("Não vou levar este pedido", principal = false, alturaDp = 48, margemTopo = 18) { devolver(pedido) })
    }

    // ------------------------------------------------------------------ mapa

    /**
     * Abre o endereço no app de mapa que a maquininha tiver (geo:). Sem
     * WebView e sem Google Maps embutido: a homologação reprova os dois.
     */
    private fun abrirNoMapa(pedido: JSONObject) {
        val endereco = LeituraDoPedido.enderecoDoMapa(pedido) ?: return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, endereco))
        } catch (e: ActivityNotFoundException) {
            avisoNaTela("Esta maquininha não tem app de mapa. Use o endereço e a direção que aparecem na tela.")
        }
    }

    // ------------------------------------------------------------------ receber

    private fun telaDeReceber(pedido: JSONObject, erro: String? = null, bom: String? = null) {
        aberto = pedido
        naSenha = false
        limpar()
        val id = pedido.optString("id")
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        val numero = textoDe(pedido, "numero")?.let { "#$it" } ?: ""
        titulo("Entrega $numero")
        conteudo.addView(pecas.texto(textoDe(pedido, "customerName") ?: "", 17f))
        textoDe(pedido, "endereco")?.let { conteudo.addView(pecas.texto(it, 15f, R.color.texto_fraco)) }
        erro?.let { aviso(it, R.color.recusado) }
        aviso("Carregando…", R.color.texto_fraco)

        val noAr = COBRANCA_NO_AR[id]
        TrabalhoDeTela.fazer(
            tarefa = {
                val situacao = ApiDoMotoboy.situacaoDoRecebimento(token, id)
                // A cobrança mandada antes ainda está no ar? (a que dá 409 no próximo "Cobrar")
                val cobranca = if (noAr != null && situacao is Resposta.Ok) ApiDoMotoboy.situacaoDaCobranca(token, id, noAr.id) else null
                situacao to cobranca
            },
            aoTerminar = { r ->
                if (aberto?.optString("id") != id) return@fazer
                val (resp, cobranca) = r.getOrNull() ?: (null to null)
                conferirCobrancaNoAr(id, cobranca)
                when (resp) {
                    is Resposta.Ok -> desenharReceber(pedido, resp.json, erro, bom)
                    is Resposta.SessaoExpirada -> sessaoCaiu()
                    is Resposta.Recusada -> {
                        deixarRecado(resp.mensagem, R.color.atencao)
                        aberto = null
                        carregarEntregas()
                    }
                    else -> desenharReceber(pedido, null, "Sem conexão com o FireHub. Confira a internet.")
                }
            },
        )
    }

    /** Só segue "no ar" a cobrança que ainda espera a maquininha; paga ou recusada sai. */
    private fun conferirCobrancaNoAr(id: String, resp: Resposta?) {
        when (resp) {
            is Resposta.Ok -> {
                val status = resp.json.optJSONObject("cobranca")?.optString("status")
                if (status != "AGUARDANDO_TERMINAL" && status != "NO_TERMINAL") COBRANCA_NO_AR.remove(id)
            }
            is Resposta.Recusada -> if (resp.status == 404) COBRANCA_NO_AR.remove(id)
            else -> Unit
        }
    }

    /** Redesenha o pedido aberto sem ir à rede, no mesmo ponto da rolagem. */
    private fun redesenharReceber(pedido: JSONObject, erro: String? = null, bom: String? = null) {
        val y = rolagem.scrollY
        desenharReceber(pedido, situacaoAberta, erro, bom)
        rolagem.post { rolagem.scrollTo(0, y) }
    }

    private fun desenharReceber(pedido: JSONObject, situacao: JSONObject?, erro: String?, bom: String? = null) {
        situacaoAberta = situacao
        limpar()
        val id = pedido.optString("id")
        val agora = System.currentTimeMillis()
        titulo("Entrega " + (textoDe(pedido, "numero")?.let { "#$it" } ?: ""))
        desenho.urgencia(pedido, agora, limites)?.let { conteudo.addView(it) }
        conteudo.addView(pecas.texto(textoDe(pedido, "customerName") ?: "", 18f, negrito = true, margemTopo = 4))
        conteudo.addView(desenho.endereco(pedido, ServicoDeLocalizacao.posicaoRecente(this)) { abrirNoMapa(pedido) })
        desenho.telefone(pedido)?.let { conteudo.addView(it) }
        desenho.etiquetas(pedido)?.let { conteudo.addView(it) }
        desenho.troco(pedido)?.let { conteudo.addView(it) }
        desenho.observacao(pedido)?.let { conteudo.addView(it) }
        desenho.sacola(pedido)?.let { conteudo.addView(it) }
        bom?.let { aviso(it, R.color.aprovado) }
        erro?.let { aviso(it, R.color.recusado) }

        // 1. O código vem antes de tudo: sem ele aprovado, nem pagamento nem "Entregar".
        codigoPendente(pedido)?.let { canal ->
            desenharPassoDoCodigo(pedido, canal)
            return
        }

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

        COBRANCA_NO_AR[id]?.let { desenharCobrancaNoAr(pedido, it) }

        // 2. Receber. Cartão e dinheiro andam juntos: o que não vai no cartão vai
        // no dinheiro e vice-versa, e a entrega só fecha com o total coberto
        // (Douglas, 29/10/2026: "não pode ficar faltando pagamento"). Nada
        // passou na maquininha: "O cliente pagou com" diz a forma, e o campo de
        // dinheiro só aparece quando ela é Dinheiro.
        val temQueCobrar = cobrarNaEntrega != null && falta > 0
        val doPedido = textoDe(pedido, "formaDoPedido")
        val forma = formaEscolhida(pedido)
        var campoDinheiro: EditText? = null
        if (temQueCobrar) {
            if (naMaquininha == 0L) desenharFormas(pedido, forma, doPedido)
            val restoNoDinheiro = if (naMaquininha > 0) id in RESTO_EM_DINHEIRO else forma == DINHEIRO

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
            if (naMaquininha > 0 || forma == DINHEIRO) {
                conteudo.addView(pecas.texto("O resto em dinheiro", 16f, R.color.texto_fraco, negrito = true, margemTopo = 16))
                val dinheiroDaEntrega = campoDeValor("Dinheiro recebido", margemTopo = 4)
                dinheiroDaEntrega.setText(Dinheiro.paraCampo(if (restoNoDinheiro) falta else 0L))
                conteudo.addView(dinheiroDaEntrega)
                ligarCartaoEDinheiro(campoCartao, dinheiroDaEntrega, falta)
                campoDinheiro = dinheiroDaEntrega
            }
        }
        val campoTroco = campoDinheiro?.let {
            campoDeValor("Troco para (nota do cliente, opcional)").also { c -> conteudo.addView(c) }
        }
        botaoDevolver(pedido)

        rodape.addView(pecas.botao("✅ Entregar") {
            val trocoPara = campoTroco?.let { Dinheiro.lerCampo(it.text.toString()) }
            if (!temQueCobrar) {
                conferirBebidasEEntregar(pedido, naMaquininha, 0L, trocoPara, null, jaPerguntou = false)
                return@botao
            }
            if (naMaquininha == 0L && forma == null) {
                avisoNaTela("Toque em como o cliente pagou (O CLIENTE PAGOU COM).")
                return@botao
            }
            // `pagamento` só viaja se mudou e se NADA passou na maquininha.
            val pagamento = if (naMaquininha == 0L && forma != doPedido) forma else null
            if (naMaquininha == 0L && forma != DINHEIRO) {
                AlertDialog.Builder(this)
                    .setTitle("Nada passou nesta maquininha")
                    .setMessage(
                        "Para cobrar no cartão aqui, toque em Voltar e depois em \"Cobrar na maquininha\". " +
                            "Se o cliente já pagou " + Dinheiro.formatar(falta) + " em " + forma + " de outro jeito, confirme.",
                    )
                    .setPositiveButton("Já pagou em $forma") { _, _ ->
                        conferirBebidasEEntregar(pedido, 0L, 0L, null, pagamento, jaPerguntou = true)
                    }
                    .setNegativeButton("Voltar", null)
                    .show()
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
                        conferirBebidasEEntregar(pedido, naMaquininha, dinheiro, trocoPara, pagamento, jaPerguntou = true)
                    }
                    .setNegativeButton("Voltar", null)
                    .show()
            }
        })
        rodape.addView(pecas.botao("Voltar às entregas", principal = false, alturaDp = 48) { carregarEntregas() })
    }

    // ------------------------------------------------------------------ 1. código

    /** O canal ("iFood"/"99Food") se o passo do código ainda falta; nulo se já passou ou não pede. */
    private fun codigoPendente(pedido: JSONObject): String? {
        val id = pedido.optString("id")
        if (id in CODIGO_OK || id in SEM_CODIGO) return null
        PEDIU_CODIGO[id]?.let { return it }
        if (pedido.optBoolean("pedeCodigoEntrega") && !pedido.optBoolean("codigoJaConferido")) {
            return textoDe(pedido, "canalDoCodigo") ?: "iFood"
        }
        return null
    }

    /** O código já está resolvido nesta entrega (aprovado, dispensado ou "cliente não tem")? */
    private fun codigoResolvido(pedido: JSONObject): Boolean {
        val id = pedido.optString("id")
        return id in CODIGO_OK || id in SEM_CODIGO || pedido.optBoolean("codigoJaConferido")
    }

    private fun desenharPassoDoCodigo(pedido: JSONObject, canal: String) {
        val caixa = pecas.cartao(margemTopo = 14, destaque = true)
        caixa.addView(pecas.texto("🔐 Código de entrega do $canal", 21f, negrito = true))
        caixa.addView(
            pecas.texto(
                "Peça ao cliente o código que aparece no app do $canal dele (4 a 6 números). " +
                    "Só abra a bag depois que o código for aprovado.",
                15f, R.color.texto_fraco, margemTopo = 4,
            ),
        )
        val campo = pecas.campo("• • • •", InputType.TYPE_CLASS_NUMBER, maximo = 6, margemTopo = 10).apply {
            gravity = Gravity.CENTER
            textSize = 30f
            letterSpacing = 0.3f
        }
        caixa.addView(campo)
        caixa.addView(pecas.botao("✅ Conferir código") {
            val codigo = campo.text.toString().filter { it.isDigit() }
            if (codigo.length < 4) avisoNaTela("O código tem de 4 a 6 números. Peça de novo ao cliente.")
            else conferirCodigo(pedido, codigo, semCodigo = false)
        })
        // Só se a loja deixa fechar sem código (App Motoboys › configurações); o servidor também recusa.
        if (permitirSemCodigo) {
            caixa.addView(pecas.botao("O cliente não tem o código", principal = false, alturaDp = 48) {
                AlertDialog.Builder(this)
                    .setTitle("Confirmar sem o código?")
                    .setMessage("O $canal pode não reconhecer a entrega. Só faça isso se o cliente realmente não tem o código.")
                    .setNegativeButton("Voltar", null)
                    .setPositiveButton("Confirmar sem código") { _, _ -> conferirCodigo(pedido, null, semCodigo = true) }
                    .show()
            })
        }
        conteudo.addView(caixa)
        botaoDevolver(pedido)
        rodape.addView(pecas.botao("Voltar às entregas", principal = false, alturaDp = 48) { carregarEntregas() })
    }

    /**
     * Confere o código com o iFood/99 SEM dar baixa (o servidor grava a
     * aprovação; a baixa depois a reconhece). Com `semCodigo`, só confere se a
     * loja deixa — a baixa leva o `semCodigo` no fim.
     */
    private fun conferirCodigo(pedido: JSONObject, codigo: String?, semCodigo: Boolean) {
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        val id = pedido.optString("id")
        val canal = codigoPendente(pedido) ?: "iFood"
        val espera = esperar(if (semCodigo) "Conferindo com a loja…" else "Conferindo o código com o $canal…")
        TrabalhoDeTela.fazer(
            tarefa = { ApiDoMotoboy.conferirCodigo(token, id, codigo, semCodigo) },
            aoTerminar = { r ->
                fecharEspera(espera)
                if (aberto?.optString("id") != id) return@fazer
                when (val resp = r.getOrNull()) {
                    is Resposta.Ok -> if (resp.json.optBoolean("jaEntregue")) {
                        esquecer(id)
                        deixarRecado("Este pedido já foi finalizado pela loja.", R.color.atencao)
                        carregarEntregas()
                    } else {
                        if (semCodigo) SEM_CODIGO.add(id) else CODIGO_OK.add(id)
                        PEDIU_CODIGO.remove(id)
                        redesenharReceber(pedido, bom = if (semCodigo) "Seguindo sem o código." else "✅ Código aprovado. Pode abrir a bag.")
                    }
                    is Resposta.SessaoExpirada -> sessaoCaiu()
                    is Resposta.Recusada -> {
                        if (resp.json?.optBoolean("semCodigoBloqueado") == true) permitirSemCodigo = false
                        redesenharReceber(pedido, erro = resp.mensagem)
                    }
                    is Resposta.SemRede -> redesenharReceber(pedido, erro = "Sem conexão — o código NÃO foi conferido. Tente de novo.")
                    null -> redesenharReceber(pedido, erro = "Falha ao conferir o código. Tente de novo.")
                }
            },
        )
    }

    /**
     * A baixa voltou pedindo o código (lista velha: 428), recusando o código ou
     * barrando o "sem código": o passo do código reabre no lugar do pagamento.
     */
    private fun voltarAoCodigoSePreciso(pedido: JSONObject, j: JSONObject) {
        val precisa = j.optBoolean("precisaCodigo") || j.optBoolean("codigoIncorreto") || j.optBoolean("semCodigoBloqueado")
        if (!precisa) return
        val id = pedido.optString("id")
        CODIGO_OK.remove(id)
        SEM_CODIGO.remove(id)
        if (j.optBoolean("semCodigoBloqueado")) permitirSemCodigo = false
        PEDIU_CODIGO[id] = textoDe(j, "canalDoCodigo") ?: textoDe(pedido, "canalDoCodigo") ?: "iFood"
    }

    // ------------------------------------------------------------------ 2. receber

    private fun formaEscolhida(pedido: JSONObject): String? =
        FORMA_ESCOLHIDA[pedido.optString("id")] ?: textoDe(pedido, "formaDoPedido")

    /**
     * "O cliente pagou com", quando nada passou na maquininha. As formas vêm
     * do servidor escritas como ele grava; a do pedido vem marcada.
     */
    private fun desenharFormas(pedido: JSONObject, forma: String?, doPedido: String?) {
        val id = pedido.optString("id")
        conteudo.addView(pecas.texto("O CLIENTE PAGOU COM", 14f, R.color.texto_fraco, negrito = true, margemTopo = 16))
        val formas = formasDePagamento.ifEmpty { listOfNotNull(DINHEIRO, doPedido).distinct() }
        for (par in formas.chunked(2)) {
            val linha = pecas.linha()
            par.forEachIndexed { i, f ->
                linha.addView(
                    lado(
                        pecas.botao(f, principal = f == forma, alturaDp = 52, margemTopo = 6) {
                            FORMA_ESCOLHIDA[id] = f
                            redesenharReceber(pedido)
                        },
                        comMargem = i > 0,
                    ),
                )
            }
            if (par.size == 1) linha.addView(lado(View(this), comMargem = true))
            conteudo.addView(linha)
        }
        when {
            forma == null -> aviso("Toque em como o cliente pagou.", R.color.atencao)
            doPedido != null && forma != doPedido ->
                aviso("O pedido dizia $doPedido. A loja vai ver que foi pago em $forma.", R.color.atencao)
        }
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

    /** A cobrança mandada para a maquininha e ainda sem resultado, com o botão de desistir. */
    private fun desenharCobrancaNoAr(pedido: JSONObject, cobranca: CobrancaNoAr) {
        val caixa = pecas.cartao(margemTopo = 12, destaque = true)
        caixa.addView(
            pecas.texto("⏳ Cobrança de " + Dinheiro.formatar(cobranca.valorCentavos) + " mandada para a maquininha", 16f, R.color.atencao, negrito = true),
        )
        caixa.addView(
            pecas.texto(
                "Se a tela do cartão não abriu, desista desta e cobre de novo. Se o cliente já passou o cartão, espere o resultado.",
                15f, R.color.texto_fraco, margemTopo = 2,
            ),
        )
        caixa.addView(pecas.botao("Desistir desta cobrança", principal = false, alturaDp = 48) { desistirDaCobranca(pedido, cobranca) })
        conteudo.addView(caixa)
    }

    /**
     * Desiste da cobrança presa (a que ainda não foi para o cartão). Se a
     * maquininha já a abriu, quem termina é a tela do cartão.
     */
    private fun desistirDaCobranca(pedido: JSONObject, cobranca: CobrancaNoAr) {
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        val id = pedido.optString("id")
        AlertDialog.Builder(this)
            .setTitle("Desistir da cobrança de " + Dinheiro.formatar(cobranca.valorCentavos) + "?")
            .setMessage("Use quando a tela do cartão não abriu. Se o cliente já passou o cartão, toque em Voltar e espere o resultado.")
            .setNegativeButton("Voltar", null)
            .setPositiveButton("Desistir") { _, _ ->
                TrabalhoDeTela.fazer(
                    tarefa = {
                        val cancelou = ApiDoMotoboy.cancelarCobranca(token, id, cobranca.id)
                        val cancelada = cancelou is Resposta.Ok && cancelou.json.optBoolean("success")
                        cancelou to (if (cancelada) null else ApiDoMotoboy.situacaoDaCobranca(token, id, cobranca.id))
                    },
                    aoTerminar = { r ->
                        val (cancelou, situacao) = r.getOrNull() ?: (null to null)
                        when {
                            cancelou is Resposta.SessaoExpirada -> sessaoCaiu()
                            cancelou is Resposta.Ok && situacao == null -> {
                                COBRANCA_NO_AR.remove(id)
                                telaDeReceber(pedido, bom = "Cobrança cancelada. Pode cobrar de novo.")
                            }
                            situacao is Resposta.Ok -> when (situacao.json.optJSONObject("cobranca")?.optString("status")) {
                                "NO_TERMINAL" -> avisoNaTela("A maquininha já abriu esta cobrança. Termine ou cancele na tela do cartão.")
                                "AGUARDANDO_TERMINAL" -> avisoNaTela("Não consegui cancelar. Tente de novo.")
                                // Paga (aparece nas partes), recusada ou cancelada: já saiu do caminho.
                                else -> {
                                    COBRANCA_NO_AR.remove(id)
                                    telaDeReceber(pedido)
                                }
                            }
                            situacao is Resposta.Recusada && situacao.status == 404 -> {
                                COBRANCA_NO_AR.remove(id)
                                telaDeReceber(pedido)
                            }
                            else -> avisoNaTela("Sem conexão — a cobrança NÃO foi cancelada. Tente de novo.")
                        }
                    },
                )
            }
            .show()
    }

    private fun cobrar(pedido: JSONObject, valorCentavos: Long) {
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        val terminalId = CofreDoToken.terminalId(this)
        if (terminalId == null) {
            telaDeReceber(pedido, "A maquininha ainda não falou com o FireHub. Espere aparecer \"Conectado\" e tente de novo.")
            return
        }
        val id = pedido.optString("id")
        val perguntarCodigo = !codigoResolvido(pedido)
        val espera = esperar("Mandando para a maquininha…")
        TrabalhoDeTela.fazer(
            tarefa = {
                // O código vem ANTES do cartão. A lista pode estar velha (o iFood
                // pede o código depois que ela chegou): sem código nenhum, o
                // servidor só diz se este pedido pede — nada é baixado.
                if (perguntarCodigo) {
                    val c = ApiDoMotoboy.conferirCodigo(token, id, null, false)
                    if (c !is Resposta.Ok || c.json.optBoolean("jaEntregue")) return@fazer (c to false)
                }
                ApiDoMotoboy.cobrarNaMaquininha(token, id, Dinheiro.reais(valorCentavos), terminalId) to true
            },
            aoTerminar = { r ->
                fecharEspera(espera)
                val (resp, foiACobranca) = r.getOrNull() ?: (null to true)
                if (!foiACobranca) {
                    naoCobrouPorCausaDoCodigo(pedido, resp)
                    return@fazer
                }
                if (perguntarCodigo && resp != null) CODIGO_OK.add(id)
                when (resp) {
                    is Resposta.Ok -> {
                        resp.json.optJSONObject("cobranca")?.let { c ->
                            textoDe(c, "id")?.let { COBRANCA_NO_AR[id] = CobrancaNoAr(it, valorCentavos) }
                        }
                        // O serviço pega da fila e a tela da adquirente vem para a
                        // frente; no fim a OperacaoActivity devolve para cá.
                        ModoGarcom.voltarAoGarcom = true
                        ServicoDeCobranca.acordar(this)
                    }
                    is Resposta.SessaoExpirada -> sessaoCaiu()
                    is Resposta.Recusada -> telaDeReceber(
                        pedido,
                        resp.mensagem + if (resp.status == 409 && COBRANCA_NO_AR.containsKey(id)) " Se a tela do cartão não abriu, toque em \"Desistir desta cobrança\"." else "",
                    )
                    is Resposta.SemRede -> telaDeReceber(pedido, resp.mensagem)
                    null -> telaDeReceber(pedido, "Falha ao mandar a cobrança.")
                }
            },
        )
    }

    /** A pergunta do código antes do cartão não deixou cobrar. */
    private fun naoCobrouPorCausaDoCodigo(pedido: JSONObject, resp: Resposta?) {
        val id = pedido.optString("id")
        when (resp) {
            is Resposta.Ok -> {
                esquecer(id)
                deixarRecado("Este pedido já foi finalizado pela loja.", R.color.atencao)
                carregarEntregas()
            }
            is Resposta.SessaoExpirada -> sessaoCaiu()
            is Resposta.Recusada -> {
                val j = resp.json
                if (j != null && j.optBoolean("precisaCodigo")) {
                    PEDIU_CODIGO[id] = textoDe(j, "canalDoCodigo") ?: "iFood"
                    telaDeReceber(pedido, "Antes de cobrar: este pedido pede o código de entrega do cliente.")
                } else {
                    telaDeReceber(pedido, resp.mensagem)
                }
            }
            is Resposta.SemRede -> telaDeReceber(pedido, resp.mensagem)
            null -> telaDeReceber(pedido, "Falha ao conferir o pedido. Tente de novo.")
        }
    }

    // ------------------------------------------------------------------ 3. bebidas e baixa

    /**
     * A última pergunta antes da baixa: "você entregou a 2x Coca?". "Ainda não"
     * não baixa nada (o código aprovado e o cartão passado ficam valendo). Sem
     * pergunta nenhuma no caminho, "Entregou?": um toque sem querer no botão
     * fecharia o pedido no iFood e avisaria o cliente.
     */
    private fun conferirBebidasEEntregar(
        pedido: JSONObject, naMaquininha: Long, dinheiro: Long, trocoPara: Long?, pagamento: String?, jaPerguntou: Boolean,
    ) {
        val seguir = { entregar(pedido, naMaquininha, dinheiro, trocoPara, pagamento) }
        val a = pedido.optJSONArray("bebidasParaConferir")
        val bebidas = (0 until (a?.length() ?: 0)).mapNotNull { a?.optJSONObject(it) }
        when {
            bebidas.isNotEmpty() -> {
                val linhas = bebidas.joinToString("\n") { "🥤 " + it.optInt("quantity", 1) + "x " + it.optString("name") }
                val pergunta = if (bebidas.size == 1) {
                    "Você entregou " + bebidas[0].optInt("quantity", 1) + "x " + bebidas[0].optString("name") + "?"
                } else {
                    "Você entregou TODAS essas " + bebidas.sumOf { it.optInt("quantity", 1) } + " bebidas?"
                }
                AlertDialog.Builder(this)
                    .setTitle("🥤 Atenção às bebidas!")
                    .setMessage("$linhas\n\n$pergunta\n\n\"Ainda não\" mantém o pedido pendente — nada é finalizado.")
                    .setNegativeButton("Ainda não", null)
                    .setPositiveButton("Sim, entreguei") { _, _ -> seguir() }
                    .show()
            }
            !jaPerguntou -> AlertDialog.Builder(this)
                .setTitle("📦 Entregou o pedido #" + (textoDe(pedido, "numero") ?: "") + "?")
                .setMessage(textoDe(pedido, "customerName") ?: "")
                .setNegativeButton("Ainda não", null)
                .setPositiveButton("Sim, entreguei") { _, _ -> seguir() }
                .show()
            else -> seguir()
        }
    }

    private fun entregar(pedido: JSONObject, naMaquininha: Long, dinheiro: Long, trocoPara: Long?, pagamento: String?) {
        val token = CofreDoMotoboy.token(this) ?: return telaDeEntrar()
        val id = pedido.optString("id")
        val semCodigo = id in SEM_CODIGO
        val espera = esperar("Confirmando a entrega…")
        TrabalhoDeTela.fazer(
            tarefa = {
                // Passou cartão: fecha o pagamento (cartões conferidos + dinheiro)
                // ANTES do entregue, e o entregue vai sem `pagamento`.
                if (naMaquininha > 0) {
                    val r = ApiDoMotoboy.receber(token, id, Dinheiro.reais(dinheiro), trocoPara?.let { Dinheiro.reais(it) })
                    if (r !is Resposta.Ok) return@fazer r
                }
                ApiDoMotoboy.entregar(token, id, semCodigo, pagamento)
            },
            aoTerminar = { r ->
                fecharEspera(espera)
                when (val resp = r.getOrNull()) {
                    is Resposta.Ok -> {
                        val avisoCodigo = textoDe(resp.json, "avisoCodigo")
                        when {
                            avisoCodigo != null -> deixarRecado("⚠️ $avisoCodigo", R.color.atencao)
                            resp.json.optBoolean("jaEntregue") -> deixarRecado("✅ Este pedido já estava confirmado.")
                            else -> deixarRecado("✅ Pedido #" + (textoDe(pedido, "numero") ?: "") + " entregue!")
                        }
                        esquecer(id)
                        aberto = null
                        carregarEntregas()
                    }
                    is Resposta.SessaoExpirada -> sessaoCaiu()
                    is Resposta.Recusada -> {
                        resp.json?.let { voltarAoCodigoSePreciso(pedido, it) }
                        telaDeReceber(pedido, resp.mensagem)
                    }
                    is Resposta.SemRede -> telaDeReceber(pedido, "Sem conexão — a entrega NÃO foi confirmada. Tente de novo.")
                    null -> telaDeReceber(pedido, "Falha ao marcar a entrega.")
                }
            },
        )
    }

    // ------------------------------------------------------------------ senha

    /**
     * Trocar a senha (e o aviso de senha padrão). O servidor devolve um token
     * novo, porque a troca derruba as sessões antigas: guardado na hora, esta
     * maquininha continua dentro.
     */
    private fun telaDeSenha(erro: String? = null) {
        aberto = null
        naSenha = true
        limpar()
        titulo("Trocar senha")
        if (CofreDoMotoboy.trocarSenha(this)) aviso("Você ainda usa a senha padrão. Escolha uma só sua.", R.color.atencao)
        conteudo.addView(
            pecas.texto("A senha nova vale também no app do celular, e os outros aparelhos pedem para entrar de novo.", 15f, R.color.texto_fraco, margemTopo = 6),
        )
        val tipoSenha = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        val campoAtual = pecas.campo("Senha atual", tipoSenha, margemTopo = 14)
        val campoNova = pecas.campo("Nova senha (mínimo 6)", tipoSenha)
        conteudo.addView(campoAtual)
        conteudo.addView(campoNova)
        erro?.let { aviso(it, R.color.recusado) }

        lateinit var botao: View
        botao = pecas.botao("Salvar nova senha") {
            val atual = campoAtual.text.toString()
            val nova = campoNova.text.toString().trim()
            val motoboyId = CofreDoMotoboy.motoboyId(this)
            when {
                atual.isEmpty() || nova.isEmpty() -> avisoNaTela("Preencha a senha atual e a nova.")
                nova.length < 6 -> avisoNaTela("A nova senha precisa ter pelo menos 6 caracteres.")
                motoboyId == null -> avisoNaTela("Saia e entre de novo para trocar a senha.")
                else -> {
                    pecas.habilitar(botao, false)
                    TrabalhoDeTela.fazer(
                        tarefa = { ApiDoMotoboy.trocarSenha(motoboyId, atual, nova) },
                        aoTerminar = { r ->
                            pecas.habilitar(botao, true)
                            when (val resp = r.getOrNull()) {
                                is Resposta.Ok -> {
                                    // Primeiro o token novo: sem ele a próxima chamada já cai.
                                    CofreDoMotoboy.senhaTrocada(this, textoDe(resp.json, "token"))
                                    deixarRecado("✅ Senha alterada!")
                                    if (naSenha) carregarEntregas()
                                }
                                is Resposta.SessaoExpirada -> sessaoCaiu()
                                is Resposta.Recusada -> if (naSenha) telaDeSenha(resp.mensagem)
                                is Resposta.SemRede -> if (naSenha) telaDeSenha(resp.mensagem)
                                null -> if (naSenha) telaDeSenha("Não consegui trocar a senha.")
                            }
                        },
                    )
                }
            }
        }
        rodape.addView(botao)
        rodape.addView(pecas.botao("Voltar às entregas", principal = false, alturaDp = 48) { carregarEntregas() })
    }

    // ------------------------------------------------------------------ GPS

    private fun estadoDoGps(): Gps = when {
        !ServicoDeLocalizacao.temPermissao(this) -> Gps.SEM_PERMISSAO
        !ServicoDeLocalizacao.aparelhoComLocalizacao(this) -> Gps.DESLIGADO_NO_APARELHO
        ServicoDeLocalizacao.foraDoHorario -> Gps.FORA_DO_HORARIO
        ServicoDeLocalizacao.rodando -> Gps.LIGADO
        else -> Gps.LIGANDO
    }

    private fun textoDoGps(gps: Gps): String = when (gps) {
        Gps.LIGADO -> "GPS ligado"
        Gps.LIGANDO -> "ligando o GPS…"
        Gps.SEM_PERMISSAO -> "GPS sem permissão"
        Gps.DESLIGADO_NO_APARELHO -> "GPS desligado"
        Gps.FORA_DO_HORARIO -> "GPS fora do horário"
    }

    /**
     * Fora do horário da loja (o servidor decide, `gpsForaDoHorario`) o GPS
     * fica desligado; no horário, liga se não estiver ouvindo.
     */
    private fun acertarGps(foraDoHorario: Boolean) {
        ServicoDeLocalizacao.foraDoHorario = foraDoHorario
        when {
            foraDoHorario -> if (ServicoDeLocalizacao.rodando) ServicoDeLocalizacao.desligar(this)
            !ServicoDeLocalizacao.rodando && ServicoDeLocalizacao.aparelhoComLocalizacao(this) -> ServicoDeLocalizacao.ligar(this)
        }
    }

    private fun avisoDoGps(gps: Gps, agora: Long) {
        when (gps) {
            Gps.SEM_PERMISSAO -> aviso(
                "📍 A localização está bloqueada para o app: a loja não te vê no mapa. Toque para liberar " +
                    "(se a pergunta não aparecer: Configurações › Apps › FireHub Motoboy › Permissões).",
                R.color.recusado,
            ) { pedirLocalizacao() }
            Gps.DESLIGADO_NO_APARELHO -> aviso(
                "📍 A localização da maquininha está desligada: a loja não te vê no mapa. Toque para ligar.", R.color.recusado,
            ) { abrirConfiguracaoDeLocalizacao() }
            Gps.FORA_DO_HORARIO -> aviso("📍 GPS desligado fora do horário da loja. Ele liga quando a loja abrir.", R.color.texto_fraco)
            Gps.LIGADO -> ServicoDeLocalizacao.paradoHa(agora)?.let { parado ->
                aviso("📍 A loja não recebe sua posição há ${parado / 60_000} min. Confira o sinal de internet e do GPS.", R.color.atencao)
            }
            Gps.LIGANDO -> Unit
        }
    }

    /** A loja exige a localização e ela não está ligada: a lista não abre (como no celular). */
    private fun desenharTravaSemGps(gps: Gps) {
        conteudo.addView(pecas.texto("📍 Ative a localização para usar o aplicativo", 22f, negrito = true, margemTopo = 10))
        conteudo.addView(
            pecas.texto(
                if (gps == Gps.SEM_PERMISSAO) {
                    "A loja pede a localização ligada para você ver as entregas. Toque em Liberar e aceite. " +
                        "Se a pergunta não aparecer, libere em Configurações › Apps › FireHub Motoboy › Permissões."
                } else {
                    "A localização da maquininha está desligada. Ligue nas configurações e toque em Tentar de novo."
                },
                16f, R.color.texto_fraco, margemTopo = 8,
            ),
        )
        conteudo.addView(pecas.botao(if (gps == Gps.SEM_PERMISSAO) "Liberar a localização" else "Abrir configurações", margemTopo = 14) {
            if (gps == Gps.SEM_PERMISSAO) pedirLocalizacao() else abrirConfiguracaoDeLocalizacao()
        })
        conteudo.addView(pecas.botao("Tentar de novo", principal = false) { carregarEntregas() })
        rodape.addView(pecas.botao("Sair", principal = false, alturaDp = 48) { confirmarSaida() })
    }

    private fun abrirConfiguracaoDeLocalizacao() {
        try {
            startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
        } catch (e: ActivityNotFoundException) {
            avisoNaTela("Ligue a localização nas configurações da maquininha e toque em Atualizar.")
        }
    }

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
        // Negada: a lista mostra a faixa (ou a trava, se a loja exige) quando a tela voltar.
        if (resultados.isNotEmpty() && resultados[0] == PackageManager.PERMISSION_GRANTED) {
            ServicoDeLocalizacao.ligar(this)
        }
    }

    /** A passada mandada para a maquininha: o id para desistir dela e o valor para mostrar. */
    private class CobrancaNoAr(val id: String, val valorCentavos: Long)

    private companion object {
        const val PEDIDO_DE_LOCALIZACAO = 41
        const val ATUALIZAR_LISTA_MS = 15_000L
        const val RECADO_MS = 12_000L

        // O que esta maquininha lembra de cada pedido aberto. Fica fora da
        // Activity porque a tela da adquirente vem para a frente e a volta pode
        // recriar esta tela.

        /** Pedidos em que o motoboy escolheu "resto em dinheiro" ao passar só parte no cartão. */
        val RESTO_EM_DINHEIRO = mutableSetOf<String>()

        /** Código aprovado (ou dispensado pelo servidor): o passo do código não volta. */
        val CODIGO_OK = mutableSetOf<String>()

        /** "O cliente não tem o código" (a loja deixa): a baixa vai com `semCodigo`. */
        val SEM_CODIGO = mutableSetOf<String>()

        /** O servidor pediu o código (428) de um pedido que a lista velha dizia não pedir: o canal. */
        val PEDIU_CODIGO = mutableMapOf<String, String>()

        /** "O cliente pagou com", por pedido. */
        val FORMA_ESCOLHIDA = mutableMapOf<String, String>()

        /** A cobrança mandada e ainda sem resultado — a que pode ficar presa e dar 409 no próximo "Cobrar". */
        val COBRANCA_NO_AR = mutableMapOf<String, CobrancaNoAr>()

        // Da última lista (GET ?formato=app).
        var formasDePagamento: List<String> = emptyList()
        var permitirSemCodigo = true
        var exigeLocalizacao = false
        var limites: LeituraDoPedido.Limites? = null
    }
}
