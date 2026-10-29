package br.com.firehub.maquininha.tela

import android.content.Context
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputFilter
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import br.com.firehub.maquininha.R

/**
 * As peças com que o modo garçom monta as telas, por código.
 *
 * As listas dessas telas (mesas, categorias, produtos, opções de um combo) têm
 * tamanho que só se conhece com o cardápio na mão, então são montadas aqui, e
 * não em XML. Os tamanhos seguem a tela de operação: botão de no mínimo 64dp,
 * texto de 17sp para cima — quem toca é o garçom com a bandeja na outra mão.
 */
class Pecas(private val context: Context) {

    fun dp(valor: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, valor.toFloat(), context.resources.displayMetrics,
    ).toInt()

    fun cor(id: Int): Int = ContextCompat.getColor(context, id)

    fun texto(
        conteudo: CharSequence,
        tamanhoSp: Float = 17f,
        corId: Int = R.color.texto,
        negrito: Boolean = false,
        centralizado: Boolean = false,
        margemTopo: Int = 0,
    ): TextView = TextView(context).apply {
        text = conteudo
        setTextSize(TypedValue.COMPLEX_UNIT_SP, tamanhoSp)
        setTextColor(cor(corId))
        if (negrito) setTypeface(typeface, Typeface.BOLD)
        if (centralizado) gravity = Gravity.CENTER
        setLineSpacing(dp(2).toFloat(), 1f)
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(margemTopo) }
    }

    fun botao(
        rotulo: CharSequence,
        principal: Boolean = true,
        alturaDp: Int = 64,
        margemTopo: Int = 8,
        aoTocar: () -> Unit,
    ): Button = Button(context).apply {
        text = rotulo
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, if (principal) 19f else 17f)
        setTextColor(cor(R.color.texto))
        if (principal) setTypeface(typeface, Typeface.BOLD)
        setBackgroundResource(if (principal) R.drawable.botao_principal else R.drawable.botao_secundario)
        minHeight = dp(alturaDp)
        minimumHeight = dp(alturaDp)
        setPadding(dp(12), dp(6), dp(12), dp(6))
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(margemTopo) }
        setOnClickListener { aoTocar() }
    }

    /** Botão pequeno e quadrado, para o − e o + das quantidades. */
    fun botaoDeQuantidade(rotulo: String, aoTocar: () -> Unit): Button = Button(context).apply {
        text = rotulo
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
        setTypeface(typeface, Typeface.BOLD)
        setTextColor(cor(R.color.texto))
        setBackgroundResource(R.drawable.botao_secundario)
        minWidth = dp(56)
        minimumWidth = dp(56)
        minHeight = dp(56)
        minimumHeight = dp(56)
        setPadding(0, 0, 0, 0)
        layoutParams = LinearLayout.LayoutParams(dp(56), dp(56))
        setOnClickListener { aoTocar() }
    }

    fun habilitar(botao: View, habilitado: Boolean) {
        botao.isEnabled = habilitado
        botao.alpha = if (habilitado) 1f else 0.4f
    }

    fun linha(): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        )
    }

    fun coluna(margemTopo: Int = 0): LinearLayout = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(margemTopo) }
    }

    /** Caixa com fundo de cartão e borda; `destaque` pinta a borda de laranja. */
    fun cartao(margemTopo: Int = 10, destaque: Boolean = false, corDoFundo: Int = R.color.fundo_cartao): LinearLayout =
        coluna(margemTopo).apply {
            background = fundoArredondado(corDoFundo, if (destaque) R.color.destaque else R.color.cinza_botao, if (destaque) 3 else 1)
            setPadding(dp(12), dp(10), dp(12), dp(12))
        }

    fun fundoArredondado(corDoFundo: Int, corDaBorda: Int, espessuraDp: Int): GradientDrawable =
        GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(10).toFloat()
            setColor(cor(corDoFundo))
            setStroke(dp(espessuraDp), cor(corDaBorda))
        }

    fun campo(
        dica: String,
        tipo: Int = InputType.TYPE_CLASS_TEXT,
        maximo: Int = 0,
        margemTopo: Int = 8,
    ): EditText = EditText(context).apply {
        hint = dica
        inputType = tipo
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 19f)
        setTextColor(cor(R.color.texto))
        setHintTextColor(cor(R.color.texto_fraco))
        setBackgroundResource(R.drawable.campo_texto)
        setPadding(dp(14), dp(12), dp(14), dp(12))
        minHeight = dp(60)
        // setImportantForAutofill só existe da API 26 em diante; o SK800 é 23.
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        }
        if (maximo > 0) filters = arrayOf(InputFilter.LengthFilter(maximo))
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(margemTopo) }
    }

    /** Etiqueta pequena com fundo de cor livre (a cor da rota vem do servidor). */
    fun selo(conteudo: String, corDoFundo: Int): TextView = TextView(context).apply {
        text = conteudo
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setTextColor(cor(R.color.texto))
        setTypeface(typeface, Typeface.BOLD)
        background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = dp(6).toFloat()
            setColor(corDoFundo)
        }
        setPadding(dp(8), dp(3), dp(8), dp(3))
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { rightMargin = dp(6) }
    }

    /** Linha "rótulo ........ valor" do resumo da conta. */
    fun linhaDeValor(rotulo: String, valor: String, grande: Boolean = false, corId: Int = R.color.texto): LinearLayout =
        linha().apply {
            setPadding(0, dp(3), 0, dp(3))
            addView(texto(rotulo, if (grande) 21f else 17f, corId, negrito = grande).apply {
                layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            })
            addView(texto(valor, if (grande) 23f else 17f, corId, negrito = true).apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
                gravity = Gravity.END
            })
        }
}
