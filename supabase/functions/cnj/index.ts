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

const OAB_NUMERO = "417105";
const OAB_UF     = "SP";

// Chave pública do DataJud, divulgada pelo CNJ. Não é segredo: está na
// documentação da API pública. Por isso fica no código, não em secret.
const DATAJUD_KEY =
  "cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
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

async function varrer(supabase: any) {
  // Só os últimos 30 dias: rodando todo dia, isso cobre com folga e evita
  // puxar as 884 publicações históricas a cada madrugada.
  const ate    = new Date();
  const desde  = new Date(ate.getTime() - 30 * 86400000);
  const fmt    = (d: Date) => d.toISOString().slice(0, 10);

  let pagina = 1, achadas = 0, novas = 0;
  const porPagina = 100;

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
    }));

    // `ignoreDuplicates` faz o trabalho de "só o que é novo": o id_cnj é a
    // chave primária, então republicação do mesmo ato não vira linha nova
    // nem apaga o `lida` que ele já tinha marcado.
    const { error, count } = await supabase
      .from("publicacoes")
      .upsert(linhas, { onConflict: "id_cnj", ignoreDuplicates: true, count: "exact" });

    if (error) return { erro: error.message, achadas, novas };
    novas += count ?? 0;

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

  // Duas portas: o cron entra pelo segredo, o Gildemi entra logado.
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

  let corpo: { acao?: string; processo?: string; tribunal?: string };
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

      return json({
        ok: true,
        encontrado: true,
        classe:      fonte.classe?.nome ?? null,
        orgao:       fonte.orgaoJulgador?.nome ?? null,
        ajuizamento: fonte.dataAjuizamento ?? null,
        movimentos,
      });
    } catch (e) {
      return json({ erro: "falha ao consultar o DataJud", detalhe: String(e) }, 502);
    }
  }

  return json({ erro: "ação desconhecida" }, 400);
});
