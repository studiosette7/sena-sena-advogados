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
-- escritório, que é o que o o advogado quer ver: "meus processos".
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
-- escritório aqui, e deixar o pessoal do o advogado fora disso.

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

-- ============================================================
-- 8) PROCESSOS — V3: entidade de primeira classe e triagem
-- ============================================================
-- Até aqui, "processo" era só um agrupamento de `publicacoes` (view
-- `processos_oab`). Isso misturava duas coisas: "a OAB apareceu numa
-- publicação" com "esse processo é da carteira do escritório". A partir
-- daqui `processos` é tabela de verdade, com UUID próprio, e todo processo
-- achado automaticamente nasce em observação — só vira carteira oficial
-- quando o advogado confirma. `publicacoes` continua existindo do jeito
-- que está; só ganha uma FK para o processo dela.

-- ---------- 8a) a tabela ----------
create table if not exists public.processos (
  id                   uuid primary key default gen_random_uuid(),
  criado_at            timestamptz not null default now(),
  atualizado_at        timestamptz not null default now(),

  -- identidade: cnj_normalizado (só dígitos, 20 posições) é a chave real
  -- de deduplicação daqui pra frente. processo/processo_num continuam
  -- existindo pelo mesmo motivo de sempre em `publicacoes`: nem toda
  -- publicação chega com um CNJ de 20 dígitos limpo, e não dá pra perder
  -- o processo só porque o número veio mal formatado.
  cnj_normalizado      text,
  processo_num         text,
  processo             text,

  tribunal             text,
  orgao                text,
  classe               text,
  comarca              text,
  assunto              text,

  -- nem DJEN nem DataJud trazem isso de graça — quando aparece é porque a
  -- IA achou escrito no texto de alguma publicação, ou o advogado editou
  -- à mão (edição manual sempre vence, ver função `andamento` no cnj).
  valor_causa          numeric,
  autuado_em           date,
  justica_gratuita     boolean,
  prioridades          jsonb,        -- array de strings
  audiencias           jsonb,        -- array de {data, tipo, local}

  caso_id              uuid references public.casos(id) on delete set null,

  -- dois conceitos, dois campos — nunca misturar.
  -- status_triagem: onde o processo está no funil de confirmação do advogado.
  -- status_processual: a situação real do processo na Justiça.
  status_triagem       text not null default 'observacao'
                          check (status_triagem in ('observacao','confirmado','ignorado')),
  status_processual    text not null default 'em_andamento'
                          check (status_processual in
                            ('em_andamento','arquivado','suspenso','baixado','encerrado')),

  -- auditoria da decisão do advogado
  confirmado_em        timestamptz,
  confirmado_por       uuid references auth.users(id),
  ignorado_em          timestamptz,
  ignorado_por         uuid references auth.users(id),

  -- descoberta
  origem               text,                  -- 'djen' | 'datajud' | ... (fonte que originou o registro)
  data_distribuicao    date,
  ultima_movimentacao  timestamptz,           -- cache: max() das fontes/movimentos, evita join pra ordenar/filtrar
  partes                jsonb,                -- cache do último snapshot de partes
  advogados             jsonb,                -- cache do DJEN: [{nome,oab,uf}], sem amarração a polo (o DJEN não informa)

  -- confiança da triagem: orienta o que revisar primeiro, nunca decide sozinha
  confianca_nivel      text check (confianca_nivel in ('alta','media','baixa')),
  confianca_score      smallint,              -- 0–100, recalculado a cada sincronização
  confianca_sinais     jsonb                  -- os sinais que compuseram o score, pro advogado auditar
);

comment on table public.processos is
  'Entidade de primeira classe. Nasce em observacao quando achado pela OAB; só vira carteira oficial (confirmado) por ação do advogado. status_triagem = fluxo de confirmação; status_processual = estado real do processo — nunca misturar os dois.';

-- duas chaves de dedup parciais: uma para quem tem CNJ válido de 20
-- dígitos, outra (por texto mascarado) para quem não tem — sem isso, um
-- processo com CNJ malformado duplicaria a cada vez que o setup.sql roda
-- de novo.
create unique index if not exists processos_cnj_norm_idx
  on public.processos (cnj_normalizado) where cnj_normalizado is not null;
create unique index if not exists processos_sem_cnj_idx
  on public.processos (processo) where cnj_normalizado is null;

create index if not exists processos_status_triagem_idx on public.processos (status_triagem);
create index if not exists processos_caso_idx           on public.processos (caso_id);
create index if not exists processos_confianca_idx      on public.processos (confianca_nivel)
  where status_triagem = 'observacao';

create or replace function public.processos_toca_atualizado_at()
returns trigger language plpgsql as $$
begin
  new.atualizado_at = now();
  return new;
end;
$$;

drop trigger if exists processos_atualizado_at on public.processos;
create trigger processos_atualizado_at
  before update on public.processos
  for each row execute function public.processos_toca_atualizado_at();

-- ---------- 8b) normalização de CNJ ----------
-- Só dígitos. "0001234-56.2026.8.10.0001" e "00012345620268100001" têm
-- que virar a mesma chave — é o que impede duplicar processo por causa de
-- formatação diferente entre fontes.
create or replace function public.normaliza_cnj(txt text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(txt, ''), '\D', '', 'g'), '')
$$;

-- ---------- 8c) de onde cada processo foi descoberto/confirmado ----------
-- Um processo pode aparecer em mais de uma fonte (hoje DJEN e DataJud).
-- Isso não cria processo duplicado: enriquece o mesmo registro.
create table if not exists public.processo_fontes (
  id            uuid primary key default gen_random_uuid(),
  processo_id   uuid not null references public.processos(id) on delete cascade,
  fonte         text not null check (fonte in ('djen','datajud')),
  id_externo    text,             -- id do registro na fonte, quando existir
  dados         jsonb,            -- payload cru daquela fonte, pra auditoria
  primeira_vez  timestamptz not null default now(),
  ultima_vez    timestamptz not null default now(),
  unique (processo_id, fonte, id_externo)
);
create index if not exists processo_fontes_processo_idx on public.processo_fontes (processo_id);

-- ---------- 8d) movimentações processuais ----------
create table if not exists public.processo_movimentos (
  id              uuid primary key default gen_random_uuid(),
  processo_id     uuid not null references public.processos(id) on delete cascade,
  data_movimento  timestamptz,
  descricao       text not null,
  orgao           text,
  fonte           text not null check (fonte in ('djen','datajud')),
  id_externo      text,           -- chave da fonte, pra não duplicar no upsert
  dados           jsonb,
  sincronizado_em timestamptz not null default now(),
  unique (processo_id, fonte, id_externo)
);
create index if not exists processo_mov_processo_idx on public.processo_movimentos (processo_id, data_movimento desc);

-- ---------- 8e) auditoria da triagem ----------
create table if not exists public.processo_eventos (
  id           uuid primary key default gen_random_uuid(),
  processo_id  uuid not null references public.processos(id) on delete cascade,
  criado_at    timestamptz not null default now(),
  usuario_id   uuid references auth.users(id),
  acao         text not null check (acao in
    ('encontrado','confirmado','ignorado','reavaliado','arquivado','reaberto',
     'dados_atualizados','fonte_sincronizada')),
  origem       text,              -- fonte envolvida, quando fizer sentido
  detalhe      jsonb
);
create index if not exists processo_eventos_processo_idx on public.processo_eventos (processo_id, criado_at desc);

-- ---------- 8f) publicações e conversas passam a apontar pro processo ----------
-- id_cnj continua sendo o id da PUBLICAÇÃO (comunicação do DJEN). Não
-- confundir com o número CNJ do PROCESSO — são coisas diferentes.
alter table public.publicacoes add column if not exists processo_id uuid
  references public.processos(id) on delete set null;
create index if not exists pub_processo_id_idx on public.publicacoes (processo_id);

alter table public.conversas add column if not exists processo_id uuid
  references public.processos(id) on delete set null;
create index if not exists conversas_processo_idx on public.conversas (processo_id);

-- ---------- 8f-2) advogados da comunicação (DJEN), sem amarração a polo ----------
alter table public.processos add column if not exists advogados jsonb;
alter table public.processos add column if not exists valor_causa numeric;
alter table public.processos add column if not exists autuado_em date;
alter table public.processos add column if not exists justica_gratuita boolean;
alter table public.processos add column if not exists prioridades jsonb;
alter table public.processos add column if not exists audiencias jsonb;

-- ---------- 8g) RLS ----------
alter table public.processos          enable row level security;
alter table public.processo_fontes    enable row level security;
alter table public.processo_movimentos enable row level security;
alter table public.processo_eventos   enable row level security;

drop policy if exists "auth tudo processos" on public.processos;
create policy "auth tudo processos" on public.processos
  for all to authenticated using (true) with check (true);

drop policy if exists "auth tudo processo_fontes" on public.processo_fontes;
create policy "auth tudo processo_fontes" on public.processo_fontes
  for all to authenticated using (true) with check (true);

drop policy if exists "auth tudo processo_movimentos" on public.processo_movimentos;
create policy "auth tudo processo_movimentos" on public.processo_movimentos
  for all to authenticated using (true) with check (true);

drop policy if exists "auth tudo processo_eventos" on public.processo_eventos;
create policy "auth tudo processo_eventos" on public.processo_eventos
  for all to authenticated using (true) with check (true);

-- ---------- 8h) migração: cria processos a partir das publicações existentes ----------
-- Idempotente: já rodou uma vez? na segunda, os dois índices únicos acima
-- barram a reinserção e o "where processo_id is null" barra o
-- religamento — então rodar de novo só pega o que ainda não foi ligado
-- (inclusive publicação nova que chegou depois da primeira migração).
--
-- Critério do status inicial (conservador de propósito): só nasce
-- confirmado quando já existe publicação daquele processo com caso_id
-- preenchido — ou seja, o escritório já tratou isso à mão antes da V3.
-- Todo o resto nasce em observação, pra passar pela triagem.
with normalizado as (
  select
    pub.processo,
    pub.processo_num,
    pub.tribunal, pub.orgao, pub.classe, pub.partes, pub.caso_id, pub.disponibilizada,
    public.normaliza_cnj(pub.processo_num) as cnj_norm
  from public.publicacoes pub
  where pub.processo is not null
),
grupos as (
  select
    processo as chave_processo,
    (array_agg(cnj_norm order by disponibilizada desc nulls last)
       filter (where length(cnj_norm) = 20))[1] as cnj_normalizado,
    (array_agg(processo_num order by disponibilizada desc nulls last))[1] as processo_num,
    (array_agg(tribunal     order by disponibilizada desc nulls last))[1] as tribunal,
    (array_agg(orgao        order by disponibilizada desc nulls last))[1] as orgao,
    (array_agg(classe       order by disponibilizada desc nulls last))[1] as classe,
    (array_agg(partes       order by disponibilizada desc nulls last))[1] as partes,
    (array_agg(caso_id      order by disponibilizada desc nulls last)
       filter (where caso_id is not null))[1] as caso_id,
    max(disponibilizada) as ultima,
    bool_or(caso_id is not null) as tem_caso_vinculado
  from normalizado
  group by processo
)
insert into public.processos
  (cnj_normalizado, processo_num, processo, tribunal, orgao, classe, partes,
   caso_id, status_triagem, origem, ultima_movimentacao, confirmado_em)
select
  g.cnj_normalizado, g.processo_num, g.chave_processo, g.tribunal, g.orgao, g.classe, g.partes,
  g.caso_id,
  case when g.tem_caso_vinculado then 'confirmado' else 'observacao' end,
  'djen',
  g.ultima::timestamptz,
  case when g.tem_caso_vinculado then now() else null end
from grupos g
on conflict do nothing;

update public.publicacoes pub
set processo_id = pr.id
from public.processos pr
where pub.processo_id is null
  and pub.processo is not null
  and pub.processo = pr.processo;

-- evento de auditoria pra cada processo que a migração criou (não gera
-- duplicata em reruns: só insere um evento 'dados_atualizados' de origem
-- migracao_v3 se ainda não existir um pra aquele processo).
insert into public.processo_eventos (processo_id, acao, origem, detalhe)
select p.id, 'dados_atualizados', 'migracao_v3', jsonb_build_object('status_triagem_inicial', p.status_triagem)
from public.processos p
where not exists (
  select 1 from public.processo_eventos e
  where e.processo_id = p.id and e.origem = 'migracao_v3'
);

-- ---------- 8i) processos_oab agora é view de compatibilidade ----------
-- O frontend atual lê `/rest/v1/processos_oab`. Em vez de quebrar essa
-- leitura enquanto a Fase 3 (tela nova) não chega, a view passa a olhar
-- pra `processos` — só que agora só mostra o que foi CONFIRMADO. O que
-- está em observação/ignorado aparece nas telas novas da Fase 2, não aqui.
drop view if exists public.processos_oab;
create or replace view public.processos_oab as
select
  p.processo,
  p.processo_num,
  p.tribunal,
  p.orgao,
  p.classe,
  p.partes,
  p.caso_id,
  coalesce(pf.publicacoes, 0) as publicacoes,
  pf.ultima,
  pf.primeira,
  coalesce(pf.nao_lidas, 0)  as nao_lidas
from public.processos p
left join lateral (
  select
    count(*)                              as publicacoes,
    max(pub.disponibilizada)              as ultima,
    min(pub.disponibilizada)              as primeira,
    count(*) filter (where not pub.lida)  as nao_lidas
  from public.publicacoes pub
  where pub.processo_id = p.id
) pf on true
where p.status_triagem = 'confirmado';

alter view public.processos_oab set (security_invoker = on);

-- ---------- 8j) view: processos em observação, com prioridade de revisão ----------
create or replace view public.processos_observacao as
select p.*
from public.processos p
where p.status_triagem = 'observacao'
order by
  case p.confianca_nivel when 'baixa' then 0 when 'media' then 1 when 'alta' then 2 else 3 end,
  p.criado_at desc;

alter view public.processos_observacao set (security_invoker = on);

-- ============================================================
-- 9) GMAIL — conta conectada e mensagens sincronizadas
-- ============================================================
-- Ao contrário do WhatsApp (que usa uma biblioteca não-oficial), o Gmail
-- tem API oficial e gratuita do Google, com login de verdade na tela do
-- Google — o advogado escolhe a própria conta, não dá pra conectar a
-- errada sem querer.
--
-- gmail_conta guarda o refresh_token do Google — equivale à senha
-- permanente do e-mail dele. Por isso, diferente de toda outra tabela
-- deste arquivo, ela FICA SEM policy nenhuma pra 'authenticated': RLS
-- ligada sem nenhuma policy = ninguém lê/escreve por fora do service
-- role. Só a Edge Function `gmail` (que usa a service role key) enxerga.
--
-- Linha única (igual `wpp_sessao`) — é uma conta de e-mail do escritório
-- por vez, não uma tabela multiusuário.
create table if not exists public.gmail_conta (
  id                    int primary key default 1 check (id = 1),
  usuario_id            uuid references auth.users(id),   -- quem conectou, pra auditoria
  email                 text not null,
  refresh_token         text not null,
  access_token          text,
  access_token_expira   timestamptz,
  history_id            text,              -- cursor do Gmail pra sync incremental (backfill já terminou quando isto existe)
  backfill_page_token   text,              -- página atual do backfill inicial, enquanto history_id ainda é nulo
  sincronizando         boolean not null default false,
  sincronizado_ate      timestamptz,
  conectado_em          timestamptz not null default now(),
  assinatura            text,              -- rodapé colado no fim de todo e-mail enviado pelo painel
  erro                  text
);
alter table public.gmail_conta enable row level security;

-- o conteúdo dos e-mails em si é dado de trabalho, não credencial — segue
-- o mesmo modelo do resto do app.
create table if not exists public.gmail_mensagens (
  id                  uuid primary key default gen_random_uuid(),
  gmail_id            text not null unique,
  thread_id           text not null,
  de                  text,
  para                text,
  assunto             text,
  previa              text,               -- snippet, pra lista carregar rápido
  corpo               text,               -- corpo completo, buscado sob demanda
  html                boolean not null default false,
  recebida_em         timestamptz,
  enviada_por_mim     boolean not null default false,
  labels              jsonb,              -- labelIds do Gmail (INBOX, SENT, TRASH, SPAM…) — dá pra separar por pasta
  analisada_ia        boolean not null default false,  -- já passou pela extração de datas? evita reprocessar
  caso_id             uuid references public.casos(id) on delete set null,
  criado_at           timestamptz not null default now()
);
create index if not exists gmail_msg_thread_idx   on public.gmail_mensagens (thread_id);
create index if not exists gmail_msg_recebida_idx on public.gmail_mensagens (recebida_em desc);
alter table public.gmail_mensagens add column if not exists labels jsonb;
alter table public.gmail_mensagens add column if not exists analisada_ia boolean not null default false;
alter table public.gmail_conta     add column if not exists assinatura text;

alter table public.gmail_mensagens enable row level security;
drop policy if exists "auth tudo gmail_mensagens" on public.gmail_mensagens;
create policy "auth tudo gmail_mensagens" on public.gmail_mensagens
  for all to authenticated using (true) with check (true);

-- ---------- cron: sincroniza a caixa a cada 5 minutos ----------
-- Mesmo padrão do bloco da seção 6 — descomentar e trocar <PROJETO> e
-- <CRON_SECRET> depois de aplicar este arquivo.
--
-- select cron.schedule('gmail-sincroniza', '*/5 * * * *', $$
--   select net.http_post(
--     url     := 'https://<PROJETO>.supabase.co/functions/v1/gmail',
--     headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
--     body    := '{"acao":"sincronizar"}'::jsonb
--   );
-- $$);
