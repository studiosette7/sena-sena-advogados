-- Cache do DJEN: advogados envolvidos na comunicação, sem amarração a polo
-- (o DJEN não informa qual advogado representa qual parte).
alter table public.processos add column if not exists advogados jsonb;
