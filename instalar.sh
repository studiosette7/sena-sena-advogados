#!/usr/bin/env bash
# ============================================================
# Instalação do CRM Escritório.
#
# Normalmente você não roda isto direto: abra o INSTALAR.command
# com dois cliques, que ele cuida do login antes de chamar este aqui.
#
# O que faz:
#   1. confere o login
#   2. cria (ou escolhe) o projeto no Supabase
#   3. aplica o schema inteiro
#   4. publica as 5 funções e grava os segredos
#   5. aponta a landing e o painel pro banco e reconstrói
#
# Nenhum segredo fica gravado em arquivo — só no cofre do Supabase.
# ============================================================
set -uo pipefail

RAIZ="$(cd "$(dirname "$0")" && pwd)"
cd "$RAIZ"

azul(){ printf '\033[1;34m%s\033[0m\n' "$*"; }
ok(){   printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
erro(){ printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; }

SB="npx --yes supabase"

# ---------- 1) login ----------
azul "1/5  Conferindo o login…"
if ! $SB projects list >/dev/null 2>&1; then
  erro "Não está conectado ao Supabase."
  echo "   Feche isto e abra o arquivo INSTALAR.command com dois cliques."
  exit 1
fi
ok "conectado"

# ---------- 2) projeto ----------
azul "2/5  Projeto no Supabase"

REF=$($SB projects list --output json 2>/dev/null | python3 _setup/escolhe_projeto.py)

if [ -z "$REF" ]; then
  azul "   Criando um projeto novo"

  ORG=$($SB orgs list --output json 2>/dev/null | python3 _setup/escolhe_org.py)
  if [ -z "$ORG" ]; then erro "não consegui ver sua organização no Supabase"; exit 1; fi

  # senha gerada aqui: ninguém precisa inventar uma
  DBPASS=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)

  echo
  echo "   Nome: crm-advogado     Região: São Paulo"
  azul "   criando… leva uns 2 minutos, pode esperar"
  if ! $SB projects create "crm-advogado" \
        --org-id "$ORG" --region sa-east-1 --db-password "$DBPASS"; then
    erro "não deu pra criar o projeto"; exit 1
  fi

  # descobre o ref sozinho, sem pedir pra ninguém colar
  for _ in $(seq 1 30); do
    REF=$($SB projects list --output json 2>/dev/null | python3 _setup/acha_ref.py crm-advogado)
    [ -n "$REF" ] && break
    sleep 4
  done

  echo
  printf '\033[1;33m'
  echo "   ┌──────────────────────────────────────────────────────┐"
  echo "   │  GUARDE A SENHA DO BANCO — ela não aparece de novo   │"
  echo "   └──────────────────────────────────────────────────────┘"
  echo "        $DBPASS"
  printf '\033[0m'
  echo
  read -rp "   Já guardou? Aperte ENTER pra continuar… "
fi

if [ -z "$REF" ]; then erro "não consegui identificar o projeto"; exit 1; fi

azul "   ligando a pasta ao projeto…"
if ! $SB link --project-ref "$REF"; then erro "não deu pra ligar"; exit 1; fi
ok "ligado ao projeto $REF"

# ---------- 3) schema ----------
azul "3/5  Aplicando o banco (16 tabelas, 4 views, RLS, arquivos)…"
if ! $SB db push --include-all; then
  erro "o banco não foi aplicado — pare aqui e mande a mensagem acima pro Rodrigo"
  exit 1
fi
ok "banco pronto"

# ---------- 4) funções e segredos ----------
azul "4/5  Publicando as funções…"
for f in triagem advogado cnj processos lembretes gmail; do
  echo "   → $f"
  $SB functions deploy "$f" --project-ref "$REF" >/dev/null || erro "falhou: $f"
done
# agenda e gmail-callback são chamadas por quem não manda cabeçalho de
# login do Supabase (app de calendário / redirect do Google) — quem
# protege essas duas é o token/state na própria chamada, não o JWT.
for f in agenda gmail-callback; do
  echo "   → $f"
  $SB functions deploy "$f" --no-verify-jwt --project-ref "$REF" >/dev/null || erro "falhou: $f"
done
ok "funções no ar"

echo
azul "     Chave da inteligência artificial"
echo "     Pegue em: aistudio.google.com → Get API key → Create API key"
echo "     (gratuita, sem cartão — respeite os limites do tier free do Gemini)"
echo "     Ao colar, a tela não mostra nada. É normal."
echo
read -rsp "     Cole a chave e aperte ENTER: " GEMKEY; echo

echo
azul "     Integração com o Gmail (opcional — pode deixar em branco e configurar depois)"
echo "     Client ID/Secret saem do Google Cloud Console — veja o passo 11 do INSTALACAO.md"
echo
read -rp  "     Client ID: "     GOOGID
read -rsp "     Client Secret: " GOOGSECRET; echo

CRON=$(openssl rand -hex 24)
AGEN=$(openssl rand -hex 24)
GOOGSTATE=$(openssl rand -hex 24)
$SB secrets set "GEMINI_API_KEY=$GEMKEY"    --project-ref "$REF" >/dev/null
$SB secrets set "CRON_SECRET=$CRON"         --project-ref "$REF" >/dev/null
$SB secrets set "AGENDA_TOKEN=$AGEN"        --project-ref "$REF" >/dev/null
$SB secrets set "GOOGLE_STATE_SECRET=$GOOGSTATE" --project-ref "$REF" >/dev/null
if [ -n "$GOOGID" ]; then
  $SB secrets set "GOOGLE_CLIENT_ID=$GOOGID"         --project-ref "$REF" >/dev/null
  $SB secrets set "GOOGLE_CLIENT_SECRET=$GOOGSECRET" --project-ref "$REF" >/dev/null
fi
unset GEMKEY GOOGSECRET
ok "segredos guardados no cofre do Supabase"

# ---------- 5) apontar o site pro banco ----------
azul "5/5  Apontando a landing e o painel pro banco…"
URL="https://${REF}.supabase.co"
ANON=$($SB projects api-keys --project-ref "$REF" --output json 2>/dev/null | python3 _setup/pega_anon.py)

if [ -z "$ANON" ]; then erro "não consegui ler a chave pública do projeto"; exit 1; fi

python3 _setup/aponta_build.py "$URL" "$ANON" || exit 1
python3 _build/build.py || exit 1
ok "index.html, painel.html e painel-demo.html reconstruídos"

GMAIL_PENDENTE=""
if [ -z "$GOOGID" ]; then
  GMAIL_PENDENTE="
  5. Gmail (pulado agora — Client ID/Secret em branco)
     Siga o passo 11 do INSTALACAO.md no Google Cloud Console e depois:
        npx supabase secrets set GOOGLE_CLIENT_ID=...     --project-ref $REF
        npx supabase secrets set GOOGLE_CLIENT_SECRET=... --project-ref $REF
"
fi

echo
azul "═════════ FALTA FAZER NO SITE DO SUPABASE ═════════"
cat <<FIM

  Entre em supabase.com, abra o projeto crm-advogado e:

  1. Database → Replication → supabase_realtime
     Marque: casos, tarefas, publicacoes, contatos,
             conversas_wpp, mensagens_wpp, wpp_sessao, gmail_mensagens
     SEM ISSO O PAINEL NÃO ATUALIZA SOZINHO.

  2. Authentication → Users → Add user
     E-mail do o advogado, uma senha, e marque "Auto Confirm User"

  3. Authentication → Providers → Email
     DESLIGUE "Enable sign-ups"
     (senão qualquer um cria conta e vê todos os casos)

  4. SQL Editor
     Cole os 3 blocos do fim de supabase/setup.sql, trocando
        <PROJETO>      por  $REF
        <CRON_SECRET>  por  $CRON
     (o bloco gmail-sincroniza, na seção 9, é opcional)
$GMAIL_PENDENTE
  GUARDE ISTO — é a senha do calendário do celular:
        $AGEN

FIM
azul "Depois disso, me chame que eu publico o site."
