# Instalação — CRM Escritório

## Caminho rápido

No **seu terminal** (não no Claude — o CLI exige um terminal de verdade):

```bash
npx supabase login          # abre o navegador, você autoriza
bash instalar.sh            # faz o resto
```

O `instalar.sh` cria o projeto, aplica as 16 tabelas e 4 views, publica as
6 funções, grava os segredos e já aponta a landing e o painel pro banco.
Ele pergunta o que precisa na hora e **não grava segredo nenhum em arquivo**.

No fim ele lista as 4 coisas que só dão pra fazer pelo painel do Supabase
(Realtime, usuário do o advogado, fechar cadastro e o cron).

O passo a passo manual abaixo continua valendo — use se algo der errado no
meio, ou se preferir ver cada etapa.

---

Passo a passo manual, se preferir ir devagar.

Quem faz o quê:
- **Você (Rodrigo)** — cria as contas e roda os comandos.
- **o advogado** — só escaneia o QR Code no fim e recebe a senha.

---

## 1. Criar o projeto no Supabase

Em [supabase.com](https://supabase.com) → **New project**.

| Campo | Valor |
|---|---|
| Name | `crm-advogado` |
| Database password | gere uma forte e **guarde no seu gerenciador de senhas** |
| Region | **South America (São Paulo)** |
| Plan | Free serve pra começar |

Leva uns 2 minutos pra provisionar.

Depois, em **Settings → API**, anote:
- **Project URL** → `https://xxxxx.supabase.co`
- **anon public** → chave longa. É pública por natureza; quem protege é o RLS.
- **service_role** → ⚠️ **essa é senha de administrador**. Ela ignora o RLS.
  Nunca no navegador, nunca no Netlify, nunca em conversa. Só na ponte.

## 2. Criar as tabelas

**SQL Editor → New query** → cole o conteúdo inteiro de `supabase/setup.sql` → **Run**.

Cria: `casos`, `movimentacoes`, `tarefas`, `publicacoes`, `documentos`,
`conversas`, `mensagens`, `contatos`, `conversas_wpp`, `mensagens_wpp`,
`wpp_fila`, `wpp_sessao`, `processos`, `processo_fontes`,
`processo_movimentos`, `processo_eventos`, `gmail_conta`, `gmail_mensagens`,
o bucket `documentos`, as políticas de RLS e as views `casos_com_prazo`,
`processos_oab`, `processos_observacao` e `wpp_caixa`.

`gmail_conta` guarda o refresh_token do Google e é a única tabela do
arquivo **sem** política de leitura pra `authenticated` — só a Edge
Function enxerga (ver seção 9 do `setup.sql`). Isso é de propósito, não
esqueça disso se um dia for revisar as policies.

`processos` é a carteira de verdade: todo processo achado pela OAB nasce
"em observação" e só vira carteira oficial quando confirmado no painel —
ver aba **Em Observação**. `processos_oab` continua existindo só como
compatibilidade (mostra os confirmados).

Confira em **Table Editor**: devem aparecer as tabelas com o cadeado de RLS.

## 3. Ligar o Realtime

**Database → Replication → `supabase_realtime` → Edit**, e marque:

`casos`, `tarefas`, `publicacoes`, `processos`, `contatos`, `conversas_wpp`,
`mensagens_wpp`, `wpp_sessao`, `gmail_mensagens`

⚠️ **Sem isso o painel não atualiza sozinho.** O websocket conecta, nenhum
evento chega, e o sistema cai no plano B (releitura a cada 20 s) sem reclamar.
É o erro mais chato de descobrir depois.

## 4. Criar o usuário do o advogado

**Authentication → Users → Add user**:
- E-mail: o que ele já usa
- Password: gere uma e mande pra ele por um canal seguro — **não por e-mail**
- ✅ **Auto Confirm User**

Depois, **Authentication → Providers → Email** e **desligue "Enable sign-ups"**.
Sem isso, qualquer pessoa que descobrir a URL cria conta e enxerga todos os casos.

## 5. Publicar as funções

Precisa do Docker rodando.

```bash
cd "Sites Clientes/Escritório"

npx supabase login                       # abre o navegador
npx supabase link --project-ref <ref>    # o ref está na URL do painel

npx supabase functions deploy triagem
npx supabase functions deploy advogado
npx supabase functions deploy cnj
npx supabase functions deploy processos
npx supabase functions deploy lembretes
npx supabase functions deploy agenda --no-verify-jwt
npx supabase functions deploy gmail
npx supabase functions deploy gmail-callback --no-verify-jwt
```

O `--no-verify-jwt` na `agenda` é obrigatório: app de calendário não manda
cabeçalho de autenticação, só busca a URL. Quem protege é o token no endereço.
Na `gmail-callback` é pelo mesmo motivo: é o próprio Google que chama essa
URL depois do login, sem cabeçalho nenhum do Supabase — quem protege ali é
o `state` assinado (ver seção 8).

## 6. Configurar os segredos

```bash
npx supabase secrets set GEMINI_API_KEY=AIza...
npx supabase secrets set CRON_SECRET=$(openssl rand -hex 24)
npx supabase secrets set AGENDA_TOKEN=$(openssl rand -hex 24)
npx supabase secrets set GOOGLE_CLIENT_ID=...
npx supabase secrets set GOOGLE_CLIENT_SECRET=...
npx supabase secrets set GOOGLE_STATE_SECRET=$(openssl rand -hex 24)
```

Os três `GOOGLE_*` são pra integração do Gmail — ver seção 8, é o único
passo que precisa do Google Cloud Console (fora do Supabase).

A chave do Gemini sai de **aistudio.google.com** → "Get API key" → "Create API
key". É gratuita (tier free, sem cartão) — dá folga de sobra pro uso de um
escritório pequeno.

Anote o `CRON_SECRET` gerado: você precisa dele no passo 7.

```bash
npx supabase secrets list        # confere sem mostrar os valores
```

## 7. Ligar as tarefas automáticas

**SQL Editor**, com o `CRON_SECRET` e o ref do projeto no lugar:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

Depois copie os três blocos comentados no fim do `supabase/setup.sql`,
trocando `<PROJETO>` e `<CRON_SECRET>`.

Horários (o pg_cron conta em UTC; São Paulo é UTC−3):
- **06:00 UTC** = 03:00 daqui → varre o Diário
- **10:00 UTC** = 07:00 daqui → aviso do dia, seg a sex
- **11:00 UTC** = 08:00 daqui → resumo da semana, segunda

Confira com `select * from cron.job;`

## 8. Apontar a landing e o painel pro banco

Em `_build/build.py`, preencha:

```python
'SUPABASE_URL':  'https://xxxxx.supabase.co',
'SUPABASE_ANON': 'eyJ...',
```

```bash
python3 _build/build.py
```

Gera `index.html`, `painel.html` e `painel-demo.html`.

**Teste antes de publicar**: abra o `index.html`, preencha o formulário e
confira em **Table Editor → casos** se a linha entrou.

## 9. Publicar

```bash
# a landing (só ela — o painel não vai pro ar público)
SP=$(mktemp -d) && cp index.html "$SP/" && \
printf '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' > "$SP/_headers" && \
netlify deploy --prod --dir "$SP" --site <ID-DO-SITE-NETLIFY>
```

O `painel.html` é um arquivo só: mande pro o advogado ou hospede num endereço
separado, **nunca no mesmo domínio da landing**.

⚠️ Quando apontar o domínio do escritório, **tire o `X-Robots-Tag: noindex`**
— senão o site fica invisível no Google.

## 10. Subir a ponte do WhatsApp

Veja `ponte-whatsapp/README.md`. Resumo:

```bash
cd ponte-whatsapp
railway init && railway up          # ou: fly launch --no-deploy && fly deploy

railway variables set SUPABASE_URL=https://xxxxx.supabase.co
railway variables set SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Monte um **volume em `/app/sessao`**. Sem isso ele pede QR a cada reinício.

Depois: painel → **WhatsApp** → o QR aparece → o advogado escaneia com o
**número novo do escritório**.

## 11. Ligar o Gmail

Diferente do WhatsApp, o Gmail tem API oficial do Google — o login acontece
na tela de verdade do Google, sem QR Code e sem risco de conectar o número
errado. O único trabalho manual é criar as credenciais no **Google Cloud
Console** (console.cloud.google.com):

1. Crie um projeto (ou use um existente).
2. **APIs e serviços → Biblioteca** → ative a **Gmail API**.
3. **APIs e serviços → Tela de consentimento OAuth**:
   - Tipo: **Externo**
   - Nome do app, e-mail de suporte — qualquer coisa reconhecível
   - Em **Usuários de teste**, adicione o e-mail do advogado
   - Escopos: não precisa adicionar aqui, a function já pede
     `gmail.readonly` e `gmail.send` na hora do login
4. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**:
   - Tipo de aplicativo: **Aplicativo da Web**
   - **URIs de redirecionamento autorizados**, cole exatamente:
     `https://<PROJETO>.supabase.co/functions/v1/gmail-callback`
   - Copie o **Client ID** e o **Client Secret** gerados

Depois é só rodar os três `secrets set` da seção 6 com esses valores (mais
o `GOOGLE_STATE_SECRET`, que é só um segredo aleatório seu, não vem do
Google) e os dois deploys da seção 5 (`gmail` e `gmail-callback`).

Aplique também a seção 9 do `supabase/setup.sql` (tabelas `gmail_conta` e
`gmail_mensagens`) e, se quiser sincronização automática, descomente o
bloco `gmail-sincroniza` no fim do mesmo arquivo (mesmo padrão dos outros
três horários da seção 6).

⚠️ **Enquanto a tela de consentimento estiver em "Teste"** (o normal pra
começar, já que é uma conta Gmail comum, não um domínio Google Workspace),
**o Google expira a conexão sozinho a cada 7 dias** — o advogado só
precisa clicar em "Conectar Gmail" de novo, é rápido. Pra isso sumir de
vez, publique a tela de consentimento pra revisão do Google mais adiante
(pede uma página de política de privacidade pública).

---

## Ordem de conferência

- [ ] Formulário do site cria linha em `casos`
- [ ] Login no painel funciona
- [ ] "Analisar com IA" devolve a triagem
- [ ] "Atualizar do Diário" traz as publicações da OAB
- [ ] "Assinar no celular" gera o endereço e o iPhone assina
- [ ] Aviso do WhatsApp: `{"tipo":"diario","previa":true}` devolve o texto
- [ ] QR aparece e pareia
- [ ] Mensagem nova aparece **sozinha** na tela (Realtime ligado)
- [ ] "Conectar Gmail" abre o login do Google e volta conectado
- [ ] O histórico de e-mail começa a aparecer na aba Gmail
- [ ] Responder um e-mail pelo painel chega de verdade (confere na pasta Enviados do Gmail)

## O que continua pendente e não depende de código

- **Monument Extended** — licença de webfont antes de publicar em domínio próprio
- **Noka** — hoje está Outfit no lugar
- **WhatsApp Business API (Meta)** — só pros lembretes automáticos; leva dias
  de verificação e aprovação de template
- **Prova social** — pedir avaliações no Google
