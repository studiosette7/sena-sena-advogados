# CRM — Sena & Sena Advogados

O painel de casos do Gildemi. Nasce do formulário da landing: o que a pessoa
responde no site vira um caso aqui dentro, com relógio de prescrição e triagem
assistida por IA.

## As telas

Aplicação com lateral fixa, cinco seções:

| Seção | O que é |
|---|---|
| **Painel** | Faixa com o prazo mais apertado do momento, 6 indicadores, casos por etapa, distribuição por área, próximos prazos e tarefas, entrada de casos por semana, de onde vêm os leads, atividade recente e ações rápidas. |
| **Esteira** | Kanban com as 9 etapas. **Arrastar o cartão muda a etapa** e registra a movimentação sozinho. |
| **Casos** | Tabela com tudo, ordenável por qualquer coluna, com filtro por etapa. |
| **Prazos** | Tarefas e compromissos primeiro, depois a prescrição agrupada por urgência, e no fim os casos sem data de saída. |
| **Escritório** | Dados do escritório, o que a IA faz e custa, o significado de cada etapa, e exportar CSV. |

O detalhe do caso abre numa gaveta com cinco abas: **Ficha**, **Análise IA**,
**Andamento**, **Tarefas** e **Histórico**.

## O que ele faz

- **Recebe o caso** direto do formulário da landing (sem ninguém copiar nada).
- **Conta o prazo.** Prescrição bienal (2 anos do fim do contrato) calculada no
  banco, com aviso quando entra em 180 e em 90 dias.
- **Faz a triagem com IA** — viabilidade, teses, o que pedir de documento, o que
  ainda falta perguntar e um rascunho de resposta pro WhatsApp. Cada item de
  "pedir ao cliente" vira tarefa com um clique.
- **Acompanha o andamento** por etapa, com notas, movimentações e tarefas
  datadas (audiência, prazo, reunião).

Não é funil de vendas. As etapas são o vocabulário do escritório:
`triagem → viabilidade → documentos → contrato → protocolado → andamento →
desfecho → encerrado` (e `descartado`). O pipeline genérico
`novo lead → proposta → ganho/perdido` do Lawra foi deixado de fora de
propósito: quem processa empregador e INSS não trabalha assim.

## Arquivos

```
painel.html                       ← a entrega (arquivo único, igual à landing)
painel-demo.html                  ← pra apresentar antes de existir o Supabase
_build/painel.tpl.html            ← EDITE AQUI, e rode python3 _build/build.py
_build/demo.js                    ← o banco simulado da demonstração
supabase/
  setup.sql                       ← tabelas, RLS e a view do prazo
  functions/triagem/index.ts      ← a Edge Function que chama a Claude
```

`python3 _build/build.py` gera **os três**: `index.html`, `painel.html` e
`painel-demo.html`.

## Apresentar antes de instalar — `painel-demo.html`

Abre com dois cliques, sem login de verdade, sem conta em lugar nenhum. É o
**mesmo painel**: o `demo.js` troca o `fetch` por um banco de mentira que roda
dentro da própria página. Quinze casos fictícios do ABC espalhados por todas as
etapas, com movimentações, tarefas datadas, prazo apertado, prazo vencido,
análises de IA prontas e casos em branco pra clicar em "Analisar com IA" na
frente dele (a análise é simulada e demora uns 2,6 s de propósito).

Recarregar a página desfaz tudo o que foi mexido. Nada sai da máquina — só as
fontes do Google, então **em telão sem internet o tipo cai pro padrão do
sistema**. Se for apresentar offline, abra uma vez com internet antes pra o
navegador cachear.

Nunca publique esse arquivo junto com o site.

## Como está montado

```
Landing (público)                Painel (só o Gildemi)
     │                                  │
     │ INSERT com a chave anon          │ login por e-mail e senha
     ▼                                  ▼
┌─────────────────────────────────────────────┐
│  Supabase — Postgres com RLS                │
│  casos · movimentacoes · casos_com_prazo    │
└─────────────────────────────────────────────┘
                    │  o painel chama
                    ▼
        Edge Function `triagem` (Deno)
                    │  chave da Anthropic é secret do servidor
                    ▼
              Claude Opus 5
```

**A chave da IA nunca chega no navegador.** Ela vive como secret do Supabase e
só a Edge Function enxerga. Quem chama a função precisa estar logado — se não
estiver, ela devolve 401 antes de gastar um token.

### O que a chave `anon` pode fazer

Ela é pública por natureza (vai no HTML da landing). Quem protege é o RLS:

| | anon (o site) | logado (o Gildemi) |
|---|---|---|
| criar caso | ✅ só com `etapa='triagem'`, sem notas e sem IA | ✅ |
| ler caso | ❌ | ✅ |
| editar / apagar | ❌ | ✅ |
| movimentações | ❌ | ✅ |

Ou seja: alguém com a chave anon consegue mandar um caso falso pelo formulário —
como conseguiria preencher o formulário à mão. **Não consegue ler nada.**

## Instalação — passo a passo

### 1. Criar o projeto no Supabase

[supabase.com](https://supabase.com) → New project. Região **South America
(São Paulo)**. Guarde a senha do banco. O plano gratuito dá conta com folga do
volume de um escritório solo.

### 2. Rodar o SQL

SQL Editor → cole o conteúdo de `supabase/setup.sql` → Run. Roda uma vez só.
(É idempotente: rodar de novo não quebra nada.)

### 3. Criar o usuário do Gildemi

Authentication → Users → **Add user** → e-mail e senha, com *Auto confirm user*
ligado. Em Authentication → Providers, **desligue "Enable sign-ups"** — senão
qualquer pessoa cria conta e passa a enxergar os casos.

### 4. Publicar a Edge Function

```bash
cd "Sena & Sena Advogados"
npx supabase login
npx supabase link --project-ref SEU_REF        # o ref está na URL do projeto
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy triagem
```

A chave da Anthropic sai de [console.anthropic.com](https://console.anthropic.com)
→ API Keys, **na conta do próprio Gildemi**, com um limite de gasto mensal
configurado em Billing → Limits.

### 5. Ligar a landing e o painel no banco

Settings → API. Copie **Project URL** e a chave **anon public** e cole em
`_build/build.py`:

```python
'SUPABASE_URL':  'https://xxxx.supabase.co',
'SUPABASE_ANON': 'eyJhbGci...',
```

Depois:

```bash
python3 _build/build.py
```

### 6. Publicar

`index.html` e `painel.html` vão pro Netlify. O painel não é linkado de lugar
nenhum e leva `noindex` — mas **URL secreta não é segurança**: quem protege é o
login. Se quiser uma camada a mais, uma senha de site no Netlify resolve.

## O custo

**Supabase:** gratuito nesse volume.
**Netlify:** gratuito.
**Anthropic:** por uso, sem mensalidade. No volume real de um escritório solo
(algo como 40 triagens/mês), **fica perto de US$ 4/mês** no Opus 5 —
US$ 5 por milhão de tokens de entrada, US$ 25 de saída, e o prompt de sistema
fica em cache, o que corta a maior parte da entrada nas chamadas seguintes.

Dava pra usar Sonnet 5 (~US$ 1,50) ou Haiku 4.5 (~US$ 0,80). A diferença toda é
uns três dólares por mês — e ler errado um indeferimento do INSS custa mais que
um ano de API. Fica no Opus.

O painel mostra a data da última análise; o botão **"Analisar de novo"** existe
mas cada clique é uma chamada nova. Não é botão de brincar.

## Limites — diga isso pro Gildemi

- **A IA é apoio de triagem, não parecer.** Ela lê o que o leigo escreveu num
  formulário, que é incompleto por natureza. Serve pra priorizar a fila e não
  deixar passar prazo — a leitura jurídica continua sendo dele.
- **O rascunho de WhatsApp sai em nome do escritório.** O prompt carrega as
  restrições da OAB (sem prometer resultado, sem citar valor, sem consulta
  grátis como isca), mas **ele revisa antes de enviar**. A responsabilidade
  pelo que sai é do advogado, não do sistema.
- **O prazo depende da data do fim do contrato.** Enquanto ele não confirmar
  essa data no painel, o caso aparece em "Sem data de saída" e o relógio não
  conta. A faixa que a pessoa marcou no site ("entre 1 e 2 anos") só serve pra
  priorizar a fila.
- **Um usuário só.** O RLS de hoje é "quem está logado vê tudo". Serve pro
  escritório do jeito que ele é. Se entrar estagiário ou sócio e for preciso
  separar visibilidade, o RLS muda — mas isso é outra conversa.

## Pendências

- [ ] Criar o projeto Supabase e rodar o `setup.sql`
- [ ] Chave da Anthropic na conta do Gildemi + limite de gasto
- [ ] Publicar a Edge Function e testar uma triagem de ponta a ponta
- [ ] Preencher `SUPABASE_URL` / `SUPABASE_ANON` no `build.py` e rebuildar
- [ ] Desligar sign-ups no Supabase Auth

### Fases seguintes (conversadas, não começadas)

1. **Acompanhamento processual** pela API pública do DataJud/CNJ — puxa
   movimentação dos processos pelo número, sem custo de licença. É o que o
   Lawra cobra e dá pra fazer aqui.
2. **Leitor de documento** — subir a CTPS, o extrato do CNIS ou a carta de
   indeferimento e a IA extrair o que importa.
3. **Régua de aviso ao cliente** — a movimentação marcada com `avisar` vira
   mensagem pronta. "O cliente não sabe o que está acontecendo" é a reclamação
   número um de quem processa; resolver isso vale mais que qualquer automação.

## Notas de construção

- **Nunca use `1fr` puro em `grid-template-columns`** aqui. O mínimo de um track
  `1fr` é o min-content do filho, então uma tabela ou um gráfico largo empurra a
  coluna e a página inteira estoura no celular. Todo track é `minmax(0,1fr)` e
  os filhos de `.grade` levam `min-width:0`.
- **Título e legenda dentro de `<button>` precisam de `display:block`.** Como
  são `<span>`, sem isso o nome do cliente cola no rótulo — o que aconteceu duas
  vezes na primeira versão.
- **Mudar etapa é otimista:** o cartão pula de coluna antes da resposta do banco
  e volta sozinho se o PATCH falhar. Arrastar tem que responder na hora.
- **A faixa do painel prefere o prazo que ainda dá pra salvar.** Um caso já
  prescrito é grave mas não é ação; só sobe pra faixa se não houver crítico.

## Histórico

- **13/08/2026** — CRM montado: `setup.sql`, Edge Function `triagem`,
  `painel.html`, e o formulário da landing gravando no banco.
- **13/08/2026 (2ª rodada)** — painel refeito como aplicação depois das
  referências do Rodrigo: lateral fixa, dashboard com indicadores e gráficos,
  kanban com arrastar, tabela ordenável, agenda de prazos, tarefas (tabela nova
  no banco) e gaveta em abas. A primeira versão era uma lista com filtro — não
  parecia CRM.


## WhatsApp — a tela de conectar

A aba **WhatsApp** mostra **só o QR Code** quando não está pareado: o código, os
quatro passos e uma linha lembrando de usar o número do escritório. Nada mais.

A tela se vira sozinha quando o celular lê o código — o painel repergunta o
estado a cada 3 segundos enquanto não estiver conectado, e para de perguntar
assim que conecta.

Na demonstração (`painel-demo.html`) o pareamento é encenado: o QR fica na tela
esperando e "conecta" ~7 s depois de **abrir a aba** — não depois do login. Isso
é de propósito: se a contagem começasse no login, o código já teria sumido
quando o Rodrigo chegasse na aba durante a apresentação.

O QR da demonstração é um QR real, mas o conteúdo é um texto inofensivo. Se
alguém escanear na reunião, o celular só mostra a mensagem — não pareia nada.

## Tempo real

O painel abre um websocket com o Supabase e escuta as mudanças das tabelas
(`mensagens_wpp`, `conversas_wpp`, `contatos`, `wpp_sessao`, `casos`,
`publicacoes`, `tarefas`). Mensagem nova do WhatsApp, lead novo do site e
publicação nova do Diário aparecem sem ninguém apertar nada.

Detalhes que fazem diferença no uso:

- **Não rouba o foco.** Se ele estiver digitando, a tela não é repintada — o
  texto e o cursor ficam onde estavam.
- **Mensagem na conversa aberta entra direto**, sem reler o banco inteiro.
- **Eco de envio é removido**: a mensagem que aparece na hora do envio é
  substituída pela linha real quando ela chega, sem duplicar.
- **Toque e título piscando** quando chega mensagem e ele está em outra aba.
- **Plano B**: se o websocket não subir (firewall, canal sem autorização), o
  painel relê a cada 20 s — inclusive as mensagens da conversa aberta.

A vigia da tela de pareamento continua rodando mesmo com o websocket de pé,
de propósito: o canal pode conectar e não trazer nada (RLS mal configurado),
e sem ela o QR ficaria parado pra sempre.

⚠️ No Supabase é preciso **habilitar Realtime nas tabelas** (Database →
Replication → `supabase_realtime`). Sem isso o websocket conecta e não chega
evento nenhum — e o sistema cai no plano B sem avisar.
