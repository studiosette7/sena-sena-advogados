#!/usr/bin/env python3
"""Devolve o id da organizacao. Se so houver uma, nem pergunta."""
import json, sys

try:    orgs = json.load(sys.stdin)
except Exception: orgs = []

if not orgs:
    print('', end=''); raise SystemExit
if len(orgs) == 1:
    print(orgs[0]['id'], end=''); raise SystemExit

sys.stderr.write('\n   Em qual conta criar?\n')
for i, o in enumerate(orgs, 1):
    sys.stderr.write('     %d) %s\n' % (i, o.get('name', '')))
sys.stderr.write('\n   Número: '); sys.stderr.flush()
try:    e = sys.stdin.readline().strip()
except Exception: e = '1'
print(orgs[int(e)-1]['id'] if e.isdigit() and 1 <= int(e) <= len(orgs) else orgs[0]['id'], end='')
