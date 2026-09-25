#!/usr/bin/env python3
"""Acha o ref do projeto pelo nome, pra nao pedir pra ninguem colar."""
import json, sys
nome = sys.argv[1] if len(sys.argv) > 1 else 'crm-advogado'
try:    projetos = json.load(sys.stdin)
except Exception: projetos = []
achado = [p for p in projetos if p.get('name') == nome]
print(achado[0]['id'] if achado else '', end='')
