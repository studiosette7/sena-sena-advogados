# Sena & Sena Advogados

Landing page e CRM do escritório do **Gildemi Sena** (OAB/SP 417.105),
advogado trabalhista e previdenciário no ABC Paulista.

⚠️ **Repositório privado.** Leva fotos do cliente, a marca dele e dados do
escritório. Não torne público.

## No ar

| O quê | Endereço |
|---|---|
| Site | https://sena-sena-advogados.netlify.app |
| CRM | https://sena-crm.netlify.app |

## Como mexer

`index.html` e `painel.html` são **gerados** — não edite direto.

```bash
# edite _build/index.tpl.html ou _build/painel.tpl.html, depois:
python3 _build/build.py
```

O `build.py` embute imagens e fontes em base64 e injeta os dados do cliente,
gerando três arquivos de página única:

- `index.html` — a landing pública
- `painel.html` — o CRM (exige login)
- `painel-demo.html` — versão de apresentação, com dados fictícios e o banco
  simulado dentro do próprio arquivo. **Nunca publique este.**

## Estrutura

```
_build/          templates e o script que gera os HTMLs
_material/       fotos, marca e capas do cliente
_setup/          ajudantes da instalação e conferência de segurança
supabase/        schema, migrations e as 5 Edge Functions
ponte-whatsapp/  serviço Node que espelha o WhatsApp (roda fora do Supabase)
```

## Documentos

- `ENTREGA.md` — o que está no ar, o que falta, como republicar
- `INSTALACAO.md` — instalar do zero numa conta nova
- `status-projeto-sena.md` — decisões de design da landing
- `status-crm-sena.md` — decisões do CRM

## O que não está aqui, de propósito

- **`supabase/migrations/*_agendamentos.sql`** — carrega o CRON_SECRET em claro.
  Está no `.gitignore`. Para recriar, veja o fim de `supabase/setup.sql`.
- **`referencia/`** — prints de produto de terceiro.
- **`ponte-whatsapp/sessao/`** — credenciais do aparelho pareado.

## Pendências conhecidas

- **Licença de webfont da Monument Extended** antes de virar domínio próprio.
  Os arquivos em `_build/fontes/` são licença de desktop.
- **Noka** nunca chegou; está Outfit no lugar.
- Chave da Anthropic não configurada — as 3 funções de IA ficam desligadas.
- Ponte do WhatsApp pronta, mas não hospedada.
