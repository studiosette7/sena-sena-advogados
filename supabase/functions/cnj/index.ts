// ============================================================
// SENA & SENA — Edge Function "cnj"
//
// Varre o Diário de Justiça Eletrônico Nacional pelo número da OAB e
// grava as publicações novas. É o que substitui o JurisBrasil.
//
// Duas fontes públicas do CNJ, ambas sem contrato e sem mensalidade:
//
//   1. Comunica/DJEN  — intimações e publicações POR NÚMERO DE OAB.
//      Sem chave nenhuma. É a fonte principal.
//   2. DataJud        — a linha do tempo de UM processo, pelo número.
//      Chave pública fixa, publicada pelo próprio CNJ.
//
// Duas chamadas:
//   POST { acao: "varrer" }              → busca publicações novas
//   POST { acao: "andamento", processo } → linha do tempo do processo
//
// O DJEN responde o que você perguntar, mas nunca avisa sozinho. Por isso
// a varredura roda todo dia de madrugada (pg_cron, ver README) — é a
// varredura que transforma consulta em alerta.
//
// Deploy: npx supabase functions deploy cnj
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { normalizaCnj, cnjValido, calculaConfianca, type SinalConfianca } from "../_shared/processos.ts";
import { semAdditionalProperties, geraJson } from "../_shared/gemini.ts";

// Preencha com a OAB do advogado, ou defina os segredos OAB_NUMERO/OAB_UF.
const OAB_NUMERO = Deno.env.get("OAB_NUMERO") ?? "000000";
const OAB_UF     = Deno.env.get("OAB_UF") ?? "SP";

// Chave pública do DataJud, divulgada pelo CNJ. Não é segredo: está na
// documentação da API pública. Por isso fica no código, não em secret.
const DATAJUD_KEY =
  "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

/** O DataJud tem um endpoint por tribunal. A sigla vem na publicação. */
function endpointDataJud(tribunal: string): string | null {
  const t = String(tribunal || "").toLowerCase().trim();
  if (!/^[a-z]{2,6}\d*$/.test(t)) return null;   // nada de montar URL com lixo
  return `https://api-publica.datajud.cnj.jus.br/api_publica_${t}/_search`;
}

/** `dataAjuizamento` do DataJud vem compacta ("20251218000000",
 * yyyyMMddHHmmss) — a coluna `data_distribuicao` é `date` no Postgres, que
 * rejeita esse formato (`date/time field value out of range`). Sem essa
 * conversão o update falha inteiro e nem os outros campos do mesmo
 * `.update()` são gravados. */
function paraData(compacta: string | null | undefined): string | null {
  const s = String(compacta ?? "");
  if (!/^\d{8}/.test(s)) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** DataJud devolve `assuntos` como array de `{codigo, nome}` — a coluna
 * `processos.assunto` é `text` (singular), então junta os nomes numa
 * string só. */
function paraAssunto(assuntos: Array<{ nome?: string }> | null | undefined): string | null {
  if (!Array.isArray(assuntos) || !assuntos.length) return null;
  const nomes = assuntos.map((a) => a?.nome).filter(Boolean);
  return nomes.length ? nomes.join(", ") : null;
}

// ---------------------------------------------------------------
// Extração por IA: valor da causa, justiça gratuita, prioridades e
// audiências — quando estiverem escritos no texto das publicações do
// DJEN (nem sempre estão). Mesmo padrão de `advogado/index.ts` e
// `gmail/index.ts`: schema enxuto, sem additionalProperties.
// ---------------------------------------------------------------
const ESQUEMA_PROCESSO_EXTRA = semAdditionalProperties({
  type: "object",
  properties: {
    valor_causa: { type: "string", description: "Só o número, com ponto decimal, sem 'R$' nem separador de milhar (ex: 55170.07). Vazio se não estiver escrito." },
    justica_gratuita: { type: "string", enum: ["sim", "nao", "nao_mencionado"] },
    prioridades: { type: "array", items: { type: "string" }, description: "Ex: pessoa idosa, acidente de trabalho, assédio moral. Vazio se nenhuma." },
    audiencias: {
      type: "array",
      items: {
        type: "object",
        properties: {
          data: { type: "string", description: "AAAA-MM-DDTHH:MM, só se a data E hora estiverem escritas." },
          tipo: { type: "string", description: "conciliação, instrução, una, etc." },
          local: { type: "string" },
        },
        required: ["data", "tipo", "local"],
        additionalProperties: false,
      },
    },
  },
  required: ["valor_causa", "justica_gratuita", "prioridades", "audiencias"],
  additionalProperties: false,
});

/** Nunca derruba a chamada de `andamento` por causa disso — se faltar a
 * chave, se o texto for pobre, se o Gemini falhar, devolve tudo vazio e
 * a tela mostra "Não informado" como já mostraria de qualquer jeito. */
async function extraiDadosProcesso(textos: string[]): Promise<{
  valor_causa: number | null; justica_gratuita: boolean | null;
  prioridades: string[]; audiencias: Array<{ data: string; tipo: string; local: string }>;
}> {
  const vazio = { valor_causa: null, justica_gratuita: null, prioridades: [], audiencias: [] };
  const corpo = textos.join("\n\n---\n\n").slice(0, 8000).trim();
  if (!corpo) return vazio;

  const a = await geraJson({
    contents: [{
      role: "user",
      parts: [{
        text: `Publicações de um processo judicial (mais recente primeiro):\n\n${corpo}\n\n` +
          `Ache, só se estiver EXPLICITAMENTE escrito no texto acima: valor da causa, se foi ` +
          `deferida/pedida justiça gratuita, prioridades processuais (idoso, acidente de trabalho, ` +
          `assédio etc.) e audiências marcadas com data e hora. Nunca calcule ou deduza — se não ` +
          `estiver escrito, deixe vazio.`,
      }],
    }],
    generationConfig: {
      maxOutputTokens: 1500,
      responseMimeType: "application/json",
      responseSchema: ESQUEMA_PROCESSO_EXTRA,
    },
  }, (motivo) => console.error("extraiDadosProcesso:", motivo));

  if (!a) return vazio;
  const valor = a.valor_causa ? Number(a.valor_causa) : null;
  return {
    valor_causa: Number.isFinite(valor) ? valor : null,
    justica_gratuita: a.justica_gratuita === "sim" ? true : a.justica_gratuita === "nao" ? false : null,
    prioridades: Array.isArray(a.prioridades) ? a.prioridades : [],
    audiencias: Array.isArray(a.audiencias) ? a.audiencias : [],
  };
}

// ---------------------------------------------------------------
// Processos — a OAB achou a publicação, mas isso não confirma que o
// processo é do escritório. Toda descoberta nova nasce em observação;
// confirmado/ignorado são decisão humana e nunca regridem sozinhos aqui.
// Ver supabase/setup.sql seção 8 e a Edge Function `processos`.
// ---------------------------------------------------------------

interface CacheTriagem {
  nomesConhecidos: string[];
  tribunaisFrequentes: Set<string>;
}

/** Carregado uma vez por rodada de varredura — os sinais de confiança
 * comparam contra nomes/tribunais já conhecidos, não contra a publicação
 * isolada. */
async function carregaCacheTriagem(supabase: any): Promise<CacheTriagem> {
  const [{ data: casos }, { data: contatos }, { data: confirmados }] = await Promise.all([
    supabase.from("casos").select("nome"),
    supabase.from("contatos").select("nome"),
    supabase.from("processos").select("tribunal").eq("status_triagem", "confirmado"),
  ]);

  const nomesConhecidos = [
    ...(casos ?? []).map((c: any) => String(c.nome ?? "").toLowerCase().trim()),
    ...(contatos ?? []).map((c: any) => String(c.nome ?? "").toLowerCase().trim()),
  ].filter((n) => n.length >= 4);

  const contagem = new Map<string, number>();
  for (const p of confirmados ?? []) {
    if (!p.tribunal) continue;
    contagem.set(p.tribunal, (contagem.get(p.tribunal) ?? 0) + 1);
  }
  const tribunaisFrequentes = new Set(
    [...contagem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t),
  );

  return { nomesConhecidos, tribunaisFrequentes };
}

/** Sinais objetivos, calculados no backend — a IA não entra nessa conta.
 * O score só prioriza a fila de revisão, nunca decide status sozinho. */
function calculaSinaisDescoberta(
  linha: { tribunal: string | null; partes: unknown },
  cache: CacheTriagem,
  contagens: { qtdFontes: number; qtdPublicacoes: number },
): SinalConfianca[] {
  const sinais: SinalConfianca[] = [
    { sinal: "oab_busca", peso: 10, motivo: "Publicação encontrada pela OAB configurada" },
  ];

  const partesTexto = JSON.stringify(linha.partes ?? "").toLowerCase();
  const bateNome = cache.nomesConhecidos.some((n) => partesTexto.includes(n));
  if (bateNome) {
    sinais.push({ sinal: "nome_conhecido", peso: 35, motivo: "Nome de parte compatível com cliente/contato já cadastrado" });
  }

  if (linha.tribunal && cache.tribunaisFrequentes.has(linha.tribunal)) {
    sinais.push({ sinal: "tribunal_frequente", peso: 20, motivo: "Tribunal recorrente na carteira já confirmada" });
  }

  if (contagens.qtdPublicacoes > 1) {
    sinais.push({
      sinal: "multiplas_publicacoes", peso: 15,
      motivo: `${contagens.qtdPublicacoes} publicações já recebidas deste processo`,
    });
  }

  if (contagens.qtdFontes > 1) {
    sinais.push({ sinal: "multiplas_fontes", peso: 20, motivo: "Confirmado por mais de uma fonte oficial" });
  }

  return sinais;
}

async function buscaProcessoExistente(supabase: any, linha: any, cnjNorm: string | null, valido: boolean) {
  const q = valido
    ? supabase.from("processos").select("*").eq("cnj_normalizado", cnjNorm)
    : supabase.from("processos").select("*").eq("processo", linha.processo).is("cnj_normalizado", null);
  const { data } = await q.maybeSingle();
  return data;
}

async function criaProcesso(supabase: any, linha: any, cnjNorm: string | null, valido: boolean, cache: CacheTriagem) {
  const conf = calculaConfianca(calculaSinaisDescoberta(linha, cache, { qtdFontes: 0, qtdPublicacoes: 1 }));

  const { data: criado, error } = await supabase.from("processos").insert({
    cnj_normalizado: valido ? cnjNorm : null,
    processo_num: linha.processo_num,
    processo: linha.processo,
    tribunal: linha.tribunal,
    orgao: linha.orgao,
    classe: linha.classe,
    partes: linha.partes,
    advogados: linha.advogados,
    origem: "djen",
    status_triagem: "observacao",
    ultima_movimentacao: linha.disponibilizada ? new Date(linha.disponibilizada).toISOString() : null,
    confianca_nivel: conf.nivel,
    confianca_score: conf.score,
    confianca_sinais: conf.sinais,
  }).select("*").single();

  if (!error && criado) {
    await supabase.from("processo_eventos").insert({
      processo_id: criado.id, acao: "encontrado", origem: "djen",
      detalhe: { processo: linha.processo, confianca: conf.nivel },
    });
    return criado;
  }

  // corrida (duas varreduras ao mesmo tempo) — alguém já criou; reaproveita
  const existente = await buscaProcessoExistente(supabase, linha, cnjNorm, valido);
  if (existente) return existente;
  throw error;
}

async function atualizaProcessoExistente(supabase: any, processo: any, linha: any, cache: CacheTriagem) {
  const patch: Record<string, unknown> = {
    processo: linha.processo ?? processo.processo,
    processo_num: linha.processo_num ?? processo.processo_num,
    tribunal: linha.tribunal ?? processo.tribunal,
    orgao: linha.orgao ?? processo.orgao,
    classe: linha.classe ?? processo.classe,
    partes: linha.partes ?? processo.partes,
    advogados: linha.advogados ?? processo.advogados,
  };

  const novaData = linha.disponibilizada ? new Date(linha.disponibilizada) : null;
  if (novaData && (!processo.ultima_movimentacao || novaData > new Date(processo.ultima_movimentacao))) {
    patch.ultima_movimentacao = novaData.toISOString();
  }

  // status_triagem NUNCA muda aqui — confirmado fica confirmado, ignorado
  // fica ignorado. Só quem está em observação ganha confiança recalculada,
  // porque é a única fila que o advogado ainda vai revisar.
  if (processo.status_triagem === "observacao") {
    const [{ count: qtdFontes }, { count: qtdPublicacoes }] = await Promise.all([
      supabase.from("processo_fontes").select("fonte", { count: "exact", head: true }).eq("processo_id", processo.id),
      supabase.from("publicacoes").select("id_cnj", { count: "exact", head: true }).eq("processo_id", processo.id),
    ]);
    const conf = calculaConfianca(calculaSinaisDescoberta(linha, cache, {
      qtdFontes: (qtdFontes ?? 0) + 1,
      qtdPublicacoes: (qtdPublicacoes ?? 0) + 1,
    }));
    patch.confianca_nivel = conf.nivel;
    patch.confianca_score = conf.score;
    patch.confianca_sinais = conf.sinais;
  }

  await supabase.from("processos").update(patch).eq("id", processo.id);
}

async function upsertFonte(supabase: any, processoId: string, item: any) {
  await supabase.from("processo_fontes").upsert({
    processo_id: processoId,
    fonte: "djen",
    id_externo: String(item.id),
    dados: item,
    ultima_vez: new Date().toISOString(),
  }, { onConflict: "processo_id,fonte,id_externo" });
}

async function varrer(supabase: any) {
  // Só os últimos 30 dias: rodando todo dia, isso cobre com folga e evita
  // puxar as 884 publicações históricas a cada madrugada.
  const ate    = new Date();
  const desde  = new Date(ate.getTime() - 30 * 86400000);
  const fmt    = (d: Date) => d.toISOString().slice(0, 10);

  let pagina = 1, achadas = 0, novas = 0;
  const porPagina = 100;
  const cache = await carregaCacheTriagem(supabase);

  while (pagina <= 20) {   // teto de segurança: 2.000 publicações por rodada
    const url = new URL("https://comunicaapi.pje.jus.br/api/v1/comunicacao");
    url.searchParams.set("numeroOab", OAB_NUMERO);
    url.searchParams.set("ufOab", OAB_UF);
    url.searchParams.set("dataDisponibilizacaoInicio", fmt(desde));
    url.searchParams.set("dataDisponibilizacaoFim", fmt(ate));
    url.searchParams.set("pagina", String(pagina));
    url.searchParams.set("itensPorPagina", String(porPagina));

    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) return { erro: `DJEN respondeu ${r.status}`, achadas, novas };

    const dados = await r.json();
    const itens = dados?.items ?? [];
    if (!itens.length) break;
    achadas += itens.length;

    const linhas = itens.map((i: any) => ({
      id_cnj:          i.id,
      disponibilizada: i.data_disponibilizacao ?? null,
      tribunal:        i.siglaTribunal ?? null,
      orgao:           i.nomeOrgao ?? null,
      classe:          i.nomeClasse ?? null,
      tipo:            i.tipoComunicacao ?? null,
      processo:        i.numeroprocessocommascara ?? null,
      processo_num:    i.numero_processo ?? null,
      texto:           i.texto ?? null,
      link:            i.link ?? null,
      partes:          i.destinatarios ?? null,
      // Lista solta de advogados da comunicação — o DJEN não diz de qual
      // polo é cada um (ver heurística de agrupamento no front, em
      // agrupaAdvogadosPorPolo()).
      advogados: (i.destinatarioadvogados ?? [])
        .map((a: any) => ({ nome: a.advogado?.nome ?? null, oab: a.advogado?.numero_oab ?? null, uf: a.advogado?.uf_oab ?? null }))
        .filter((a: any) => a.nome) || null,
      processo_id:     null as string | null,
    }));

    // Acha ou cria o processo de cada publicação ANTES de gravar a
    // publicação em si — é isso que faz `publicacoes.processo_id` já
    // nascer preenchido, sem passe extra depois.
    for (let idx = 0; idx < linhas.length; idx++) {
      const linha = linhas[idx];
      const cnjNorm = normalizaCnj(linha.processo_num);
      const valido = cnjValido(cnjNorm);
      // sem processo mascarado nem CNJ válido não dá pra vincular a nada
      // (mesma exigência que a antiga view `processos_oab` já tinha)
      if (!linha.processo && !valido) continue;

      let processo = await buscaProcessoExistente(supabase, linha, cnjNorm, valido);
      if (!processo) processo = await criaProcesso(supabase, linha, cnjNorm, valido, cache);
      else await atualizaProcessoExistente(supabase, processo, linha, cache);

      await upsertFonte(supabase, processo.id, itens[idx]);
      linha.processo_id = processo.id;
    }

    // `ignoreDuplicates` faz o trabalho de "só o que é novo": o id_cnj é a
    // chave primária, então republicação do mesmo ato não vira linha nova
    // nem apaga o `lida` que ele já tinha marcado. `processo_id`, porém,
    // só entra em `publicacoes` novas por causa do ignoreDuplicates — uma
    // publicação já existente sem processo_id (dado migrado antes da V3)
    // é atualizada à parte no passo seguinte.
    // `advogados` só existe em `processos` (cache pra tela de detalhe) —
    // `publicacoes` não tem essa coluna, então não pode ir nesse upsert.
    const linhasPub = linhas.map(({ advogados: _advogados, ...resto }: any) => resto);
    const { error, count } = await supabase
      .from("publicacoes")
      .upsert(linhasPub, { onConflict: "id_cnj", ignoreDuplicates: true, count: "exact" });

    if (error) return { erro: error.message, achadas, novas };
    novas += count ?? 0;

    // `processo_id` precisa chegar tanto na publicação nova quanto na que
    // já existia de antes da V3 (o upsert acima, por usar ignoreDuplicates,
    // não regrava linha já existente). Upsert enxuto — só id_cnj e
    // processo_id — não toca em nenhuma outra coluna (texto, lida, etc.).
    const vinculos = linhas
      .filter((l) => l.processo_id)
      .map((l) => ({ id_cnj: l.id_cnj, processo_id: l.processo_id }));
    if (vinculos.length) {
      await supabase.from("publicacoes").upsert(vinculos, { onConflict: "id_cnj" });
    }

    if (itens.length < porPagina) break;
    pagina++;
  }

  return { achadas, novas };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "método não permitido" }, 405);

  const autorizacao = req.headers.get("Authorization") ?? "";
  const cron = req.headers.get("x-cron-secret");
  const segredoCron = Deno.env.get("CRON_SECRET");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    // A varredura roda sem usuário logado (é o cron que chama), então
    // precisa da service role pra gravar. Ela nunca sai daqui.
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Duas portas: o cron entra pelo segredo, o o advogado entra logado.
  const viaCron = !!(segredoCron && cron && cron === segredoCron);
  if (!viaCron) {
    if (!autorizacao.startsWith("Bearer ")) return json({ erro: "não autenticado" }, 401);
    const comToken = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: autorizacao } } },
    );
    const { data, error } = await comToken.auth.getUser();
    if (error || !data?.user) return json({ erro: "não autenticado" }, 401);
  }

  let corpo: { acao?: string; processo?: string; tribunal?: string; processo_id?: string };
  try { corpo = await req.json(); } catch { corpo = {}; }

  // ---------- varredura do DJEN ----------
  if (!corpo.acao || corpo.acao === "varrer") {
    try {
      return json({ ok: true, ...(await varrer(supabase)) });
    } catch (e) {
      return json({ erro: "falha ao varrer o DJEN", detalhe: String(e) }, 502);
    }
  }

  // ---------- linha do tempo de um processo ----------
  // Enriquecimento sob demanda: o DataJud não descobre processo novo (não
  // busca por OAB), só traz a linha do tempo de UM processo já conhecido.
  // Quando o pedido vem com `processo_id` (a tela do processo manda), o
  // resultado é gravado em processo_movimentos/processo_fontes, não só
  // devolvido pra tela — assim a IA e a timeline unificada enxergam isso
  // depois sem precisar chamar o DataJud de novo.
  if (corpo.acao === "andamento") {
    const num = String(corpo.processo || "").replace(/\D/g, "");
    if (num.length !== 20) return json({ erro: "número de processo inválido" }, 400);

    const endpoint = endpointDataJud(corpo.tribunal || "");
    if (!endpoint) return json({ erro: "informe a sigla do tribunal" }, 400);

    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `APIKey ${DATAJUD_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: { match: { numeroProcesso: num } }, size: 1 }),
      });
      if (!r.ok) return json({ erro: `DataJud respondeu ${r.status}` }, 502);

      const dados = await r.json();
      const fonte = dados?.hits?.hits?.[0]?._source;
      if (!fonte) return json({ ok: true, encontrado: false, movimentos: [] });

      const movimentos = (fonte.movimentos ?? [])
        .map((m: any) => ({ quando: m.dataHora ?? null, nome: m.nome ?? null }))
        .sort((a: any, b: any) => String(b.quando).localeCompare(String(a.quando)));

      const processoId = typeof corpo.processo_id === "string" ? corpo.processo_id : null;
      if (processoId) {
        await supabase.from("processo_fontes").upsert({
          processo_id: processoId,
          fonte: "datajud",
          id_externo: num,
          dados: { classe: fonte.classe?.nome, orgao: fonte.orgaoJulgador?.nome, ajuizamento: fonte.dataAjuizamento, assuntos: fonte.assuntos },
          ultima_vez: new Date().toISOString(),
        }, { onConflict: "processo_id,fonte,id_externo" });

        if (movimentos.length) {
          const linhasMov = movimentos
            .filter((m: any) => m.quando && m.nome)
            .map((m: any) => ({
              processo_id: processoId,
              data_movimento: m.quando,
              descricao: m.nome,
              fonte: "datajud",
              id_externo: `${m.quando}|${m.nome}`.slice(0, 500),
              dados: m,
            }));
          if (linhasMov.length) {
            await supabase.from("processo_movimentos")
              .upsert(linhasMov, { onConflict: "processo_id,fonte,id_externo" });
          }
        }

        // Edição manual do advogado sempre vence a extração por IA — só
        // preenche o que ainda estiver vazio no banco. Por isso precisa
        // ler o processo atual antes de decidir o que a IA pode tocar.
        const { data: processoAtual } = await supabase.from("processos")
          .select("valor_causa, justica_gratuita, prioridades, audiencias").eq("id", processoId).single();

        const { data: publicacoesLigadas } = await supabase.from("publicacoes")
          .select("texto").eq("processo_id", processoId).order("disponibilizada", { ascending: false }).limit(15);
        const extra = await extraiDadosProcesso((publicacoesLigadas ?? []).map((p: any) => p.texto).filter(Boolean));

        const { error: erroUpdate } = await supabase.from("processos").update({
          ultima_movimentacao: movimentos[0]?.quando ?? undefined,
          data_distribuicao: paraData(fonte.dataAjuizamento) ?? undefined,
          classe: fonte.classe?.nome ?? undefined,
          orgao: fonte.orgaoJulgador?.nome ?? undefined,
          assunto: paraAssunto(fonte.assuntos) ?? undefined,
          valor_causa: processoAtual?.valor_causa ?? extra.valor_causa ?? undefined,
          justica_gratuita: processoAtual?.justica_gratuita ?? extra.justica_gratuita ?? undefined,
          prioridades: (processoAtual?.prioridades?.length ? processoAtual.prioridades : null) ?? (extra.prioridades.length ? extra.prioridades : undefined),
          audiencias: (processoAtual?.audiencias?.length ? processoAtual.audiencias : null) ?? (extra.audiencias.length ? extra.audiencias : undefined),
        }).eq("id", processoId);
        if (erroUpdate) console.error("processos.update (andamento):", erroUpdate.message);
      }

      return json({
        ok: true,
        encontrado: true,
        classe:      fonte.classe?.nome ?? null,
        orgao:       fonte.orgaoJulgador?.nome ?? null,
        ajuizamento: fonte.dataAjuizamento ?? null,
        assunto:     paraAssunto(fonte.assuntos),
        movimentos,
      });
    } catch (e) {
      return json({ erro: "falha ao consultar o DataJud", detalhe: String(e) }, 502);
    }
  }

  return json({ erro: "ação desconhecida" }, 400);
});
