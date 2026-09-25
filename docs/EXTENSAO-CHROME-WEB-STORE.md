# Publicar a extensão FireHub na Chrome Web Store

Objetivo: o lojista instalar com **1 clique**, sem baixar zip e sem modo do desenvolvedor.
Visibilidade escolhida: **Não listada** — só instala quem recebe o link do painel; não aparece na busca.

---

## 0. Pendências da conta — RESOLVIDAS em 09/09/2026

> Resolvidas quando a FireHub Prazos foi enviada (ver `PRAZOS-CHROME-WEB-STORE.md`). O resto desta seção é histórico.

Verificado no painel em 24/08/2026, na conta `contatohakim@gmail.com`
(publisher `529cf443-6bd1-4aad-8d41-e6e9c252a297`): **a conta ainda não pode publicar**. O painel
redireciona para Configurações e não abre nem a lista de itens enquanto estas três coisas não forem
resolvidas — todas exigem decisão ou dado pessoal seu:

1. **Declaração do negociante** — modal "Ação necessária". É declarar se a conta atua para fins
   comerciais em relação às leis do consumidor do Espaço Econômico Europeu. Declarar-se comerciante
   exige verificar a conta por um perfil de pagamentos do Google, e esses dados aparecem
   publicamente na página do item.
2. **E-mail de contato** — "Um endereço de e-mail válido é necessário para publicar ou editar itens".
   Falta adicionar e verificar em Configurações → Perfil.
3. **Verificação de conta** — "Você precisa tomar outras medidas para verificar sua conta. Isso é
   necessário para manter seu status de editor." Botão **Verificar agora** na mesma tela.

Enquanto isso não estiver resolvido, o resto deste guia fica em espera: o zip já está pronto e a
página do painel já está preparada para receber o ID.

> Detalhe útil que apareceu na mesma tela: **Contas de trusted testers** aceita e-mails específicos e
> deixa o item visível só para eles. Serve para você testar a instalação antes de liberar o link aos
> lojistas, mesmo com o item ainda em rascunho.

---

## 1. Gerar o pacote

```bash
npm run extensao:build
```

Sai em `build/chrome-store/`:

| Arquivo | Para quê |
| --- | --- |
| `firehub-ifood-extension-v1.0.0.zip` | é este que sobe no painel |
| `loja/icone-loja-128.png` | ícone da ficha |
| `loja/captura-*.png` | capturas 1280x800 do popup real, geradas pelo próprio script |
| `loja/tile-promocional-440x280.jpg` | opcional, melhora a ficha |
| `extensao/` | o conteúdo do zip, para conferir |

O script gera uma **cópia limpa**: `firehub-ifood-extension/` continua sendo a pasta de
desenvolvimento (com localhost, carregada sem compactação). Na cópia da loja ele remove localhost do
manifest e dos scripts, gera os ícones 16/48/128 de verdade e valida a sintaxe de cada arquivo.

> Sempre rode o script antes de subir. Subir a pasta de desenvolvimento zipada à mão reprova:
> `host_permissions` com `http://localhost/*` é escopo amplo demais para a revisão.

---

## 2. Criar o item no painel

1. Acesse <https://chrome.google.com/webstore/devconsole> com a conta que pagou a taxa de US$ 5.
2. **Novo item** → suba o `.zip`.
3. O painel gera o **ID da extensão** (32 letras). Guarde: é ele que liga o botão do painel FireHub.

---

## 3. Preencher a ficha

**Nome** (sem marca de terceiro no nome — mesma regra da FireHub Prazos; o iFood aparece só na descrição)
```
FireHub — Prazo Automático de Entrega
```

**Descrição breve** (até 132 caracteres)
```
Ajusta sozinho o tempo de entrega da sua loja no Portal do Parceiro iFood pela fila de pedidos do painel FireHub.
```

**Descrição detalhada**
```
Cuida do tempo de entrega da sua loja no Portal do Parceiro iFood enquanto você atende os clientes.

Como funciona:
• A extensão lê quantos pedidos estão na coluna "Em produção" do seu painel FireHub.
• Você informa quantos entregadores estão na casa.
• Ela escolhe o prazo pela tabela de capacidade (até 1, 2, 3 ou 4 pedidos por entregador: 28, 38, 58 ou 78 min) e aplica na tela de entrega do Portal do Parceiro, na aba que você deixou aberta.
• Se a fila passar de 4 pedidos por entregador, o prazo fica no máximo e um aviso vermelho aparece na tela. Pausar a loja continua sendo decisão sua.

Dois modos:
• Automático — segue a tabela acima.
• Manual — você cria as próprias faixas ("até 5 pedidos, 40 min").

Para quem é: lojistas que usam o painel FireHub (firehubfood.com.br) e vendem pelo iFood. É preciso ter conta ativa no FireHub e estar logado no Portal do Parceiro da própria loja.

O que ela NÃO faz: não aceita, recusa nem cancela pedidos, não pausa a loja, não abre abas sozinha e não mexe em preço nem em taxa. Ela ajusta o tempo de entrega, e só.

Funciona apenas em portal.ifood.com.br e firehubfood.com.br. Não coleta histórico de navegação e não compartilha dados com terceiros.

Produto do FireHub. Não somos o iFood e não temos vínculo com a empresa.
```

**Categoria:** Fluxo de trabalho e planejamento · **Idioma:** Português (Brasil)

**URL da política de privacidade**
```
https://firehubfood.com.br/privacidade-extensao
```

---

## 4. Justificativas de permissão (a aba que mais reprova)

Cole cada uma no campo correspondente:

| Permissão | Justificativa |
| --- | --- |
| `storage` | Guardar no próprio navegador a sessão do lojista e as preferências (modo automático/manual, regras de prazo). |
| `alarms` | Recalcular o tempo de entrega periodicamente enquanto a loja está aberta. |
| `tabs` | Localizar a aba do Portal do Parceiro iFood que o próprio lojista deixou aberta, para aplicar o prazo nela. A extensão não abre aba sozinha: sem a aba, ela só avisa, e abre a tela de entrega apenas quando o lojista clica no aviso. |
| `activeTab` | Agir na aba do Portal iFood quando o lojista aciona a extensão. |
| `scripting` | Aplicar a alteração do tempo de entrega na página do Portal do Parceiro iFood. |
| `host_permissions` (`portal.ifood.com.br`, `firehubfood.com.br`) | São os dois únicos sites onde a extensão opera: lê a fila da cozinha no painel FireHub e aplica o prazo no portal do iFood, ambos da própria loja do usuário. |

**Finalidade única (single purpose)**
```
Ajustar automaticamente o tempo de entrega da loja do próprio usuário no Portal do Parceiro iFood
com base na carga de pedidos do painel FireHub.
```

**Uso de dados** — marque: não vende a terceiros, não usa para finalidade alheia ao item, não usa
para avaliar crédito/empréstimo. E aceite as três declarações no fim da aba.

---

## 5. Visibilidade e publicação

Em **Distribuição**: visibilidade **Não listada**, disponibilidade **todas as regiões**.
Depois **Enviar para revisão**. A primeira análise costuma levar de alguns dias a duas semanas —
extensão que automatiza portal de terceiro atrai revisão manual.

---

## 6. Ligar o botão no painel FireHub

Com o ID em mãos, defina a variável (local no `.env` e em produção no Coolify):

```
NEXT_PUBLIC_CHROME_EXTENSION_ID="abcdefghijklmnopqrstuvwxyzabcdef"
```

Como é `NEXT_PUBLIC_*`, ela entra no bundle: **rebuild + redeploy** depois de definir.

Sem a variável, `/store/extensao-ifood` mostra "Publicação em análise no Google". Com ela, aparece o
botão que leva para `https://chromewebstore.google.com/detail/<ID>`. Quando o lojista já tem a
extensão, o content script carimba `data-firehub-extension` no `<html>` e a página troca o botão por
"Extensão instalada".

---

## 7. Publicar uma atualização

1. Suba `version` no `firehub-ifood-extension/manifest.json` (ex.: `1.0.1`).
2. `npm run extensao:build`.
3. Painel → item → **Pacote** → subir o novo zip → enviar para revisão.

O Chrome atualiza os lojistas sozinho em algumas horas. Nada de pedir para ninguém recarregar pasta.

---

## Se a revisão recusar

- **"Escopo de permissões amplo"** → confirme que o zip veio do script (o manifest da loja não pode
  ter localhost) e reforce a justificativa de `host_permissions`.
- **"Funcionalidade não demonstrável"** → o revisor precisa conseguir ver o produto funcionando.
  Crie uma conta de teste no FireHub e informe e-mail e senha no campo "Instruções para revisão".
- **"Automação de site de terceiro"** → responda que a extensão age apenas na sessão que o próprio
  lojista já tem aberta, na loja dele, e não contorna autenticação nem termos do iFood.

---

## Item criado e enviado em 25/09/2026

- **ID da extensão:** `icmjhjaniopcbdeamcnngoencpcbahhh`
- **Link de instalação (vale depois de aprovada):** <https://chromewebstore.google.com/detail/icmjhjaniopcbdeamcnngoencpcbahhh>
- **Painel:** <https://chrome.google.com/webstore/devconsole/529cf443-6bd1-4aad-8d41-e6e9c252a297/icmjhjaniopcbdeamcnngoencpcbahhh/edit>
- **Status:** Revisão pendente, com publicação automática ao aprovar. Não listada, sem custo
  financeiro (a extensão não tem função de compra; a exigência de conta FireHub está na descrição),
  todas as regiões.
- **Conta de revisão:** `revisao.extensao@firehubfood.com.br`, loja FRANCHISEE criada direto no
  banco (o formulário de criar loja do admin não está montado em tela nenhuma), loja fechada, sem
  slug, sem documento, sem integração, trial até 24/11/2026. A senha fica só no console, aba
  *Instruções de teste*. Desativar depois da aprovação.
- **Dados declarados:** identificação pessoal (e-mail), autenticação (senha enviada ao nosso
  servidor no login) e conteúdo do site (contagem da coluna "Em produção").

**Quando aprovar:** definir `NEXT_PUBLIC_CHROME_EXTENSION_ID="icmjhjaniopcbdeamcnngoencpcbahhh"` no
Coolify e fazer redeploy — o passo 1 de `/store/extensao-ifood` troca o WhatsApp pelo botão da loja.
Quem já usa a pasta descompactada precisa remover e instalar pela loja (ID diferente = extensão
diferente para o Chrome; o login na extensão é pedido de novo).
