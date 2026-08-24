#!/usr/bin/env python3
"""Extrai a chave anon da saida de `supabase projects api-keys`."""
import json, sys
try:    chaves = json.load(sys.stdin)
except Exception: chaves = []
for k in chaves:
    if k.get('name') == 'anon':
        print(k.get('api_key', ''), end=''); raise SystemExit
print('', end='')
