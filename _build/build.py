#!/usr/bin/env python3
"""Injeta imagens, fontes e dados de contato no template, gerando o index.html final."""
import base64, os, re, sys
from PIL import Image

RAIZ   = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD  = os.path.join(RAIZ, '_build')
FONTES = os.path.join(BUILD, 'fontes')
FOTOS  = os.path.join(RAIZ, '_material', 'fotos')
MARCA  = os.path.join(RAIZ, '_material', 'marca')
REF    = os.path.join(RAIZ, '_material', 'referencia')
# As capas moram DENTRO do projeto, nao na pasta de referencia.
# Motivo: a pasta de referencia fica no Desktop sincronizado com o iCloud,
# que despeja o arquivo do disco quando falta espaco — vira um marcador de
# 0 byte e o build quebra na hora de ler a imagem. Copia local nao some.
CAPAS  = os.path.join(RAIZ, '_material', 'capas')

# --- dados do cliente -----------------------------------------------------
DADOS = {
    'ADV':     'Gildemi Sena',
    'OAB':     'OAB/SP 417.105',
    'WPP':     '5511966617309',
    'WPP_FMT': '(11) 96661-7309',
    'END':     'R. Rio Branco, 133 — Centro, São Bernardo do Campo/SP',
    'CEP':     '09710-090',
    'INSTA':   'sena.sena.adv',
    'MAPA_Q':  'Rua+Rio+Branco+133+Centro+Sao+Bernardo+do+Campo+SP',

    # --- Supabase -------------------------------------------------------
    # Preencher depois de criar o projeto (Settings > API). A chave anon e
    # publica por natureza: quem protege o banco e o RLS do setup.sql.
    # Enquanto estiver vazio, a landing grava em localStorage e nada se perde.
    'SUPABASE_URL':  'https://dbugecyjjcfbmqeejupd.supabase.co',
    'SUPABASE_ANON': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRidWdlY3lqamNmYm1xZWVqdXBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNjYxMzUsImV4cCI6MjEwMjg0MjEzNX0.zuq4yQW-pvjoIGVXg3DcHjqxOGVN3vLmZAPeaaXNngU',
}

# Geometria dos botoes dourados dentro das artes de capa, medida pixel a pixel
# (deteccao de pixel dourado, nao no olho). A arte entra como <img width:100%>,
# entao a posicao e percentual puro — nao precisa de JS pra reancorar no resize.
#
# Desktop: os dois botoes lado a lado.  Mobile: um embaixo do outro.
BOTOES = {
    # HOME DESKTOP.png  (2560x1362)
    'BT_TOP':    '70.88',
    'BT_ALT':    '11.76',
    'BT1_LEFT':  '45.78',
    'BT1_LARG':  '22.66',
    'BT2_LEFT':  '72.50',
    'BT2_LARG':  '22.66',
    # HOME MOBILE.png  (1362x2560)
    'MB_LEFT':   '28.82',
    'MB_LARG':   '42.65',
    'MB1_TOP':   '76.72',
    'MB1_ALT':   '6.09',
    'MB2_TOP':   '84.22',
    'MB2_ALT':   '6.25',
}


def confere(caminho):
    """Se o arquivo virou marcador do iCloud (0 byte em disco), o Pillow
    estoura com uma mensagem que nao ajuda ninguem. Melhor avisar direito."""
    if not os.path.exists(caminho):
        sys.exit('ERRO: arquivo nao encontrado:\n  %s' % caminho)
    if os.path.getsize(caminho) == 0 or os.stat(caminho).st_blocks == 0:
        sys.exit(
            'ERRO: o arquivo esta no iCloud e nao no disco:\n  %s\n\n'
            'Rode isto e tente de novo:\n'
            '  brctl download "%s"' % (caminho, caminho))


def jpg(caminho, w, q, crop=None):
    """crop = (esq, topo, dir, base) em fracao de 0 a 1."""
    confere(caminho)
    im = Image.open(caminho).convert('RGB')
    if crop:
        W, H = im.size
        im = im.crop((int(W*crop[0]), int(H*crop[1]), int(W*crop[2]), int(H*crop[3])))
    im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    tmp = os.path.join(BUILD, '_tmp.jpg')
    im.save(tmp, 'JPEG', quality=q, optimize=True, progressive=True)
    with open(tmp, 'rb') as f:
        b = f.read()
    os.remove(tmp)
    return 'data:image/jpeg;base64,' + base64.b64encode(b).decode(), len(b)


def png_logo(caminho, w):
    confere(caminho)
    """A logo original e dourada sobre fundo marinho em degrade. Recortada como
    retangulo vira um remendo em cima de qualquer fundo. Aqui a luminancia vira
    canal alfa: o dourado fica opaco, o marinho some."""
    im = Image.open(caminho).convert('RGB')
    W, H = im.size
    im = im.crop((int(W*.06), int(H*.32), int(W*.96), int(H*.70)))
    im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    lum = im.convert('L')
    P0, P1 = 56, 128
    alfa = lum.point(lambda v: 0 if v <= P0 else (255 if v >= P1 else
                                                 int((v - P0) * 255 / (P1 - P0))))
    arte = Image.composite(im, Image.new('RGB', im.size, (201, 165, 92)), alfa).convert('RGBA')
    arte.putalpha(alfa)
    tmp = os.path.join(BUILD, '_tmp.png')
    arte.save(tmp, 'PNG', optimize=True)
    with open(tmp, 'rb') as f:
        b = f.read()
    os.remove(tmp)
    return 'data:image/png;base64,' + base64.b64encode(b).decode(), len(b)


def png_recorte(caminho, w, crop):
    confere(caminho)
    """Recorta o advogado da arte 1.png mantendo o fundo marinho dela."""
    im = Image.open(caminho).convert('RGB')
    W, H = im.size
    im = im.crop((int(W*crop[0]), int(H*crop[1]), int(W*crop[2]), int(H*crop[3])))
    im = im.resize((w, int(im.height * w / im.width)), Image.LANCZOS)
    tmp = os.path.join(BUILD, '_tmp.jpg')
    im.save(tmp, 'JPEG', quality=86, optimize=True, progressive=True)
    with open(tmp, 'rb') as f:
        b = f.read()
    os.remove(tmp)
    # devolve tambem as dimensoes: chutar o height no HTML deforma a imagem
    return 'data:image/jpeg;base64,' + base64.b64encode(b).decode(), len(b), im.size


def fonte(nome):
    caminho = os.path.join(FONTES, nome + '.woff2')
    with open(caminho, 'rb') as f:
        b = f.read()
    return 'data:font/woff2;base64,' + base64.b64encode(b).decode(), len(b)


ASSETS = {
    # capas do hero, exatamente como o Rodrigo entregou
    'HOME':    jpg(os.path.join(CAPAS, 'home-desktop.png'), 1920, 84),
    # a de celular e retrato (0.53:1): entra inteira, com os botoes por cima
    'HOME_M':  jpg(os.path.join(CAPAS, 'home-mobile.png'), 900, 82),
    # O cartao vertical do "sobre" no celular. Recorte medido: a moldura preta
    # vai ate 0.080/0.919 na horizontal; comeca abaixo da logo da propria arte
    # (medida: a logo da arte acaba em 0.1434; a logo ja esta no bloco de
    # texto, duas seria remendo) e termina onde a foto se dissolve no fundo —
    # o resto da arte era um vazio marinho enorme.
    'ELE_M':   jpg(os.path.join(CAPAS, 'sobre-mobile.png'), 760, 84,
                   (.082, .152, .918, .625)),
    # texturas de fundo pro celular
    'FUNDO_M':  jpg(os.path.join(CAPAS, 'fundo-mobile.png'), 760, 76),
    'FUNDO_M2': jpg(os.path.join(CAPAS, 'fundo-mobile-2.png'), 760, 76),
    # o advogado recortado da arte 1.png, ja no fundo marinho dela
    # bordas do cartao marinho da arte 1.png, medidas pixel a pixel — comecar
    # antes delas trazia junto a moldura preta de fora
    'ELE':     png_recorte(os.path.join(REF, '1.png'), 620, (.0309, .0808, .3400, .9185))[:2],
    # fundo marinho com o monograma, pra dar textura nas secoes
    'FUNDO':   jpg(os.path.join(REF, '2.png'), 1400, 80),
    'LOGO':    png_logo(os.path.join(MARCA, 'logo-sena-sena.png'), 520),
}

# dimensoes reais do recorte, pros atributos width/height do <img>
_ele = png_recorte(os.path.join(REF, '1.png'), 620, (.0309, .0808, .3400, .9185))[2]
MEDIDAS = {'ELE_W': str(_ele[0]), 'ELE_H': str(_ele[1])}
print(f'  (recorte ELE: {_ele[0]}x{_ele[1]} px)')

FONTES_EMB = {
    'FT_REG':  fonte('MonumentExtended-Regular'),
    'FT_BOLD': fonte('MonumentExtended-Ultrabold'),
}

print('Assets:')
total = 0
for k, (_, n) in list(ASSETS.items()) + list(FONTES_EMB.items()):
    total += n
    print(f'  {k:9s} {n/1024:8.1f} KB')
print(f'  {"TOTAL":9s} {total/1024:8.1f} KB')

TROCAS = {k: v[0] for k, v in list(ASSETS.items()) + list(FONTES_EMB.items())}
TROCAS.update(DADOS)
TROCAS.update(BOTOES)
TROCAS.update(MEDIDAS)

def renderiza(nome_tpl, nome_saida, extra=None):
    with open(os.path.join(BUILD, nome_tpl), encoding='utf-8') as f:
        html = f.read()
    trocas = dict(TROCAS, **(extra or {}))
    for k, v in trocas.items():
        html = html.replace('{{%s}}' % k, v)
    if '{{' in html:
        faltando = set(re.findall(r'{{(\w+)}}', html))
        sys.exit('ERRO em %s: placeholder nao substituido: %s' % (nome_tpl, faltando))
    dest = os.path.join(RAIZ, nome_saida)
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f'✓ {nome_saida:17s} {os.path.getsize(dest)/1024:8.1f} KB')


# O painel-demo e o MESMO painel: so troca o fetch por um banco simulado, pra
# poder apresentar antes de existir projeto no Supabase. Nada sai da maquina.
with open(os.path.join(BUILD, 'demo.js'), encoding='utf-8') as f:
    DEMO_JS = '<script>\n%s\n</script>' % f.read()

print()
renderiza('index.tpl.html',  'index.html',  {'DEMO': ''})   # a landing, publica
renderiza('painel.tpl.html', 'painel.html', {'DEMO': ''})   # o CRM, so pro Gildemi
# A demonstracao NUNCA pode apontar pro banco de verdade: se apontasse, um
# clique numa apresentacao mexeria em caso de cliente. O endereco falso e o
# que faz o dublê do fetch entrar no lugar da rede.
renderiza('painel.tpl.html', 'painel-demo.html', {
    'DEMO': DEMO_JS,
    'SUPABASE_URL':  'https://demo.local',
    'SUPABASE_ANON': 'demonstracao',
})
