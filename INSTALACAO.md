# Instalação — CRM Sena & Sena

## Caminho rápido

No **seu terminal** (não no Claude — o CLI exige um terminal de verdade):

```bash
npx supabase login          # abre o navegador, você autoriza
bash instalar.sh            # faz o resto
```

O `instalar.sh` cria o projeto, aplica as 12 tabelas e 3 views, publica as
5 funções, grava os segredos e já aponta a landing e o painel pro banco.
Ele pergunta o que precisa na hora e **não grava segredo nenhum em arquivo**.

No fim ele lista as 4 coisas que só dão pra fazer pelo painel do Supabase
(Realtime, usuário do Gildemi, fechar cadastro e o cron).

O passo a passo manual abaixo continua valendo — use se algo der errado no
meio, ou se preferir ver cada etapa.

---

Passo a passo manual, se preferir ir devagar.

Quem faz o quê:
- **Você (Rodrigo)** — cria as contas e roda os comandos.
- **Gildemi** — só escaneia o QR Code no fim e recebe a senha.

---

## 1. Criar o projeto no Supabase

Em [supabase.com](https://supabase.com) → **New project**.

| Campo | Valor |
|---|---|
| Name | `sena-sena-crm` |
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
`wpp_fila`, `wpp_sessao`, o bucket `documentos`, as políticas de RLS e as
views `casos_com_prazo`, `processos_oab` e `wpp_caixa`.

Confira em **Table Editor**: devem aparecer as tabelas com o cadeado de RLS.

## 3. Ligar o Realtime

**Database → Replication → `supabase_realtime` → Edit**, e marque:

`casos`, `tarefas`, `publicacoes`, `contatos`, `conversas_wpp`,
`mensagens_wpp`, `wpp_sessao`

⚠️ **Sem isso o painel não atualiza sozinho.** O websocket conecta, nenhum
evento chega, e o sistema cai no plano B (releitura a cada 20 s) sem reclamar.
É o erro mais chato de descobrir depois.

## 4. Criar o usuário do Gildemi

**Authentication → Users → Add user**:
- E-mail: o que ele já usa
- Password: gere uma e mande pra ele por um canal seguro — **não por e-mail**
- ✅ **Auto Confirm User**

Depois, **Authentication → Providers → Email** e **desligue "Enable sign-ups"**.
Sem isso, qualquer pessoa que descobrir a URL cria conta e enxerga todos os casos.

## 5. Publicar as funções

Precisa do Docker rodando.

```bash
cd "Sites Clientes/Sena & Sena Advogados"

npx supabase login                       # abre o navegador
npx supabase link --project-ref <ref>    # o ref está na URL do painel

npx supabase functions deploy triagem
npx supabase functions deploy advogado
npx supabase functions deploy cnj
npx supabase functions deploy lembretes
npx supabase functions deploy agenda --no-verify-jwt
```

O `--no-verify-jwt` na `agenda` é obrigatório: app de calendário não manda
cabeçalho de autenticação, só busca a URL. Quem protege é o token no endereço.

## 6. Configurar os segredos

```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase secrets set CRON_SECRET=$(openssl rand -hex 24)
npx supabase secrets set AGENDA_TOKEN=$(openssl rand -hex 24)
```

A chave da Anthropic sai da conta **do Gildemi** (console.anthropic.com →
API Keys). É ele quem paga o uso — algo entre US$ 15 e 25/mês com uso pesado.

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
netlify deploy --prod --dir "$SP" --site a3f8d298-623a-4437-aca4-d01895238260
```

O `painel.html` é um arquivo só: mande pro Gildemi ou hospede num endereço
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

Depois: painel → **WhatsApp** → o QR aparece → Gildemi escaneia com o
**número novo do escritório**.

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

## O que continua pendente e não depende de código

- **Monument Extended** — licença de webfont antes de publicar em domínio próprio
- **Noka** — hoje está Outfit no lugar
- **WhatsApp Business API (Meta)** — só pros lembretes automáticos; leva dias
  de verificação e aprovação de template
- **Prova social** — pedir avaliações no Google
