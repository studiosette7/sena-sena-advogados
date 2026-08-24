#!/usr/bin/env python3
"""Mostra os projetos do Supabase num menu numerado e devolve o ref
escolhido na saida padrao. As perguntas vao pro stderr pra nao sujar
o valor que o shell vai capturar."""
import json, sys

def pergunta(txt):
    sys.stderr.write(txt); sys.stderr.flush()
    try:    return sys.stdin.readline().strip()
    except Exception: return ''

try:    projetos = json.load(sys.stdin)
except Exception: projetos = []

projetos = [p for p in projetos if p.get('id')]

if not projetos:
    print('', end=''); raise SystemExit

sys.stderr.write('\n   Projetos que já existem na sua conta:\n')
for i, p in enumerate(projetos, 1):
    sys.stderr.write('     %d) %s   (%s)\n' % (i, p.get('name', 'sem nome'), p.get('region', '')))
sys.stderr.write('     0) Criar um projeto novo\n\n')

e = pergunta('   Digite o número e aperte ENTER: ')
print(projetos[int(e)-1]['id'] if e.isdigit() and 1 <= int(e) <= len(projetos) else '', end='')
