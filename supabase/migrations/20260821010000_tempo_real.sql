-- ============================================================
-- Liga o tempo real nas tabelas que o painel escuta.
--
-- É o que faz mensagem nova do WhatsApp, lead novo do site e
-- publicação nova do Diário aparecerem na tela sem recarregar.
-- Sem isto o painel funciona, mas relendo a cada 20 segundos.
--
-- `add table` estoura se a tabela já estiver na publicação, então
-- cada uma vai dentro de um bloco que engole esse erro específico —
-- assim este arquivo pode rodar quantas vezes for preciso.
-- ============================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'casos', 'tarefas', 'publicacoes', 'contatos',
    'conversas_wpp', 'mensagens_wpp', 'wpp_sessao',
    'movimentacoes', 'documentos', 'mensagens'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
      raise notice 'tempo real ligado: %', t;
    exception
      when duplicate_object then raise notice 'ja estava ligado: %', t;
      when undefined_object then raise notice 'publicacao nao existe ainda: %', t;
    end;
  end loop;
end $$;

-- O Realtime só entrega a linha inteira no UPDATE se a tabela guardar
-- a versão anterior. Sem isso, o painel recebe update sem os campos.
alter table public.wpp_sessao    replica identity full;
alter table public.conversas_wpp replica identity full;
alter table public.casos         replica identity full;
