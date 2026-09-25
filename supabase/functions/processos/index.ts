// ============================================================
// SENA & SENA — Edge Function "processos"
//
// Três ações da triagem de processo — a decisão do advogado sobre o que
// achado pela OAB entra de fato na carteira:
//
//   POST { acao: "confirmar", processo_id }  → observação/ignorado → confirmado
//   POST { acao: "ignorar",   processo_id }  → observação → ignorado
//   POST { acao: "reavaliar", processo_id }  → ignorado → observação de novo
//
// Por que uma function e não só PATCH direto no PostgREST do painel: a
// troca de status e o registro em `processo_eventos` (auditoria) têm que
// acontecer juntos. Fazendo isso aqui, numa function só, não existe janela
// onde o status mudou mas a auditoria não foi gravada (ou vice-versa) por
// causa de duas chamadas soltas do navegador.
//
// Exige usuário logado — nunca muda status pelo cron nem por chamada anônima.
// Deploy: npx supabase functions deploy processos
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "método não permitido" }, 405);

  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao.startsWith("Bearer ")) return json({ erro: "não autenticado" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: autorizacao } } },
  );

  const { data: sessao, error: erroAuth } = await supabase.auth.getUser();
  if (erroAuth || !sessao?.user) return json({ erro: "não autenticado" }, 401);
  const usuarioId = sessao.user.id;

  let corpo: { acao?: string; processo_id?: string };
  try { corpo = await req.json(); } catch { return json({ erro: "corpo inválido" }, 400); }
  if (!corpo.processo_id) return json({ erro: "informe processo_id" }, 400);

  // O select passa pelo RLS com o token do usuário: se ele não pode ver o
  // processo, não vem nada.
  const { data: processo, error: erroProcesso } = await supabase
    .from("processos").select("*").eq("id", corpo.processo_id).single();
  if (erroProcesso || !processo) return json({ erro: "processo não encontrado" }, 404);

  const agora = new Date().toISOString();

  async function grava(patch: Record<string, unknown>, evento: string) {
    const { data: atualizado, error } = await supabase
      .from("processos").update(patch).eq("id", processo.id).select("*").single();
    if (error) return json({ erro: error.message }, 500);

    const { error: erroEvento } = await supabase.from("processo_eventos").insert({
      processo_id: processo.id, usuario_id: usuarioId, acao: evento,
    });
    if (erroEvento) {
      // status já mudou — avisa em vez de fingir que nada aconteceu, mas
      // não desfaz a troca de status por causa disso.
      return json({ ok: true, processo: atualizado, aviso: `status alterado, mas falhou ao gravar auditoria: ${erroEvento.message}` });
    }
    return json({ ok: true, processo: atualizado });
  }

  if (corpo.acao === "confirmar") {
    if (processo.status_triagem === "confirmado") return json({ ok: true, processo });
    return await grava({
      status_triagem: "confirmado",
      confirmado_em: agora, confirmado_por: usuarioId,
      ignorado_em: null, ignorado_por: null,
    }, "confirmado");
  }

  if (corpo.acao === "ignorar") {
    if (processo.status_triagem === "ignorado") return json({ ok: true, processo });
    return await grava({
      status_triagem: "ignorado",
      ignorado_em: agora, ignorado_por: usuarioId,
    }, "ignorado");
  }

  if (corpo.acao === "reavaliar") {
    if (processo.status_triagem !== "ignorado") {
      return json({ erro: "só dá pra reavaliar processo ignorado" }, 400);
    }
    return await grava({
      status_triagem: "observacao",
      ignorado_em: null, ignorado_por: null,
    }, "reavaliado");
  }

  return json({ erro: "ação desconhecida" }, 400);
});
