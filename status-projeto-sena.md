# Landing page — Sena & Sena Advogados

## Sobre o cliente

- **Escritório:** Sena & Sena Advogados
- **Advogado:** **Gildemi Sena** — OAB/SP 417.105
- **Instagram:** [@sena.sena.adv](https://instagram.com/sena.sena.adv)
- **WhatsApp:** (11) 95106-3158 → `https://wa.me/5511951063158`
- **Escritório:** R. Rio Branco, 133 — Centro, São Bernardo do Campo/SP · CEP 09710-090
- **Atuação:** ABC Paulista presencial + online para todo o Brasil
- **Status:** cliente fechado. Entrega é pra apresentar direto pra ele.

## Arquivos

```
index.html          ← a entrega (~675 KB, arquivo único)
painel.html         ← o CRM (ver status-crm-sena.md)
_build/
  build.py          ← injeta imagens, fontes e dados de contato; gera os dois
  index.tpl.html    ← o template da landing, com {{PLACEHOLDERS}}
  painel.tpl.html   ← o template do painel
  fontes/           ← Monument Extended convertida em woff2
_material/
  fotos/            ← ensaio (foto1–foto12) + HOME.png
  marca/            ← logo-sena-sena.png, FUNDO.png
  referencia/       ← HOME.png, 1.png, 2.png, 3.png, print-instagram.png
```

Pra alterar: **mexa no `_build/index.tpl.html`** e rode `python3 _build/build.py`.
Editar o `index.html` direto é jogar fora no próximo build.

## No ar

**https://sena-sena-advogados.netlify.app** — projeto Netlify `sena-sena-advogados`,
na conta do Rodrigo. Só o `index.html` subiu; `painel.html` e `painel-demo.html`
**não vão pro ar** (o painel é interno, o demo é material de apresentação).

Publicar de novo depois de um build:

```bash
SP=$(mktemp -d) && cp index.html "$SP/" && \
printf '/*\n  X-Robots-Tag: noindex\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' > "$SP/_headers" && \
netlify deploy --prod --dir "$SP" --site a3f8d298-623a-4437-aca4-d01895238260
```

⚠️ O `_headers` manda **`X-Robots-Tag: noindex`** de propósito: a URL provisória
do Netlify não pode ser indexada e depois brigar no Google com o domínio próprio
do escritório. **Na hora de apontar o domínio do Gildemi, tire essa linha** —
senão o site fica invisível na busca.

## Fontes — resolver antes de publicar

### Noka: não temos
O Rodrigo pediu **Noka + Monument**. A Monument está instalada na máquina; **a Noka não
está em lugar nenhum do sistema**. Ela é comercial (Fontfabric).

O site está com **Outfit** (Google Fonts) no lugar dela — geométrica, altura-x grande,
o parente livre mais próximo. **A troca é de uma linha:** o token `--ff-c` no `:root`
do template. Assim que os arquivos da Noka aparecerem, é só embutir como fizemos com a
Monument e trocar o token.

### Monument: licença de webfont
⚠️ Os `.otf` em `~/Library/Fonts` são **licença de desktop**. Embutir a fonte num site
exige **licença de webfont**, que é outra compra. Hoje ela vai embutida em base64 no
`index.html`, o que tecnicamente distribui o arquivo.

Isso é exposição do cliente, não da agência. Antes de publicar, confirmar a licença — ou
trocar por uma extended livre. Alternativas próximas: **Archivo Expanded** ou
**Anton** (essa só pra display).

## Estrutura da página

1. **Hero** — a arte `HOME.png` exatamente como entregue, entrando como `<img>` de largura
   100%. Os dois botões dourados são elementos HTML reais posicionados em cima dos botões
   pintados na arte. A posição foi **medida pixel a pixel** e virou percentual — por isso
   não escorrega em nenhuma largura. As medidas ficam na constante `BOTOES` do `build.py`.
   *(O cabeçalho fica escondido enquanto o hero está na tela: a arte já tem a logo, e dois
   logos ao mesmo tempo seria remendo.)*
2. **Hero do celular** — a arte é 1.88:1 e ficaria ilegível num telefone. Abaixo de 860px
   ela dá lugar a uma remontagem em HTML com a mesma linguagem: fundo `FUNDO.png`, logo,
   título em Monument com marca-texto branco, dois botões dourados.
3. **Áreas** — dois cards sobre o marinho texturizado, 4 itens cada.
4. **Prazo** — os 2 anos da prescrição bienal e os 5 anos que se cobra pra trás.
5. **Como funciona** — 4 cards pequenos; vira carrossel com encaixe abaixo de 900px.
6. **Sobre** — reproduz a arte `1.png`: o advogado recortado à esquerda, logo e texto à
   direita, no cartão marinho arredondado.
7. **Formulário qualificado** — 4 etapas, ramificado (detalhes abaixo).
8. **Dúvidas** — 5 perguntas.
9. **Onde me encontrar** — mapa escuro em tela cheia com o cartão de contato flutuando,
   alfinete dourado pulsando e atalhos pra Maps/Waze.
10. **Rodapé** — com o aviso de conformidade com a OAB.

**Removido nesta rodada:** a faixa de credenciais (8 anos / 2 áreas / ABC / Online), os
chips de assunto no Sobre, e 4 das 9 perguntas do FAQ.

## O formulário

4 etapas com barra de progresso, ramificando na etapa 1:

- **Trabalhista** → como saiu · há quanto tempo · o que ficou pra trás · documentos · relato
- **Previdenciário** → qual benefício · situação no INSS · documentos · relato
- **"Não sei"** → campo aberto, sem obrigar a pessoa a se classificar

No fim monta a **ficha do caso** — as respostas viram documento com carimbo e a OAB no
rodapé — e joga tudo numa mensagem pré-formatada do WhatsApp.

### Onde o lead fica gravado
Vai pro **Supabase**, tabela `casos`, com a chave anon (que só pode inserir). Ver
`status-crm-sena.md`.

Duas coisas que não podem ser desfeitas por engano:

- **O `localStorage` continua** (chave `sena_leads`), agora como rede de segurança, com
  `enviado:true/false`. Enquanto `SUPABASE_URL` estiver vazio no `build.py`, só ele roda.
- **O envio nunca segura o WhatsApp.** O `fetch` é disparado e o fluxo segue. Se o banco
  cair, o lead ainda chega pelo zap — que é o canal que o Gildemi realmente lê.

## Decisões de design

- **Paleta tirada das artes:** marinho `#16294A`, dourado `#E0B959`.
- **Monument Extended é larguíssima.** Só funciona em caixa alta e frase curta. Isso
  obrigou a cortar texto — o que ajudou o pedido de deixar mais clean.
  ⚠️ **Não aplicar `letter-spacing` negativo nela.** Ela já vem com sidebearing generoso
  de fábrica; tracking negativo cola as letras umas nas outras (em "DIREITO" o R e o I se
  encostavam). O tracking dos títulos é `normal` de propósito.
- **Nunca chutar `width`/`height` no `<img>`.** O atributo define a proporção que o
  navegador usa no layout: um `height` errado deforma a imagem. O `build.py` calcula e
  injeta as dimensões reais (`{{ELE_W}}` / `{{ELE_H}}`).
- **A seção Sobre reproduz a proporção da arte `1.png`:** cartão em 2,10:1, com a coluna
  da foto em 33% da largura (na arte o advogado ocupa 31,7%). Se o texto crescer, o cartão
  estica e a composição sai do lugar — mexer no texto pede reconferir a proporção.
- **Marca-texto branco** (`.mk`) é a assinatura tipográfica tirada do hero. Reaparece em
  "ONDE EU **ATUO**", "que **TRABALHA**", "**E ONDE VOCÊ ESTIVER**".
- **A logo original é dourada sobre marinho em degradê.** O `build.py` converte luminância
  em canal alfa, então ela fica transparente e assenta em qualquer fundo.
- **O mapa do Google não aceita tema escuro sem chave de API.** A solução foi filtro CSS
  (`invert` + `hue-rotate`) mais uma camada `mix-blend-mode:color` em marinho, que puxa o
  cinza do filtro pra cor da marca.
- **O recorte do advogado na seção Sobre** veio das bordas do cartão da `1.png`, medidas
  pixel a pixel — começar antes delas trazia junto a moldura preta de fora.

## Conformidade com a OAB — leia antes de mexer no texto

Provimento 205/2021 do CFOAB e Código de Ética. A página foi escrita já dentro disso:

- **Nenhuma promessa de resultado.**
- **Nenhum preço, nenhuma "consulta grátis"** — oferecer serviço gratuito como isca é
  captação indevida. O FAQ fala de honorários sem citar valor.
- **Sem depoimento de cliente** (é vedado).
- Aviso de caráter informativo no rodapé.

Prova social só pelo caminho seguro: **avaliação do Google** no perfil do escritório.

## Pendências

- [ ] **Noka:** conseguir os arquivos, ou aprovar a Outfit
- [ ] **Monument:** confirmar licença de webfont antes de publicar
- [ ] Gildemi revisar o texto de "Sobre"
- [ ] Sem prova social ainda — pedir avaliações no Google
- [x] Publicar (Netlify) — **https://sena-sena-advogados.netlify.app**
- [ ] Apontar o domínio do Gildemi e **tirar o `noindex`** do `_headers`
- [x] CRM — montado, ver `status-crm-sena.md` (falta criar o projeto Supabase)

## Histórico

- **12/08/2026** — pasta organizada, primeira versão da landing (EB Garamond + IBM Plex).
- **12/08/2026 (2ª rodada)** — reconstruída sobre as artes do Rodrigo: hero é a `HOME.png`
  com botões ancorados por medida, Monument Extended nos títulos, texto cortado, "como
  funciona" em cards/carrossel, FAQ reduzido de 9 pra 5, mapa escuro, faixa de credenciais
  removida. Testada em 1440 e 390: sem overflow, sem erro de console, formulário
  percorrido de ponta a ponta.
