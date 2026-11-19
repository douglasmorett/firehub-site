# FireHub — Balcão no WhatsApp (extensão do Chrome)

Abre o **balcão do FireHub na lateral direita do WhatsApp Web**: o atendente lê a
conversa e monta o pedido ao lado, com o nome e o telefone do cliente já
preenchidos. O pedido sai igual ao do Balcão do painel (caixa, comanda, entrega).

## Instalar (sem a Chrome Web Store)

1. No Chrome, abra `chrome://extensions`.
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. **Carregar sem compactação** → escolha esta pasta (`extensao-whatsapp`).
4. Fixe o ícone 🔥 na barra do Chrome (quebra-cabeça → alfinete).
5. Entre no painel do FireHub nesse mesmo Chrome (o balcão usa o mesmo login).

## Usar

- Abra `https://web.whatsapp.com` e clique no ícone 🔥 da barra (ou no botão
  **🔥 Balcão** na borda direita da página). O painel abre à direita e empurra
  o WhatsApp — não tapa a conversa. Para recolher, o **X** do próprio painel
  (ou o ícone 🔥 de novo).
- Trocou de conversa no WhatsApp, o balcão troca de cliente. Cada conversa
  guarda o seu carrinho até finalizar.

## Produção x teste no computador

Padrão: `https://firehubfood.com.br`. Para testar no localhost: **⚙** no topo do
painel (ou botão direito no ícone → Opções) → "Teste no computador" →
`http://localhost:<porta>` → Salvar → **↻**.

## Limites conhecidos

- **O número do cliente é lido da página do WhatsApp Web**, que não tem API para
  isso. Vem do `data-id` das mensagens da conversa aberta ou, para contato não
  salvo, do título. Contato que o WhatsApp esconde atrás de um código (`@lid`) e
  contato salvo sem mensagem carregada podem vir **só com o nome** — e quando o
  WhatsApp muda a página, a leitura pode parar. Nesses casos o balcão abre vazio
  e o atendente digita, como no balcão comum.
- Usa o **painel lateral do Chrome** (Chrome 116+), não uma faixa desenhada dentro
  do WhatsApp: dentro do WhatsApp o Chrome não mandaria o login do FireHub para a
  moldura (cookie de terceiro) e o CSP do WhatsApp bloquearia a moldura.
- Só Chrome (e navegadores Chromium com painel lateral, como o Edge recente).
