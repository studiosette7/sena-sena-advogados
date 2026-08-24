#!/usr/bin/env python3
"""Escreve a URL e a chave anon dentro do build.py.

Cuidado que ja custou caro uma vez: o build.py tem DOIS pares dessas
chaves — o do site de verdade e o da demonstracao, que aponta pra um
endereco falso de proposito. Trocar os dois faria a demonstracao mexer
no banco de cliente. Por isso a troca acontece so dentro do bloco DADOS.
"""
import re, sys

url, anon = sys.argv[1], sys.argv[2]
p = '_build/build.py'
s = open(p, encoding='utf-8').read()

ini = s.index('DADOS = {')
fim = s.index('}', ini) + 1
bloco = s[ini:fim]

novo = re.sub(r"('SUPABASE_URL':\s*)'[^']*'",  lambda m: m.group(1) + "'%s'" % url,  bloco)
novo = re.sub(r"('SUPABASE_ANON':\s*)'[^']*'", lambda m: m.group(1) + "'%s'" % anon, novo)

if novo == bloco:
    sys.exit('ERRO: nao achei SUPABASE_URL/ANON dentro do bloco DADOS do build.py')

open(p, 'w', encoding='utf-8').write(s[:ini] + novo + s[fim:])
print('build.py apontado para %s (demonstracao intacta)' % url)
