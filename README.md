# Modelo — site e CRM para advogado

Base para montar landing de captação + CRM para escritórios de advocacia,
com foco em **Direito Trabalhista e Previdenciário**.

Nasceu de um projeto real e foi limpo para ser reaproveitado: não há dado,
foto nem marca de cliente aqui.

## O que vem pronto

**Landing page** em arquivo único, com imagens e fontes embutidas.
Formulário qualificado de 4 etapas que ramifica entre trabalhista e
previdenciário, monta uma "ficha do caso" e grava direto no CRM.

**CRM** também em arquivo único:

- Esteira kanban de casos, arrastando entre etapas
- Relógio de prescrição bienal, calculado em SQL
- Agenda com calendário e assinatura `.ics` para o celular
- Assistente de IA: conversa com voz, leitura de PDF e minuta de peça
- Espelho de WhatsApp, com contatos editáveis
- **Processos puxados do Diário de Justiça pelo número da OAB**

## O diferencial: processos de graça

Duas APIs públicas do CNJ substituem as assinaturas pagas de monitoramento:

- **Comunica/DJEN** — publicações e intimações por número de OAB, sem chave
- **DataJud** — a linha do tempo de cada processo

Está em `supabase/functions/cnj/`. Basta a OAB do advogado.

## Como usar

```bash
# 1. preencha os dados do cliente
#    _build/build.py → dicionário DADOS

# 2. coloque o material em _material/
#    capas/    home-desktop.png, home-mobile.png, sobre-mobile.png
#    marca/    logo.png
#    fontes/   em _build/fontes/ (veja a nota sobre licença)

# 3. crie o banco e publique as funções
npx supabase login
bash instalar.sh

# 4. gere as páginas
python3 _build/build.py
```

Sai `index.html`, `painel.html` e `painel-demo.html` — este último com dados
fictícios e o banco simulado dentro do arquivo, para apresentar ao cliente
antes de existir qualquer infraestrutura.

## Como está montado

```
_build/          templates e o gerador das páginas
_setup/          instalador e conferência de segurança
supabase/        schema com RLS + 5 Edge Functions
ponte-whatsapp/  serviço Node que espelha o WhatsApp
```

Backend em Supabase: 12 tabelas, 3 views, RLS em tudo. A landing usa a chave
pública e **só consegue criar caso** — não lê, não edita, não apaga.

`bash _setup/conferir.sh` testa essas travas contra o projeto de verdade.

## Fontes — leia antes de publicar

O `_build/fontes/` vem **vazio de propósito**. O projeto original usa a
**Monument Extended**, cuja licença é de desktop: não permite embutir num site
nem distribuir o arquivo. Coloque uma fonte que você tenha licença de webfont,
ou troque por uma livre — **Archivo Expanded** é a substituta mais próxima, e
a troca é o token `--ff-t` no topo de `_build/index.tpl.html`.

## WhatsApp — leia antes de ligar

O espelho por QR Code usa biblioteca não-oficial. Funciona, mas contraria os
termos do WhatsApp e existe risco real de bloqueio do número. **Use um número
novo do escritório**, nunca o pessoal do advogado — é a agenda de clientes dele.

Detalhes em `ponte-whatsapp/README.md`.

## IA — leia antes de confiar

As funções usam a API do Google Gemini (`gemini-2.5-flash`), pelo tier
gratuito — sem cartão, sem custo dentro dos limites do plano free (na prática,
dá folga de sobra pro uso de um escritório pequeno; se algum dia precisar de
mais volume, dá pra ligar faturamento na mesma chave sem trocar nada no código).
A regra codada é que **jurisprudência só é citada com busca feita na hora**
(Google Search, via a ferramenta nativa do Gemini): se a busca não confirmar, a
IA diz que não localizou, em vez de inventar. Peça sai sempre como **minuta**,
com uma seção do que conferir antes de protocolar.

Isso não é preciosismo — advogado já foi punido por citar acórdão inexistente
vindo de IA.

## Conformidade com a OAB

Os textos da landing e os rascunhos que a IA gera seguem o Provimento 205/2021:
sem promessa de resultado, sem preço, sem "consulta grátis" como isca, sem
depoimento de cliente. Se for mexer na copy, mantenha isso.
