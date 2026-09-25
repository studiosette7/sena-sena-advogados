// ============================================================
// SENA & SENA — Edge Function "kapso-webhook"
//
// Recebe as mensagens do WhatsApp pelo Kapso (que é BSP da Cloud API
// oficial da Meta) e grava nas MESMAS tabelas que a ponte do Baileys
// alimentava — `contatos`, `conversas_wpp`, `mensagens_wpp`. A tela do
// WhatsApp no painel não muda: só troca quem enche as tabelas.
//
// Por que é uma function separada e pública (--no-verify-jwt): quem bate
// aqui é o servidor do Kapso, que não manda Authorization do Supabase.
// Quem garante a autenticidade é a assinatura HMAC do corpo da requisição
// (X-Webhook-Signature), conferida com KAPSO_WEBHOOK_SECRET.
//
// Deploy: npx supabase functions deploy kapso-webhook --no-verify-jwt
// Segredo: npx supabase secrets set KAPSO_WEBHOOK_SECRET=...
//   (o mesmo valor colado na configuração do webhook lá no Kapso)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const KAPSO_WEBHOOK_SECRET = Deno.env.get("KAPSO_WEBHOOK_SECRET") ?? "";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Compara sem vazar tempo: `===` em string sai mais cedo no primeiro
 * caractere diferente, e isso dá pra medir pra adivinhar a assinatura. */
function igualSemVazarTempo(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

/** A assinatura é feita sobre os BYTES CRUS do corpo. Não dá pra
 * `JSON.parse` e reserializar antes de conferir: ordem de chave, espaço
 * e escape de unicode mudam, e a conferência quebra. */
async function assinaturaConfere(corpoCru: string, assinatura: string): Promise<boolean> {
  if (!KAPSO_WEBHOOK_SECRET || !assinatura) return false;
  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(KAPSO_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(corpoCru));
  const esperada = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // aceita com e sem o prefixo "sha256=", que varia entre provedores
  const recebida = assinatura.replace(/^sha256=/i, "").trim().toLowerCase();
  return igualSemVazarTempo(esperada, recebida);
}

/** Só dígitos, do jeito que `contatos.telefone` já guarda (a ponte do
 * Baileys gravava assim, e a tela formata na hora de exibir). */
function soDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Acha ou cria o contato e a conversa dele — mesma lógica que a ponte
 * usava, pra tela não notar diferença. */
async function achaOuCria(supabase: any, telefone: string, nomeWpp: string | null) {
  const { data: existente } = await supabase
    .from("contatos").select("id, nome_wpp").eq("telefone", telefone).maybeSingle();

  let contatoId = existente?.id ?? null;
  if (!contatoId) {
    const { data: novo, error } = await supabase
      .from("contatos").insert({ telefone, nome_wpp: nomeWpp || null })
      .select("id").single();
    if (error) throw new Error(`contatos.insert: ${error.message}`);
    contatoId = novo.id;
  } else if (nomeWpp && existente.nome_wpp !== nomeWpp) {
    await supabase.from("contatos").update({ nome_wpp: nomeWpp }).eq("id", contatoId);
  }

  const { data: conversa } = await supabase
    .from("conversas_wpp").select("id, nao_lidas").eq("contato_id", contatoId).maybeSingle();
  if (conversa) return { contatoId, conversaId: conversa.id, naoLidas: conversa.nao_lidas ?? 0 };

  const { data: nova, error: erroConversa } = await supabase
    .from("conversas_wpp").insert({ contato_id: contatoId }).select("id").single();
  if (erroConversa) throw new Error(`conversas_wpp.insert: ${erroConversa.message}`);
  return { contatoId, conversaId: nova.id, naoLidas: 0 };
}

/** O Kapso entrega o texto em `text.body` nas mensagens simples e em
 * `kapso.content` como versão achatada dos outros tipos (botão, lista,
 * legenda de mídia). Áudio ainda pode trazer transcrição. */
function extraiTexto(m: any): string {
  return m?.text?.body
    ?? m?.kapso?.content
    ?? m?.kapso?.transcript?.text
    ?? "";
}

function extraiTipo(m: any): string {
  const t = String(m?.type ?? "").toLowerCase();
  if (!t || t === "text") return "texto";
  if (t === "image") return "imagem";
  if (t === "audio" || t === "voice") return "audio";
  if (t === "video") return "video";
  if (t === "document") return "documento";
  return t;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ erro: "método não permitido" }, 405);

  // Precisa do corpo cru pra conferir a assinatura — ler como texto e só
  // depois dar parse.
  const corpoCru = await req.text();
  const assinatura = req.headers.get("X-Webhook-Signature") ?? "";

  if (!KAPSO_WEBHOOK_SECRET) {
    console.error("KAPSO_WEBHOOK_SECRET não configurada — recusando tudo");
    return json({ erro: "webhook não configurado" }, 500);
  }

  const confere = await assinaturaConfere(corpoCru, assinatura);

  // DIAGNÓSTICO TEMPORÁRIO — os logs de function não saem pela API de
  // management, então toda batida fica registrada aqui até a integração
  // estar de pé. Remover (e dropar a tabela) depois.
  try {
    const cabecalhos: Record<string, string> = {};
    for (const [k, v] of req.headers) {
      // a assinatura entra truncada só pra comparar prefixo, nunca inteira
      cabecalhos[k] = k.toLowerCase() === "x-webhook-signature" ? String(v).slice(0, 12) + "…" : v;
    }
    await createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
      .from("kapso_debug").insert({
        assinatura_ok: confere,
        cabecalhos,
        corpo: corpoCru.slice(0, 4000),
      });
  } catch { /* diagnóstico nunca pode derrubar o webhook */ }

  if (!confere) return json({ erro: "assinatura inválida" }, 401);

  let recebido: any;
  try { recebido = JSON.parse(corpoCru); } catch { return json({ erro: "corpo inválido" }, 400); }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    // grava sem usuário logado: quem chama é o Kapso, não o painel
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Com o buffer ligado no Kapso (janela de 5s), várias mensagens chegam
  // numa chamada só, embrulhadas em { type, batch: true, data: [...] }.
  // Sem buffer, o evento vem solto no corpo. Aceita os dois.
  const emLote = recebido?.batch === true || req.headers.get("X-Webhook-Batch") === "true";
  const eventos: any[] = emLote ? (recebido?.data ?? []) : [recebido];
  const tipoDoEnvelope = req.headers.get("X-Webhook-Event") ?? recebido?.type ?? recebido?.event ?? "";

  const resultados = { gravadas: 0, ignoradas: 0, erros: [] as string[] };

  for (const evento of eventos) {
    const tipoEvento = evento?.event ?? evento?.type ?? tipoDoEnvelope;
    // `whatsapp.message.received` = cliente escreveu.
    // `whatsapp.message.sent`    = eco do que saiu (inclusive do celular
    //                               dele, por causa da coexistência).
    if (!/^whatsapp\.message\.(received|sent)$/.test(String(tipoEvento))) {
      resultados.ignoradas++;
      continue;
    }
    try {
      await gravaEvento(supabase, evento);
      resultados.gravadas++;
    } catch (e) {
      // Uma mensagem estranha no lote não pode derrubar as outras.
      console.error("kapso-webhook:", String(e));
      resultados.erros.push(String(e));
    }
  }

  // Erro em tudo devolve 500 pro Kapso reenviar; sucesso parcial fica 200
  // (reenviar o lote inteiro duplicaria o que já entrou — o `id_wpp` único
  // protege, mas não há por que pedir retrabalho).
  if (resultados.erros.length && !resultados.gravadas) {
    return json({ erro: resultados.erros[0] }, 500);
  }
  return json({ ok: true, ...resultados });
});

/** Grava um evento de mensagem nas tabelas que a tela do WhatsApp lê. */
async function gravaEvento(supabase: any, evento: any) {
  const m = evento?.message ?? {};
  const conversa = evento?.conversation ?? {};
  const deMim = String(m?.kapso?.direction ?? "") === "outbound";

  // Em mensagem recebida o telefone do cliente vem em `from`; na enviada,
  // em `to`. O `conversation.phone_number` cobre os dois, mas a doc avisa
  // pra não assumir que sempre vem — daí a cascata.
  const telefone = soDigitos(deMim ? (m.to ?? conversa.phone_number) : (m.from ?? conversa.phone_number));
  if (!telefone) return;

  const { conversaId, naoLidas } = await achaOuCria(supabase, telefone, conversa.contact_name ?? null);

  const texto = extraiTexto(m);
  const quando = m.timestamp
    ? new Date(Number(m.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  // `id_wpp` é único: se o Kapso reenviar o mesmo evento (a doc avisa que
  // acontece, e por isso manda o X-Idempotency-Key), o upsert não duplica.
  const { error: erroMsg } = await supabase.from("mensagens_wpp").upsert({
    conversa_id: conversaId,
    id_wpp: m.id ?? null,
    de_mim: deMim,
    tipo: extraiTipo(m),
    texto: texto || null,
    midia_url: m?.kapso?.media_url ?? null,
    entregue: deMim,
    criado_at: quando,
  }, { onConflict: "id_wpp", ignoreDuplicates: true });
  if (erroMsg) throw new Error(`mensagens_wpp.upsert: ${erroMsg.message}`);

  const previa = (deMim ? "Você: " : "") + String(texto || "[mídia]").slice(0, 120);
  await supabase.from("conversas_wpp").update({
    ultima_at: quando,
    ultima_previa: previa,
    nao_lidas: deMim ? 0 : naoLidas + 1,
  }).eq("id", conversaId);
}
