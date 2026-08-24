# Sena & Sena — entrega

## Os dois endereços

| O quê | Endereço |
|---|---|
| Site (público) | https://sena-sena-advogados.netlify.app |
| CRM (só com login) | https://sena-crm.netlify.app |

**Login do Gildemi**
`sena.sena.adv@gmail.com` · a senha combinada

⚠️ **Troque a senha no primeiro acesso.** Ela circulou por conversa e é curta
para o que protege: o acesso a todos os casos dos clientes.
Authentication → Users → o usuário → Reset password.

## O que já funciona de verdade

- Formulário do site cai direto no CRM (testado ponta a ponta)
- 24 processos e 65 publicações reais, puxados da OAB 417.105
- Varredura do Diário todo dia às 3h; aviso do dia às 7h; resumo às segundas às 8h
- Painel atualiza sozinho (tempo real ligado)
- Cadastro de novas contas **fechado** — só o Gildemi entra
- Sem login, ninguém lê nada: testado em todas as tabelas

## O que está montado mas desligado

**As três funções de IA** — triagem do lead, leitura de PDF e minuta de peça.
Faltam só a chave da conta da Anthropic:
`console.anthropic.com` → API Keys → Create Key, e colar em
Supabase → Project Settings → Edge Functions → Secrets → `ANTHROPIC_API_KEY`.
Custo estimado: R$ 80 a R$ 130/mês com uso pesado. Liga na hora, sem reinstalar.

**O WhatsApp** — a ponte está pronta em `ponte-whatsapp/`, falta subir num
servidor (~US$ 5/mês) e parear. Ver `ponte-whatsapp/README.md`.
Use um **número novo do escritório**, nunca o pessoal.

**Os lembretes por WhatsApp** — dependem do cadastro na Meta, que leva dias.

## Antes de virar o domínio próprio

⚠️ **Licença da fonte Monument Extended.** Os arquivos usados são de licença
de desktop; publicar num site exige licença de webfont, que é outra compra.
Hoje a fonte vai embutida no `index.html`, o que tecnicamente a distribui.

**Isso é exposição do escritório, não da agência.** Antes de apontar o domínio,
ou compra a licença de webfont, ou troca por uma extended livre — **Archivo
Expanded** é a substituta mais próxima e a troca é de uma linha no template.

Também: a **Noka** nunca chegou; hoje está **Outfit** no lugar dela.

E quando apontar o domínio, **tire o `X-Robots-Tag: noindex`** dos dois sites —
senão eles ficam invisíveis no Google. Está no `_headers` de cada deploy.

## Manutenção

Nunca edite `index.html` ou `painel.html` direto — eles são gerados.
Mexa em `_build/index.tpl.html` ou `_build/painel.tpl.html` e rode:

```bash
python3 _build/build.py
```

Republicar:

```bash
# site
SP=$(mktemp -d) && cp index.html "$SP/" && \
printf '/*\n  X-Robots-Tag: noindex\n' > "$SP/_headers" && \
netlify deploy --prod --dir "$SP" --site a3f8d298-623a-4437-aca4-d01895238260

# CRM
SP=$(mktemp -d) && cp painel.html "$SP/index.html" && \
printf '/*\n  X-Robots-Tag: noindex, nofollow\n  X-Frame-Options: DENY\n' > "$SP/_headers" && \
netlify deploy --prod --dir "$SP" --site ee641e64-2ae3-47cb-9fd5-9f48bb0906a4
```

Conferir as travas do banco a qualquer momento: `bash _setup/conferir.sh`

## Para apresentar sem tocar no banco real

`painel-demo.html` — abre com dois cliques, dados fictícios, QR encenado.
**Nunca publique esse arquivo.** Ele aponta para um endereço falso de propósito.
