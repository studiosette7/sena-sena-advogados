#!/usr/bin/env bash
# Confere se as travas do banco estao no lugar. Roda quantas vezes quiser.
cd "$(cd "$(dirname "$0")/.." && pwd)"
URL=$(grep -o "https://[a-z0-9]*\.supabase\.co" _build/build.py | head -1)
ANON=$(grep "'SUPABASE_ANON'" _build/build.py | head -1 | sed "s/.*': *'\([^']*\)'.*/\1/")
[ -n "$URL" ] || { echo "build.py ainda nao aponta pra um projeto"; exit 1; }

verde(){ printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
verm(){  printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
falhou=0

echo "Conferindo $URL"; echo

t=$(curl -s "$URL/rest/v1/casos?select=id&limit=1" -H "apikey: $ANON")
[ "$t" = "[]" ] && verde "sem login nao le caso nenhum" || { verm "LEU DADO SEM LOGIN: $t"; falhou=1; }

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/rest/v1/casos" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"nome":"CONFERENCIA","whatsapp":"11900000000","area":"Trabalhista","etapa":"triagem"}')
[ "$c" = "201" ] && verde "o formulario do site consegue criar caso" || { verm "o formulario NAO cria caso (HTTP $c)"; falhou=1; }

c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/rest/v1/casos" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" \
  -d '{"nome":"BURLA","whatsapp":"11900000000","area":"Trabalhista","etapa":"contrato"}')
[ "$c" = "401" ] && verde "nao da pra forjar etapa pelo formulario" || { verm "FORJOU ETAPA (HTTP $c)"; falhou=1; }

d=$(curl -s -X DELETE "$URL/rest/v1/casos?nome=eq.CONFERENCIA" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H "Prefer: return=representation")
[ "$d" = "[]" ] && verde "sem login nao apaga caso" || { verm "APAGOU CASO: $d"; falhou=1; }

for f in cnj triagem advogado lembretes; do
  c=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/functions/v1/$f" \
    -H "apikey: $ANON" -H "Content-Type: application/json" -d '{}')
  [ "$c" = "401" ] && verde "funcao $f exige login" || { verm "funcao $f respondeu $c sem login"; falhou=1; }
done

echo
[ $falhou -eq 0 ] && printf '\033[1;32mTudo trancado.\033[0m\n' \
                  || printf '\033[1;31mTem furo — nao publique assim.\033[0m\n'
echo "(as linhas CONFERENCIA/TESTE ficam no banco; apague pelo Table Editor)"
exit $falhou
