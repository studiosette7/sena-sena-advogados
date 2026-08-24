#!/usr/bin/env bash
# ============================================================
# ABRA ESTE ARQUIVO COM DOIS CLIQUES.
# Ele abre uma janela preta (o Terminal) e conduz a instalação.
# Você não precisa digitar comando nenhum — só responder o que ele
# perguntar e clicar "Authorize" no navegador quando ele abrir.
# ============================================================

cd "$(dirname "$0")"

clear
printf '\033[1;34m'
cat <<'ARTE'

   ╔══════════════════════════════════════════════════╗
   ║   SENA & SENA — instalação do CRM                ║
   ╚══════════════════════════════════════════════════╝

ARTE
printf '\033[0m'

echo "Isso leva uns 10 minutos. Pode acompanhar sem fazer nada"
echo "até ele te perguntar alguma coisa."
echo
read -rp "Aperte ENTER para começar… "
echo

# ---------- confere o Node ----------
if ! command -v npx >/dev/null 2>&1; then
  printf '\033[1;31m'
  echo "✗ Falta o Node.js nesta máquina."
  printf '\033[0m'
  echo "  Baixe em https://nodejs.org (versão LTS), instale e abra este arquivo de novo."
  echo
  read -rp "Aperte ENTER para fechar. "
  exit 1
fi

# ---------- login ----------
if npx --yes supabase projects list >/dev/null 2>&1; then
  printf '\033[1;32m✓ Você já está conectado ao Supabase.\033[0m\n\n'
else
  printf '\033[1;34m▸ PASSO 1 — conectar na sua conta do Supabase\033[0m\n'
  echo
  echo "  Vai abrir uma página no navegador."
  echo "  Clique no botão verde \"Authorize\" e volte pra cá."
  echo
  read -rp "Aperte ENTER para abrir o navegador… "
  echo
  if ! npx --yes supabase login; then
    printf '\033[1;31m✗ O login não completou.\033[0m\n'
    echo "  Abra este arquivo de novo e tente mais uma vez."
    echo
    read -rp "Aperte ENTER para fechar. "
    exit 1
  fi
  printf '\n\033[1;32m✓ Conectado.\033[0m\n\n'
fi

# ---------- o resto ----------
printf '\033[1;34m▸ PASSO 2 — criar o banco e publicar tudo\033[0m\n\n'
bash instalar.sh
CODIGO=$?

echo
if [ $CODIGO -eq 0 ]; then
  printf '\033[1;32m'
  echo "══════════════════════════════════════════════════"
  echo "  Terminou. Manda um print desta tela pro Rodrigo."
  echo "══════════════════════════════════════════════════"
  printf '\033[0m'
else
  printf '\033[1;31m'
  echo "══════════════════════════════════════════════════"
  echo "  Parou no meio. Tire um print DESTA TELA INTEIRA"
  echo "  e mande — dá pra ver exatamente onde travou."
  echo "══════════════════════════════════════════════════"
  printf '\033[0m'
fi
echo
read -rp "Aperte ENTER para fechar esta janela. "
