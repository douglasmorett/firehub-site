# Publicar a FireHub Prazos na Chrome Web Store

Objetivo: o lojista que assinou instalar com **1 clique**, sem baixar zip e sem modo do
desenvolvedor. Visibilidade escolhida: **Não listada** — só instala quem recebe o link, e o item não
aparece na busca da loja.

> **Por que isso deixou de ser opcional.** A documentação do Chrome diz que instalação a partir de um
> arquivo `.crx` local **não é permitida no Windows (desde o Chrome 33) nem no macOS (desde o 44)** —
> fora da loja, só Linux. E extensão carregada em modo desenvolvedor é **desligada quando o Chrome
> atualiza**. Ou seja: vender com instalação manual é vender um produto que, numa segunda-feira
> qualquer, amanhece desligado sem o lojista entender por quê.
> <https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions>

---

## 0. Pendências da conta — RESOLVIDAS em 09/09/2026

> Item enviado para análise em 09/09/2026 (status **Revisão pendente**). O que segue nesta seção é histórico.

### Como estava

A taxa de US$ 5 **já foi paga**: a conta `contatohakim@gmail.com` tem publisher
`529cf443-6bd1-4aad-8d41-e6e9c252a297`. Mas em 24/08/2026 o painel estava travado em três itens, e
enquanto eles não forem resolvidos o console nem abre a lista de itens:

1. **Declaração do negociante** — declarar se a conta atua para fins comerciais perante as leis do
   consumidor do Espaço Econômico Europeu. Declarar-se comerciante exige verificar a conta por um
   perfil de pagamentos do Google, e esses dados ficam públicos na página do item.
2. **E-mail de contato** — precisa ser adicionado e verificado em Configurações → Perfil.
3. **Verificação de conta** — botão "Verificar agora" na mesma tela.

Os três exigem dado pessoal e decisão sua. Nenhum deles dá para eu fazer.

> **Contas de trusted testers** aceitam e-mails específicos e deixam o item visível só para eles.
> Serve para testar a instalação de verdade antes de liberar o link para os assinantes.

---

## 1. Gerar o pacote

```bash
npm run prazos:build
```

Sai em `build/chrome-store-prazos/`:

| Arquivo | Para quê |
| --- | --- |
| `firehub-prazos-v<versão>.zip` | é este que sobe no painel |
| `extensao/` | o conteúdo do zip, para conferir antes |

O script gera uma **cópia limpa**: `firehub-prazos-extension/` continua sendo a pasta de
desenvolvimento. Na cópia da loja ele remove `http://*` das permissões opcionais (escopo inseguro
reprova), confere que não sobrou localhost e valida a sintaxe de cada arquivo.

---

## 2. Criar o item

1. <https://chrome.google.com/webstore/devconsole> com a conta `contatohakim@gmail.com`.
2. **Novo item** → suba o `.zip`.
3. Guarde o **ID** (32 letras): é ele que vai no link de instalação mandado por e-mail na compra.

---

## 3. Ficha da loja

**Nome** (sem marca de terceiro no nome — evita briga de marca)
```
FireHub Prazos
```

**Descrição breve** (máx. 132 caracteres)
```
Ajusta sozinho o prazo de entrega no iFood e o tempo de preparo no 99Food, pela fila do painel que você já usa.
```

**Descrição detalhada**
```
O FireHub Prazos cuida do prazo de entrega da sua loja enquanto você cuida da cozinha.

Como funciona:
• Você marca, com um clique, as colunas do SEU painel de pedidos que contam pedido em produção.
• A extensão soma esses pedidos e considera quantos entregadores estão na casa.
• Ela escreve o prazo certo no Portal do Parceiro e o tempo de preparo no 99Food Admin, nas lojas
  que você marcar, e confere lendo de volta se entrou.
• Quando a fila estoura a capacidade, ela avisa em vermelho na tela.

Funciona com qualquer sistema de pedidos que mostre os pedidos em colunas numa aba do navegador.
Não exige integração, não exige troca de sistema e não exige autorização de ninguém.

O que ela NÃO faz: não aceita pedido, não recusa, não cancela, não pausa a loja e não mexe em preço
nem em taxa de entrega. Ela escreve o tempo, e só.

Requer assinatura ativa do FireHub Prazos (firehubfood.com.br/prazos) e que o usuário já esteja
logado nos portais das próprias lojas.

Produto independente. Não somos iFood nem 99Food e não temos vínculo com essas empresas.
```

**Categoria:** Fluxo de trabalho e planejamento · **Idioma:** Português (Brasil)

**URL da política de privacidade**
```
https://firehubfood.com.br/privacidade-prazos
```

**Assets:** ícone 128 (já vem no pacote, em `extensao/icons/icon128.png`) e pelo menos uma captura
1280x800. A captura tem que mostrar o produto trabalhando: o popup ao lado de um painel de pedidos.

---

## 4. Justificativas de permissão (a aba que mais reprova)

| Permissão | Justificativa |
| --- | --- |
| `storage` | Guardar no próprio navegador a sessão do assinante, as colunas que ele marcou e o último prazo calculado. |
| `alarms` | Recalcular o prazo periodicamente enquanto a loja está aberta, mesmo sem o usuário mexer na tela. |
| `tabs` | Encontrar as abas que o próprio usuário já deixou abertas (o painel de pedidos dele, o Portal do Parceiro e o 99Food Admin) para agir nelas. A extensão não abre aba sozinha. |
| `activeTab` | Ler a aba que o usuário está vendo no momento em que ele clica em "Marcar coluna". |
| `scripting` | Executar, nas abas acima, a leitura da quantidade de pedidos e a gravação do prazo — que é a função única da extensão. |
| `host_permissions` (`portal.ifood.com.br`, `*.ifood.com.br`, `merchant.99app.com`, `firehubfood.com.br`) | Os portais onde o prazo é escrito, na sessão que o próprio usuário já tem aberta, nas lojas dele; e o servidor do FireHub, que autentica a assinatura e devolve o prazo calculado. |
| `optional_host_permissions` (`https://*/*`) | **Ponto que exige explicação clara.** O painel de pedidos de cada assinante é um sistema diferente (Saipos, Cardápio Web, Consumer, sistemas próprios), então não há como listar os domínios de antemão. A permissão é **opcional** e pedida **um site por vez**, só quando o usuário clica em "Marcar coluna" naquela página. A extensão não lê nenhum site que o usuário não tenha autorizado explicitamente. |

**Finalidade única (single purpose)**
```
Ajustar automaticamente o prazo de entrega e o tempo de preparo das lojas do próprio usuário no
iFood e no 99Food, com base na quantidade de pedidos em produção no painel de pedidos dele.
```

**Uso de dados** — marque: não vende a terceiros, não usa para finalidade alheia ao item, não usa
para avaliar crédito. E aceite as três declarações no fim da aba.

---

## 5. Instruções para revisão (campo "Instruções para o revisor")

O revisor não tem loja no iFood, então precisa de um caminho para ver o produto funcionando. Escreva:

```
Conta de teste para entrar na extensão:
  e-mail: <criar em /admin/prazos, só para a revisão>
  senha:  <senha da conta de revisão>

Para ver a extensão lendo um painel de pedidos, use esta página de demonstração:
  https://firehubfood.com.br/prazos/demo
Clique em "Marcar coluna na aba atual" no popup da extensão, aceite a permissão e clique na coluna
"Em preparo". O popup passa a mostrar a contagem lida da página.

A escrita do prazo acontece no Portal do Parceiro (iFood) e no 99Food Admin, na sessão que o próprio
lojista já tem aberta, na loja dele. A extensão não contorna autenticação nem cria sessão: ela usa a
que o usuário já abriu.
```

> `/prazos/demo` existe e foi validada com o `leitor.js` do pacote publicado (marca por badge, conta 4 → 9 → 6 → 4).
> Conta de revisão: `revisao.chromestore@firehubfood.com.br`, status PILOTO, 2 lojas. A senha fica só no
> console, aba *Instruções de teste* — não a escreva aqui.

---

## 6. Visibilidade e envio

Em **Distribuição**: visibilidade **Não listada**, disponibilidade **todas as regiões**. Depois
**Enviar para revisão**. Extensão que automatiza portal de terceiro atrai revisão manual — conte de
alguns dias a duas semanas.

---

## 7. Depois de aprovada

1. Guarde o ID e troque o link do e-mail de boas-vindas (hoje ele manda o zip):
   `src/app/api/prazos/cakto/route.ts`, constante `LINK_DA_EXTENSAO`.
2. Troque também o guia de instalação da página de venda (`src/app/prazos/page.tsx`) e o do admin
   (`src/app/admin/prazos/PrazosAdminClient.tsx`): passam a ser "clique em Instalar", não mais
   "descompacte e carregue sem compactação".
3. O Chrome passa a atualizar os assinantes sozinho a cada nova versão enviada.

---

## Se a revisão recusar

- **"Escopo de permissões amplo"** → o alvo é o `https://*/*` opcional. Reforce que ele é opcional,
  pedido site a site, no clique do usuário, e que sem ele a extensão não teria como funcionar com o
  sistema de pedidos de cada loja.
- **"Funcionalidade não demonstrável"** → é para isso que existe a página de demonstração e a conta
  de teste. Confira que as duas estão no ar antes de reenviar.
- **"Automação de site de terceiro"** → responda que a extensão age apenas na sessão que o próprio
  lojista já tem aberta, na loja dele, que ela não contorna autenticação e que altera apenas uma
  configuração que o lojista já pode alterar na mão nas mesmas telas.

---

## Item criado em 09/09/2026

- **ID da extensão:** `pkkcnkbkacfiojiapodplkbkmdhhnjag`
- **Link de instalação:** <https://chromewebstore.google.com/detail/pkkcnkbkacfiojiapodplkbkmdhhnjag>
- **Painel:** <https://chrome.google.com/u/3/webstore/devconsole/529cf443-6bd1-4aad-8d41-e6e9c252a297/pkkcnkbkacfiojiapodplkbkmdhhnjag/edit>

Esse ID já está em `src/app/prazos/ativar/AtivacaoClient.tsx` (botão "Instalar no Chrome")
e precisa entrar em `LINK_DA_EXTENSAO` (`src/app/api/prazos/cakto/route.ts`) quando a ficha
for aprovada, no lugar do zip.

## Armadilhas do formulário (vividas em 09/09/2026)

- **"Você está usando código remoto?" vem marcado *Sim* por padrão.** É *Não*: o pacote não tem
  `eval`, `new Function`, `import()` dinâmico nem `<script src>` externo — os dois
  `executeScript` usam função local e o arquivo empacotado `scripts/leitor.js`. Deixar "Sim" reprova.
- O campo **"Justificativa" logo abaixo desse rádio é do código remoto**, não da permissão opcional.
  A explicação do `https://*/*` (pedida site a site, no clique) vai na **justificativa de host**.
- **Pagamentos = "Contém compras no aplicativo"**: a extensão exige assinatura e tem o botão
  "Adicionar mais lojas". "Sem custo financeiro" seria falso e é motivo de remoção.
- **Ícone da Store exige 128x128 exato.** Os três ícones do pacote eram o mesmo 512x512 (o Chrome
  escala, a loja recusa). Regerados em 16/48/128.
- **Dados coletados** declarados: e-mail, a senha do login no nosso servidor, e o número de pedidos
  lido da coluna marcada. Subdeclarar aqui é motivo de remoção depois.
- O e-mail de contato do publisher precisa ser **adicionado e confirmado** (link por e-mail, 1 h).

## Quando aprovar

1. Em `src/app/prazos/instalar/page.tsx`, apagar o `<details>` do arquivo — fica só o botão da loja.
2. Conferir que `chromewebstore.google.com/detail/pkkcnkbkacfiojiapodplkbkmdhhnjag` abre e instala.
3. Fazer uma compra real de R$ 1 e seguir os dois botões do e-mail até a extensão entrar sozinha.
