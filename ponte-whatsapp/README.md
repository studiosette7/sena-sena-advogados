# Ponte do WhatsApp — Escritório

Processo que segura a sessão do WhatsApp Web e liga o aparelho ao CRM.

## Antes de tudo: o risco

Espelhar o WhatsApp por QR Code usa **biblioteca não-oficial**. Funciona, muita
gente usa, e **contraria os termos do WhatsApp**. Existe risco real de o número
ser bloqueado — sem aviso e sem recurso.

**Use um número novo do escritório.** O número pessoal do o advogado é a agenda de
clientes dele; se aquele número cair, cai o escritório junto.

O caminho oficial é a API da Meta (Cloud API), que não corre esse risco — mas ela
**toma o número** (migrou, não usa mais no celular) e não espelha conversa
existente. Por isso esta ponte existe: é o que entrega o que foi pedido.

## Onde roda

**Não roda no Supabase.** Edge Function é efêmera; isto precisa de um processo
vivo com websocket aberto 24h. Suba num servidor pequeno:

- **Railway** ou **Render** — mais fácil, tem plano barato
- **Fly.io** — bom se quiser volume persistente
- **VPS** (Hetzner, DigitalOcean) — a partir de uns US$ 5/mês

Precisa de **disco persistente** montado na pasta `sessao/`. Sem isso ele pede
QR Code toda vez que reinicia.

## Subir

```bash
npm install

export SUPABASE_URL=https://<projeto>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service role>   # nunca a anon

npm start
```

A `service_role` ignora o RLS de propósito: a ponte não é um usuário logado.
**Ela nunca pode chegar no navegador.**

## Parear

1. Suba a ponte.
2. Abra o painel → **WhatsApp**. O QR Code aparece na tela.
3. No celular: WhatsApp → Aparelhos conectados → Conectar aparelho.
4. Escaneie. O estado vira **conectado** e os contatos começam a entrar.

Se cair, ele reconecta sozinho. Só pede QR de novo se a sessão for encerrada
pelo aparelho.

## Como conversa com o CRM

| Tabela | Quem escreve | Pra quê |
|---|---|---|
| `wpp_sessao` | ponte | estado da conexão e o QR |
| `contatos` | ponte + painel | a agenda; o `nome` que o o advogado edita nunca é sobrescrito |
| `conversas_wpp` | ponte | uma por contato, com prévia e não lidas |
| `mensagens_wpp` | ponte | o histórico |
| `wpp_fila` | painel | mensagem pra enviar; a ponte consome a cada 3s |

O painel **nunca alcança a ponte pela rede** — os dois se falam pelo banco. Isso
significa que a ponte pode cair sem derrubar o painel, e o que estiver na fila
sai quando ela voltar.

## Detalhes que importam

- **Só conversa de pessoa.** Grupo, status e lista de transmissão ficam de fora.
- **`markOnlineOnConnect: false`** — sem isso o WhatsApp para de mandar
  notificação pro celular dele, e ele deixaria de ver mensagem no aparelho.
- **`id_wpp` é único** — mensagem repetida não duplica na tela.
- **Mídia não é baixada.** Imagem, áudio e documento entram como marcador
  (`[áudio]`, `[documento] nome.pdf`). Baixar exige storage e decisão sobre
  guardar documento de cliente — vale conversar antes.
