-- ============================================================
-- SENA & SENA ADVOGADOS — banco do CRM
-- Rodar no SQL Editor do Supabase (uma vez).
--
-- Desenho: a landing (chave anon, pública) só INSERE caso novo.
-- O painel (usuário logado) lê e edita tudo. Ninguém deslogado lê nada.
-- ============================================================

-- ---------- 1) tabela de casos ----------
create table if not exists public.casos (
  id          uuid primary key default gen_random_uuid(),
  criado_at   timestamptz not null default now(),

  -- quem é a pessoa
  nome        text not null,
  whatsapp    text not null,
  cidade      text,
  horario     text,                    -- melhor horário pra falar

  -- o que ela respondeu no formulário da landing
  area        text not null,           -- Trabalhista | Previdenciário | Não sei classificar
  situacao    text,                    -- trabalhista: como saiu
  saida       text,                    -- trabalhista: faixa de tempo desde a saída
  pontos      text[],                  -- trabalhista: o que ficou pra trás
  beneficio   text[],                  -- previdenciário: quais benefícios
  inss        text,                    -- previdenciário: situação no INSS
  documentos  text,                    -- o que a pessoa tem guardado
  relato      text,                    -- texto livre
  origem      text,                    -- de onde veio (referrer)

  -- gestão do caso (só o painel escreve)
  etapa       text not null default 'triagem',
  notas       text,

  -- data exata do fim do contrato, confirmada pelo advogado.
  -- É daqui que sai o relógio de prescrição — a faixa do formulário
  -- ("entre 1 e 2 anos") serve só pra priorizar a fila até ele confirmar.
  data_saida  date,

  -- resultado da análise da IA
  ia          jsonb,
  ia_at       timestamptz
);

comment on column public.casos.data_saida is
  'Fim do contrato de trabalho. Prescrição bienal conta a partir daqui.';

-- etapas válidas — vocabulário do escritório, não de funil de vendas
alter table public.casos drop constraint if exists casos_etapa_valida;
alter table public.casos add constraint casos_etapa_valida check (etapa in (
  'triagem',      -- chegou, ninguém olhou
  'viabilidade',  -- analisando se tem caso
  'documentos',   -- esperando o cliente mandar papel
  'contrato',     -- proposta e honorários
  'protocolado',  -- ação distribuída
  'andamento',    -- tramitando
  'desfecho',     -- acordo ou sentença
  'encerrado',
  'descartado'    -- sem caso, ou o cliente sumiu
));

alter table public.casos drop constraint if exists casos_area_valida;
alter table public.casos add constraint casos_area_valida check (area in (
  'Trabalhista', 'Previdenciário', 'Não sei classificar'
));

create index if not exists casos_etapa_idx      on public.casos (etapa);
create index if not exists casos_criado_at_idx  on public.casos (criado_at desc);
create index if not exists casos_data_saida_idx on public.casos (data_saida)
  where data_saida is not null;

-- ---------- 2) trilha de acompanhamento ----------
-- Cada movimentação do caso. Alimenta a régua de aviso ao cliente.
create table if not exists public.movimentacoes (
  id         uuid primary key default gen_random_uuid(),
  caso_id    uuid not null references public.casos(id) on delete cascade,
  criado_at  timestamptz not null default now(),
  tipo       text not null default 'nota',  -- nota | etapa | prazo | audiencia | contato
  texto      text not null,
  avisar     boolean not null default false -- se vira mensagem pro cliente
);

create index if not exists mov_caso_idx on public.movimentacoes (caso_id, criado_at desc);

-- ---------- 2b) tarefas e compromissos ----------
-- Audiência, prazo de recurso, "cobrar o documento na sexta". É o que alimenta
-- a agenda do painel. Separado de movimentacoes de propósito: movimentação é
-- o que JÁ aconteceu, tarefa é o que AINDA vai acontecer.
create table if not exists public.tarefas (
  id         uuid primary key default gen_random_uuid(),
  caso_id    uuid references public.casos(id) on delete cascade,
  criado_at  timestamptz not null default now(),
  titulo     text not null,
  quando     timestamptz not null,
  tipo       text not null default 'tarefa',   -- tarefa | audiencia | prazo | reuniao
  feita      boolean not null default false,
  feita_at   timestamptz
);

create index if not exists tarefas_quando_idx on public.tarefas (quando)
  where feita = false;
create index if not exists tarefas_caso_idx   on public.tarefas (caso_id, quando);

-- ---------- 2c) publicações do CNJ ----------
-- Alimentada pela função `cnj`, que varre o DJEN pelo número da OAB.
-- `id_cnj` é o id da própria comunicação lá — é ele que impede gravar
-- a mesma publicação duas vezes quando a varredura roda todo dia.
create table if not exists public.publicacoes (
  id_cnj        bigint primary key,
  visto_em      timestamptz not null default now(),
  disponibilizada date,
  tribunal      text,
  orgao         text,
  classe        text,
  tipo          text,
  processo      text,          -- com máscara, do jeito que se lê
  processo_num  text,          -- só dígitos, é como o DataJud aceita
  texto         text,
  link          text,
  partes        jsonb,
  lida          boolean not null default false,
  caso_id       uuid references public.casos(id) on delete set null
);

create index if not exists pub_data_idx     on public.publicacoes (disponibilizada desc);
create index if not exists pub_processo_idx on public.publicacoes (processo_num);
create index if not exists pub_nao_lida_idx on public.publicacoes (lida) where lida = false;

-- ---------- 2d) documentos e o que a IA leu ----------
-- O arquivo em si mora no Storage (bucket `documentos`, privado). Aqui
-- fica o registro: de quem é, o que é, e o que a IA extraiu dele.
create table if not exists public.documentos (
  id         uuid primary key default gen_random_uuid(),
  caso_id    uuid references public.casos(id) on delete cascade,
  criado_at  timestamptz not null default now(),
  nome       text not null,
  caminho    text not null,          -- caminho dentro do bucket
  tamanho    bigint,
  tipo       text,                   -- inicial | contestacao | laudo | cnis | ppp | holerite | outro
  analise    jsonb,                  -- o que a IA leu
  analise_at timestamptz
);

create index if not exists doc_caso_idx on public.documentos (caso_id, criado_at desc);

-- ---------- 2e) conversas com a assistente ----------
-- Conversa de verdade, com ida e volta: uma linha por conversa e uma
-- linha por mensagem. Sem isso a IA não lembra do que foi dito duas
-- perguntas atrás, e não dá pra tirar dúvida em cima da resposta.
create table if not exists public.conversas (
  id           uuid primary key default gen_random_uuid(),
  criado_at    timestamptz not null default now(),
  mexida_at    timestamptz not null default now(),
  titulo       text,                 -- as primeiras palavras da 1ª pergunta
  caso_id      uuid references public.casos(id) on delete set null,
  documento_id uuid references public.documentos(id) on delete set null
);

create table if not exists public.mensagens (
  id          uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversas(id) on delete cascade,
  criado_at   timestamptz not null default now(),
  papel       text not null check (papel in ('user','assistant')),
  texto       text not null,
  fontes      jsonb,                 -- links que a IA citou, pra conferir
  uso         jsonb                  -- tokens gastos
);

create index if not exists conversa_idx  on public.conversas (mexida_at desc);
create index if not exists mensagem_idx  on public.mensagens (conversa_id, criado_at);

-- ---------- 3) RLS ----------
alter table public.casos         enable row level security;
alter table public.movimentacoes enable row level security;
alter table public.tarefas       enable row level security;
alter table public.publicacoes   enable row level security;
alter table public.documentos    enable row level security;
alter table public.conversas     enable row level security;
alter table public.mensagens     enable row level security;

-- A landing só pode CRIAR caso. Não lê, não edita, não apaga.
-- O `with check` impede que alguém forje etapa/notas/IA pelo formulário.
drop policy if exists "anon cria caso" on public.casos;
create policy "anon cria caso"
  on public.casos for insert
  to anon
  with check (
    etapa = 'triagem'
    and notas is null
    and ia is null
    and data_saida is null
    and char_length(nome)     between 2 and 120
    and char_length(whatsapp) between 8 and 25
    and (cidade  is null or char_length(cidade)  <= 120)
    and (relato  is null or char_length(relato)  <= 4000)
    and (horario is null or char_length(horario) <= 60)
  );

-- O painel (logado) faz tudo.
drop policy if exists "auth le casos" on public.casos;
create policy "auth le casos" on public.casos
  for select to authenticated using (true);

drop policy if exists "auth edita casos" on public.casos;
create policy "auth edita casos" on public.casos
  for update to authenticated using (true) with check (true);

drop policy if exists "auth apaga casos" on public.casos;
create policy "auth apaga casos" on public.casos
  for delete to authenticated using (true);

-- Movimentações e tarefas são internas: só o painel, nunca o público.
drop policy if exists "auth tudo movimentacoes" on public.movimentacoes;
create policy "auth tudo movimentacoes" on public.movimentacoes
  for all to authenticated using (true) with check (true);

drop policy if exists "auth tudo tarefas" on public.tarefas;
create policy "auth tudo tarefas" on public.tarefas
  for all to authenticated using (true) with check (true);

drop policy if exists "auth tudo publicacoes" on public.publicacoes;
create policy "auth tudo publicacoes" on public.publicacoes
  for all to authenticated using (true) with check (true);

drop policy if exists "auth tudo documentos" on public.documentos;
create policy "auth tudo documentos" on public.documentos
  for all to authenticated using (true) with check (true);

drop policy if exists "auth tudo conversas" on public.conversas;
create policy "auth tudo conversas" on public.conversas
  for all to authenticated using (true) with check (true);

drop policy if exists "auth tudo mensagens" on public.mensagens;
create policy "auth tudo mensagens" on public.mensagens
  for all to authenticated using (true) with check (true);

-- ---------- 3b) o cofre dos arquivos ----------
-- Bucket privado: documento de cliente não pode ter URL que abre sem login.
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

drop policy if exists "auth le arquivos"    on storage.objects;
drop policy if exists "auth manda arquivos" on storage.objects;
drop policy if exists "auth apaga arquivos" on storage.objects;

create policy "auth le arquivos" on storage.objects
  for select to authenticated using (bucket_id = 'documentos');
create policy "auth manda arquivos" on storage.objects
  for insert to authenticated with check (bucket_id = 'documentos');
create policy "auth apaga arquivos" on storage.objects
  for delete to authenticated using (bucket_id = 'documentos');

-- ---------- 4) o relógio da prescrição ----------
-- Prazo bienal do art. 7º, XXIX da Constituição: 2 anos do fim do contrato.
-- Fica em SQL de propósito — é conta de calendário, não é trabalho de IA.
create or replace view public.casos_com_prazo as
select
  c.*,
  case when c.data_saida is null then null
       else (c.data_saida + interval '2 years')::date
  end as prescreve_em,
  case when c.data_saida is null then null
       else ((c.data_saida + interval '2 years')::date - current_date)
  end as dias_restantes,
  case
    when c.data_saida is null then 'sem_data'
    when (c.data_saida + interval '2 years')::date < current_date then 'prescrito'
    when (c.data_saida + interval '2 years')::date - current_date <= 90  then 'critico'
    when (c.data_saida + interval '2 years')::date - current_date <= 180 then 'atencao'
    else 'ok'
  end as alerta_prazo
from public.casos c;

-- A view herda o RLS da tabela (security_invoker), então continua
-- valendo a regra: só usuário logado enxerga.
alter view public.casos_com_prazo set (security_invoker = on);

-- ---------- 5) os processos dele, pela OAB ----------
-- O DJEN entrega PUBLICAÇÃO, não processo. Mas cada publicação carrega o
-- número do processo — então agrupando por ele sai a carteira inteira do
-- escritório, que é o que o Gildemi quer ver: "meus processos".
--
-- Fica como view e não como tabela de propósito: assim nunca desencontra
-- da varredura. Publicação nova entra, o processo aparece sozinho.
create or replace view public.processos_oab as
select
  p.processo,
  p.processo_num,
  (array_agg(p.tribunal order by p.disponibilizada desc))[1] as tribunal,
  (array_agg(p.orgao    order by p.disponibilizada desc))[1] as orgao,
  (array_agg(p.classe   order by p.disponibilizada desc))[1] as classe,
  (array_agg(p.partes   order by p.disponibilizada desc))[1] as partes,
  (array_agg(p.caso_id  order by p.disponibilizada desc)
     filter (where p.caso_id is not null))[1]                as caso_id,
  count(*)                        as publicacoes,
  max(p.disponibilizada)          as ultima,
  min(p.disponibilizada)          as primeira,
  count(*) filter (where not p.lida) as nao_lidas
from public.publicacoes p
where p.processo is not null
group by p.processo, p.processo_num;

alter view public.processos_oab set (security_invoker = on);

-- ---------- 6) o que roda sozinho ----------
-- Trocar <PROJETO> pela referência do projeto e <CRON_SECRET> pelo mesmo
-- valor de `npx supabase secrets set CRON_SECRET=...`.
--
-- Os horários estão em UTC, que é como o pg_cron conta. São Paulo é UTC-3:
--   09:00 UTC = 06:00 aqui   |   11:00 UTC = 08:00 aqui
--
-- create extension if not exists pg_cron;
-- create extension if not exists pg_net;
--
-- -- varre o Diário toda madrugada (03:00 de Brasília)
-- select cron.schedule('cnj-varredura', '0 6 * * *', $$
--   select net.http_post(
--     url     := 'https://<PROJETO>.supabase.co/functions/v1/cnj',
--     headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
--     body    := '{"acao":"varrer"}'::jsonb
--   );
-- $$);
--
-- -- aviso do dia, 07:00 de Brasília, de segunda a sexta
-- select cron.schedule('aviso-diario', '0 10 * * 1-5', $$
--   select net.http_post(
--     url     := 'https://<PROJETO>.supabase.co/functions/v1/lembretes',
--     headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
--     body    := '{"tipo":"diario"}'::jsonb
--   );
-- $$);
--
-- -- resumo da semana, segunda 08:00 de Brasília
-- select cron.schedule('resumo-semanal', '0 11 * * 1', $$
--   select net.http_post(
--     url     := 'https://<PROJETO>.supabase.co/functions/v1/lembretes',
--     headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
--     body    := '{"tipo":"semanal"}'::jsonb
--   );
-- $$);
--
-- Conferir:  select * from cron.job;
-- Remover:   select cron.unschedule('aviso-diario');

-- ============================================================
-- 7) WHATSAPP — contatos, conversas e mensagens
-- ============================================================
-- Alimentado pela ponte (pasta ponte-whatsapp/), que é um processo Node
-- separado segurando a sessão do WhatsApp Web. O painel só lê e escreve
-- nestas tabelas; quem fala com o WhatsApp é a ponte.
--
-- ⚠️ Espelhar o WhatsApp por QR Code usa biblioteca não-oficial. Funciona,
-- mas contraria os termos do WhatsApp e existe risco real de o número ser
-- bloqueado. A recomendação continua sendo usar um número novo do
-- escritório aqui, e deixar o pessoal do Gildemi fora disso.

create table if not exists public.contatos (
  id          uuid primary key default gen_random_uuid(),
  criado_at   timestamptz not null default now(),
  telefone    text not null unique,          -- só dígitos, com 55
  jid         text unique,                   -- id interno do WhatsApp
  nome        text,                          -- como ele quer chamar (editável)
  nome_wpp    text,                          -- como veio do aparelho
  foto        text,                          -- url da foto de perfil
  email       text,
  cpf         text,
  cidade      text,
  etiquetas   text[],                        -- cliente, lead, parte contrária…
  notas       text,
  caso_id     uuid references public.casos(id) on delete set null,
  bloqueado   boolean not null default false
);

create index if not exists contato_nome_idx on public.contatos (nome);
create index if not exists contato_caso_idx on public.contatos (caso_id);

create table if not exists public.conversas_wpp (
  id            uuid primary key default gen_random_uuid(),
  contato_id    uuid not null references public.contatos(id) on delete cascade,
  criado_at     timestamptz not null default now(),
  ultima_at     timestamptz not null default now(),
  ultima_previa text,                        -- prévia da última mensagem
  nao_lidas     int not null default 0,
  arquivada     boolean not null default false,
  unique (contato_id)
);

create index if not exists conv_wpp_idx on public.conversas_wpp (ultima_at desc);

create table if not exists public.mensagens_wpp (
  id          uuid primary key default gen_random_uuid(),
  conversa_id uuid not null references public.conversas_wpp(id) on delete cascade,
  id_wpp      text unique,                   -- id da mensagem no WhatsApp
  criado_at   timestamptz not null default now(),
  de_mim      boolean not null default false,
  tipo        text not null default 'texto', -- texto | imagem | audio | documento | outro
  texto       text,
  midia_url   text,
  entregue    boolean not null default false,
  erro        text
);

create index if not exists msg_wpp_idx on public.mensagens_wpp (conversa_id, criado_at);

-- Fila de saída: o painel enfileira, a ponte consome e marca enviada.
-- Assim o painel nunca precisa alcançar a ponte pela rede.
create table if not exists public.wpp_fila (
  id          uuid primary key default gen_random_uuid(),
  criado_at   timestamptz not null default now(),
  telefone    text not null,
  texto       text not null,
  enviada_at  timestamptz,
  erro        text
);

create index if not exists fila_pendente_idx on public.wpp_fila (criado_at)
  where enviada_at is null;

-- Estado da sessão: é aqui que o QR Code aparece pro painel mostrar.
create table if not exists public.wpp_sessao (
  id         int primary key default 1 check (id = 1),
  estado     text not null default 'desconectado',  -- desconectado | qr | conectado
  qr         text,                                   -- o QR em texto, pra virar imagem no painel
  numero     text,                                   -- número pareado
  visto_at   timestamptz not null default now(),
  erro       text
);

insert into public.wpp_sessao (id) values (1) on conflict (id) do nothing;

alter table public.contatos      enable row level security;
alter table public.conversas_wpp enable row level security;
alter table public.mensagens_wpp enable row level security;
alter table public.wpp_fila      enable row level security;
alter table public.wpp_sessao    enable row level security;

drop policy if exists "auth tudo contatos" on public.contatos;
create policy "auth tudo contatos" on public.contatos
  for all to authenticated using (true) with check (true);

drop policy if exists "auth tudo conversas_wpp" on public.conversas_wpp;
create policy "auth tudo conversas_wpp" on public.conversas_wpp
  for all to authenticated using (true) with check (true);

drop policy if exists "auth tudo mensagens_wpp" on public.mensagens_wpp;
create policy "auth tudo mensagens_wpp" on public.mensagens_wpp
  for all to authenticated using (true) with check (true);

drop policy if exists "auth tudo wpp_fila" on public.wpp_fila;
create policy "auth tudo wpp_fila" on public.wpp_fila
  for all to authenticated using (true) with check (true);

drop policy if exists "auth le wpp_sessao" on public.wpp_sessao;
create policy "auth le wpp_sessao" on public.wpp_sessao
  for all to authenticated using (true) with check (true);

-- A lista que o painel abre: conversa + contato numa consulta só.
create or replace view public.wpp_caixa as
select
  c.id             as conversa_id,
  c.ultima_at,
  c.ultima_previa,
  c.nao_lidas,
  c.arquivada,
  ct.id            as contato_id,
  ct.telefone,
  ct.jid,
  coalesce(nullif(ct.nome, ''), ct.nome_wpp, ct.telefone) as exibir,
  ct.nome, ct.nome_wpp, ct.foto, ct.etiquetas, ct.cidade, ct.notas,
  ct.caso_id,
  cs.nome          as caso_nome,
  cs.etapa         as caso_etapa
from public.conversas_wpp c
join public.contatos ct on ct.id = c.contato_id
left join public.casos cs on cs.id = ct.caso_id;

alter view public.wpp_caixa set (security_invoker = on);
