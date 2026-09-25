// ============================================================
// SENA & SENA — Edge Function "gmail"
//
// Ações autenticadas da integração com o Gmail (a troca do código do
// Google por token acontece na function separada "gmail-callback",
// porque o redirect do Google chega sem Authorization — ver lá).
//
//   POST { acao: "status" }                 → conectado? qual e-mail?
//   POST { acao: "auth-url" }                → monta a URL de consentimento do Google
//   POST { acao: "sincronizar" }              → backfill (por página) ou sync incremental
//   POST { acao: "mensagem", gmail_id }       → corpo completo de um e-mail
//   POST { acao: "enviar", ... }              → manda um e-mail (novo ou resposta)
//   POST { acao: "desconectar" }              → apaga a conta conectada
//
// "sincronizar" também aceita o segredo do cron (x-cron-secret), igual
// `cnj` — assim tanto o botão do painel quanto o pg_cron disparam a mesma
// ação. As demais ações exigem usuário logado de verdade.
//
// Deploy: npx supabase functions deploy gmail
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assinaEstado, base64url } from "../_shared/gmailAuth.ts";
import { semAdditionalProperties, geraJson } from "../_shared/gemini.ts";

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

const GOOGLE_CLIENT_ID     = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const GOOGLE_STATE_SECRET  = Deno.env.get("GOOGLE_STATE_SECRET") ?? "";
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;

const ESQUEMA_DATAS_EMAIL = semAdditionalProperties({
  type: "object",
  properties: {
    datas: {
      type: "array",
      description: "Datas com consequência prática mencionadas no e-mail: prazo, audiência, reunião, tarefa. Vazio se não houver nenhuma.",
      items: {
        type: "object",
        properties: {
          data: { type: "string", description: "AAAA-MM-DD. Só se estiver explícita ou inequivocamente calculável no texto do e-mail." },
          titulo: { type: "string" },
          tipo: { type: "string", enum: ["audiencia", "prazo", "reuniao", "tarefa"] },
        },
        required: ["data", "titulo", "tipo"],
        additionalProperties: false,
      },
    },
  },
  required: ["datas"],
  additionalProperties: false,
});

/** Lê o e-mail em busca de data com consequência prática — mesma ideia da
 * análise de documento que o `advogado` já faz, só que aqui roda sozinho
 * durante a sincronização (o Rodrigo pediu pra criar direto na agenda,
 * sem passar por confirmação). Nunca derruba a sincronização por causa
 * disso: qualquer falha aqui devolve lista vazia. */
async function analisaDatasEmail(assunto: string, corpoTexto: string): Promise<Array<{ data: string; titulo: string; tipo: string }>> {
  if (!corpoTexto) return [];

  const analise = await geraJson({
    contents: [{
      role: "user",
      parts: [{
        text: `Assunto: ${assunto || "(sem assunto)"}\n\n${corpoTexto.slice(0, 6000)}\n\n` +
          `Ache datas com consequência prática (prazo, audiência, reunião, tarefa) mencionadas ` +
          `nesse e-mail de um escritório de advocacia. Só extraia data que esteja escrita ou seja ` +
          `inequivocamente calculável no texto — nunca invente ou deduza prazo processual de cabeça.`,
      }],
    }],
    generationConfig: {
      maxOutputTokens: 2000,
      responseMimeType: "application/json",
      responseSchema: ESQUEMA_DATAS_EMAIL,
    },
  }, (motivo) => console.error("analisaDatasEmail:", motivo));

  return Array.isArray(analise?.datas) ? analise.datas : [];
}

const ESCOPOS = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "email", // só pra mostrar na tela qual conta foi conectada — sem isso não dá pra confirmar
].join(" ");

function urlCallback(): string {
  return `${SUPABASE_URL}/functions/v1/gmail-callback`;
}

// ---------- token de acesso válido (renova se preciso) ----------
async function tokenValido(supabase: any, conta: any): Promise<string> {
  const expira = conta.access_token_expira ? new Date(conta.access_token_expira) : null;
  if (conta.access_token && expira && expira.getTime() > Date.now() + 60_000) {
    return conta.access_token;
  }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: conta.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const dados = await r.json();
  if (!r.ok) throw new Error(`renovação do token falhou: ${JSON.stringify(dados)}`);
  const novoExpira = new Date(Date.now() + (dados.expires_in ?? 3600) * 1000).toISOString();
  await supabase.from("gmail_conta").update({
    access_token: dados.access_token, access_token_expira: novoExpira,
  }).eq("id", 1);
  return dados.access_token;
}

async function chamaGmail(caminho: string, accessToken: string, opcoes: RequestInit = {}) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${caminho}`, {
    ...opcoes,
    headers: { ...(opcoes.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gmail API ${caminho} → ${r.status}: ${JSON.stringify(dados)}`);
  return dados;
}

function cabecalho(headers: Array<{ name: string; value: string }>, nome: string): string | null {
  const h = headers.find((x) => x.name.toLowerCase() === nome.toLowerCase());
  return h ? h.value : null;
}

/** Metadados de uma mensagem — rápido, sem baixar o corpo inteiro. Usado
 * tanto no backfill quanto no sync incremental. */
async function metadadosMensagem(id: string, accessToken: string) {
  const params = new URLSearchParams({ format: "metadata" });
  for (const h of ["Subject", "From", "To", "Date"]) params.append("metadataHeaders", h);
  const m = await chamaGmail(`/messages/${id}?${params}`, accessToken);
  const headers = m.payload?.headers ?? [];
  return {
    gmail_id: m.id,
    thread_id: m.threadId,
    de: cabecalho(headers, "From"),
    para: cabecalho(headers, "To"),
    assunto: cabecalho(headers, "Subject"),
    previa: m.snippet ?? null,
    recebida_em: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    enviada_por_mim: (m.labelIds ?? []).includes("SENT"),
    labels: m.labelIds ?? [],
  };
}

/** Busca metadados de vários ids com concorrência limitada — rápido sem
 * estourar o limite de 250 unidades/segundo da API do Gmail. */
async function metadadosEmLotes(ids: string[], accessToken: string, tamanhoLote = 15) {
  const linhas: any[] = [];
  for (let i = 0; i < ids.length; i += tamanhoLote) {
    const fatia = ids.slice(i, i + tamanhoLote);
    const resultado = await Promise.all(fatia.map((id) => metadadosMensagem(id, accessToken)));
    linhas.push(...resultado);
  }
  return linhas;
}

/** Grava em UM upsert só — o mesmo erro de performance que já cometemos
 * no sync do WhatsApp (gravar mensagem por mensagem) não pode se repetir
 * aqui. */
async function upsertMensagens(supabase: any, linhas: any[]) {
  if (!linhas.length) return;
  const { error } = await supabase.from("gmail_mensagens").upsert(linhas, { onConflict: "gmail_id" });
  if (error) console.error("gmail_mensagens.upsert:", error.message);
}

/** Extrai o corpo (texto ou HTML) de um payload do Gmail — percorre
 * `parts` recursivamente até achar text/plain ou text/html. */
function extraiCorpo(payload: any): { corpo: string | null; html: boolean } {
  if (!payload) return { corpo: null, html: false };
  const decodifica = (data: string) => {
    const norm = data.replace(/-/g, "+").replace(/_/g, "/");
    try { return new TextDecoder("utf-8").decode(Uint8Array.from(atob(norm), (c) => c.charCodeAt(0))); }
    catch { return null; }
  };
  function acha(parte: any, tipo: string): string | null {
    if (parte.mimeType === tipo && parte.body?.data) return decodifica(parte.body.data);
    for (const filha of parte.parts ?? []) {
      const achado = acha(filha, tipo);
      if (achado) return achado;
    }
    return null;
  }
  const texto = acha(payload, "text/plain");
  if (texto) return { corpo: texto, html: false };
  const html = acha(payload, "text/html");
  if (html) return { corpo: html, html: true };
  if (payload.body?.data) return { corpo: decodifica(payload.body.data), html: false };
  return { corpo: null, html: false };
}

function textoPlano(corpo: string | null, html: boolean): string {
  if (!corpo) return "";
  return html ? corpo.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : corpo;
}

// ---------------------------------------------------------------
// Montagem da mensagem com anexo
// ---------------------------------------------------------------
/** O próprio Gmail corta em 25 MB; 15 MB deixa folga pro overhead do
 * base64 (que engorda ~33%) sem estourar a memória da function. */
const LIMITE_ANEXOS = 15 * 1024 * 1024;

type Anexo = { nome?: string; tipo?: string; dados?: string };

function base64Padrao(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** RFC 2045 pede linha de no máximo 76 caracteres no corpo base64. O
 * Gmail engole linha longa, mas cliente de e-mail antigo não. */
function quebra76(b64: string): string {
  return (String(b64).replace(/\s+/g, "").match(/.{1,76}/g) ?? []).join("\r\n");
}

/** Nome de arquivo entra entre aspas num cabeçalho — aspas e quebra de
 * linha no nome quebrariam o MIME (ou permitiriam injetar cabeçalho). */
function nomeSeguro(nome: string): string {
  return String(nome || "anexo").replace(/[\r\n"\\]/g, "_").slice(0, 200);
}

/** Sem anexo: text/plain simples. Com anexo: multipart/mixed, com o
 * texto em base64 (evita problema de acento em transporte 7bit). */
function montaMime(cabecalhos: string[], texto: string, anexos: Anexo[]): string {
  const textoB64 = quebra76(base64Padrao(new TextEncoder().encode(texto)));

  if (!anexos.length) {
    return [
      ...cabecalhos,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      "",
      textoB64,
    ].join("\r\n");
  }

  const limite = `sena_${crypto.randomUUID().replace(/-/g, "")}`;
  const partes = [
    `--${limite}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `Content-Transfer-Encoding: base64`,
    "",
    textoB64,
  ];

  for (const a of anexos) {
    const nome = nomeSeguro(a.nome ?? "anexo");
    partes.push(
      `--${limite}`,
      `Content-Type: ${String(a.tipo || "application/octet-stream").replace(/[\r\n;]/g, "")}; name="${nome}"`,
      `Content-Disposition: attachment; filename="${nome}"`,
      `Content-Transfer-Encoding: base64`,
      "",
      quebra76(a.dados ?? ""),
    );
  }
  partes.push(`--${limite}--`);

  return [
    ...cabecalhos,
    `Content-Type: multipart/mixed; boundary="${limite}"`,
    "",
    ...partes,
  ].join("\r\n");
}

/** O endpoint normal (`/messages/send` com JSON) só aceita 5 MB. Com
 * anexo a mensagem passa disso fácil, então usa o endpoint de upload,
 * que aceita a mensagem crua e o threadId em partes separadas. */
async function enviaComAnexo(mime: string, threadId: string | undefined, accessToken: string) {
  const limite = `envio_${crypto.randomUUID().replace(/-/g, "")}`;
  const corpoUpload =
    `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(threadId ? { threadId } : {})}\r\n` +
    `--${limite}\r\nContent-Type: message/rfc822\r\n\r\n${mime}\r\n` +
    `--${limite}--`;

  const r = await fetch(
    "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${limite}`,
      },
      body: corpoUpload,
    },
  );
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gmail upload → ${r.status}: ${JSON.stringify(dados)}`);
  return dados;
}

/** Pra cada mensagem nova: busca o corpo completo, guarda ele (evita
 * buscar de novo quando o advogado abrir o e-mail) e manda pro Gemini
 * atrás de data com consequência prática, criando a tarefa direto —
 * sem fila de confirmação, foi assim que o Rodrigo pediu. Isolado em
 * try/catch por mensagem: um e-mail estranho não pode travar a
 * sincronização inteira. */
async function processaCorpoEDatas(supabase: any, gmailId: string, assunto: string, accessToken: string) {
  try {
    const m = await chamaGmail(`/messages/${gmailId}?format=full`, accessToken);
    const { corpo, html } = extraiCorpo(m.payload);

    const datas = await analisaDatasEmail(assunto, textoPlano(corpo, html));
    if (datas.length) {
      await supabase.from("tarefas").insert(datas.map((d) => ({
        titulo: `${d.titulo} (do e-mail: ${assunto || "sem assunto"})`,
        quando: `${d.data}T09:00:00`,
        tipo: ["audiencia", "prazo", "reuniao", "tarefa"].includes(d.tipo) ? d.tipo : "tarefa",
      })));
    }

    await supabase.from("gmail_mensagens")
      .update({ corpo, html, analisada_ia: true })
      .eq("gmail_id", gmailId);
  } catch (e) {
    console.error("processaCorpoEDatas:", gmailId, String(e));
    await supabase.from("gmail_mensagens").update({ analisada_ia: true }).eq("gmail_id", gmailId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "método não permitido" }, 405);

  const autorizacao = req.headers.get("Authorization") ?? "";
  const cron = req.headers.get("x-cron-secret");
  const segredoCron = Deno.env.get("CRON_SECRET");
  const viaCron = !!(segredoCron && cron && cron === segredoCron);

  const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let usuarioId: string | null = null;
  if (!viaCron) {
    if (!autorizacao.startsWith("Bearer ")) return json({ erro: "não autenticado" }, 401);
    const comToken = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: autorizacao } },
    });
    const { data, error } = await comToken.auth.getUser();
    if (error || !data?.user) return json({ erro: "não autenticado" }, 401);
    usuarioId = data.user.id;
  }

  let corpo: {
    acao?: string; gmail_id?: string; resposta_a?: string;
    para?: string; assunto?: string; texto?: string; caso_id?: string | null;
    anexos?: Anexo[]; assinatura?: string;
  };
  try { corpo = await req.json(); } catch { corpo = {}; }

  // ---------- status ----------
  if (corpo.acao === "status") {
    const { data: conta } = await supabase.from("gmail_conta").select("email, erro, sincronizando, history_id, assinatura").eq("id", 1).maybeSingle();
    return json({
      ok: true, conectado: !!conta, email: conta?.email ?? null, erro: conta?.erro ?? null,
      backfill_pendente: !!conta && !conta.history_id,
      assinatura: conta?.assinatura ?? null,
    });
  }

  // ---------- assinatura que vai no rodapé de todo e-mail enviado ----------
  if (corpo.acao === "salvar-assinatura") {
    if (!usuarioId) return json({ erro: "precisa estar logado" }, 401);
    const texto = String(corpo.assinatura ?? "").trim();
    const { error } = await supabase.from("gmail_conta")
      .update({ assinatura: texto || null }).eq("id", 1);
    if (error) return json({ erro: error.message }, 400);
    return json({ ok: true, assinatura: texto || null });
  }

  // ---------- monta a URL de consentimento do Google ----------
  if (corpo.acao === "auth-url") {
    if (!usuarioId) return json({ erro: "precisa estar logado" }, 401);
    if (!GOOGLE_CLIENT_ID || !GOOGLE_STATE_SECRET) {
      return json({ erro: "integração do Gmail não configurada (faltam secrets)" }, 500);
    }
    const state = await assinaEstado(usuarioId, GOOGLE_STATE_SECRET);
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", GOOGLE_CLIENT_ID);
    url.searchParams.set("redirect_uri", urlCallback());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", ESCOPOS);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);
    return json({ ok: true, url: url.toString() });
  }

  // ---------- desconecta ----------
  if (corpo.acao === "desconectar") {
    if (!usuarioId) return json({ erro: "precisa estar logado" }, 401);
    await supabase.from("gmail_conta").delete().eq("id", 1);
    return json({ ok: true });
  }

  // ---------- sincroniza (backfill por página, depois incremental) ----------
  if (!corpo.acao || corpo.acao === "sincronizar") {
    const { data: conta } = await supabase.from("gmail_conta").select("*").eq("id", 1).maybeSingle();
    if (!conta) return json({ erro: "gmail não conectado" }, 400);
    if (conta.sincronizando) return json({ ok: true, ocupado: true });

    await supabase.from("gmail_conta").update({ sincronizando: true, erro: null }).eq("id", 1);

    try {
      const accessToken = await tokenValido(supabase, conta);

      if (!conta.history_id) {
        // ---------- fase de backfill: uma página por chamada ----------
        // Página menor que antes (era 100): agora cada mensagem nova também
        // busca o corpo completo e passa pelo Gemini atrás de datas, então
        // uma página grande estouraria o tempo da function.
        const params = new URLSearchParams({ maxResults: "15" });
        if (conta.backfill_page_token) params.set("pageToken", conta.backfill_page_token);
        const lista = await chamaGmail(`/messages?${params}`, accessToken);
        const ids = (lista.messages ?? []).map((m: any) => m.id);
        const linhas = await metadadosEmLotes(ids, accessToken);
        await upsertMensagens(supabase, linhas);
        for (const l of linhas) await processaCorpoEDatas(supabase, l.gmail_id, l.assunto, accessToken);

        if (lista.nextPageToken) {
          await supabase.from("gmail_conta").update({
            backfill_page_token: lista.nextPageToken, sincronizando: false,
          }).eq("id", 1);
          return json({ ok: true, fase: "backfill", processadas: linhas.length, mais: true });
        }

        // backfill terminou — marca o historyId atual como ponto de partida
        // do sync incremental daqui pra frente.
        const perfil = await chamaGmail("/profile", accessToken);
        await supabase.from("gmail_conta").update({
          history_id: perfil.historyId, backfill_page_token: null,
          sincronizando: false, sincronizado_ate: new Date().toISOString(),
        }).eq("id", 1);
        return json({ ok: true, fase: "backfill", processadas: linhas.length, mais: false, concluido: true });
      }

      // ---------- sync incremental ----------
      try {
        const params = new URLSearchParams({
          startHistoryId: conta.history_id, historyTypes: "messageAdded",
        });
        const hist = await chamaGmail(`/history?${params}`, accessToken);
        const idsNovos = new Set<string>();
        for (const h of hist.history ?? []) {
          for (const m of h.messagesAdded ?? []) idsNovos.add(m.message.id);
        }
        const linhas = await metadadosEmLotes([...idsNovos], accessToken);
        await upsertMensagens(supabase, linhas);
        for (const l of linhas) await processaCorpoEDatas(supabase, l.gmail_id, l.assunto, accessToken);

        // acumulado: e-mail que já tinha sido sincronizado antes dessa
        // extração de datas existir (ou que sobrou de um erro pontual)
        // vai sendo pego aos poucos, um punhado por sincronização.
        const { data: atrasados } = await supabase
          .from("gmail_mensagens").select("gmail_id, assunto")
          .eq("analisada_ia", false).limit(15);
        for (const a of atrasados ?? []) await processaCorpoEDatas(supabase, a.gmail_id, a.assunto, accessToken);

        await supabase.from("gmail_conta").update({
          history_id: hist.historyId ?? conta.history_id,
          sincronizando: false, sincronizado_ate: new Date().toISOString(),
        }).eq("id", 1);
        return json({ ok: true, fase: "incremental", processadas: linhas.length, atrasados: (atrasados ?? []).length });
      } catch (e) {
        // historyId expirado (Gmail só guarda ~1 semana) — volta pro backfill.
        const msg = String(e);
        if (msg.includes("404")) {
          await supabase.from("gmail_conta").update({
            history_id: null, backfill_page_token: null, sincronizando: false,
          }).eq("id", 1);
          return json({ ok: true, fase: "reiniciando", motivo: "history_id expirado" });
        }
        throw e;
      }
    } catch (e) {
      await supabase.from("gmail_conta").update({ sincronizando: false, erro: String(e) }).eq("id", 1);
      return json({ erro: "falha na sincronização", detalhe: String(e) }, 502);
    }
  }

  // ---------- corpo completo de uma mensagem ----------
  if (corpo.acao === "mensagem") {
    if (!usuarioId) return json({ erro: "precisa estar logado" }, 401);
    if (!corpo.gmail_id) return json({ erro: "informe gmail_id" }, 400);
    const { data: conta } = await supabase.from("gmail_conta").select("*").eq("id", 1).maybeSingle();
    if (!conta) return json({ erro: "gmail não conectado" }, 400);
    try {
      const accessToken = await tokenValido(supabase, conta);
      const m = await chamaGmail(`/messages/${corpo.gmail_id}?format=full`, accessToken);
      const { corpo: texto, html } = extraiCorpo(m.payload);
      await supabase.from("gmail_mensagens").update({ corpo: texto, html }).eq("gmail_id", corpo.gmail_id);
      return json({ ok: true, corpo: texto, html });
    } catch (e) {
      return json({ erro: "falha ao buscar a mensagem", detalhe: String(e) }, 502);
    }
  }

  // ---------- envia (novo e-mail ou resposta) ----------
  if (corpo.acao === "enviar") {
    if (!usuarioId) return json({ erro: "precisa estar logado" }, 401);
    if (!corpo.para || !corpo.texto) return json({ erro: "informe para e texto" }, 400);
    const { data: conta } = await supabase.from("gmail_conta").select("*").eq("id", 1).maybeSingle();
    if (!conta) return json({ erro: "gmail não conectado" }, 400);

    try {
      const accessToken = await tokenValido(supabase, conta);

      let threadId: string | undefined;
      let messageIdHeader: string | null = null;
      let assunto = corpo.assunto ?? "";
      if (corpo.resposta_a) {
        const params = new URLSearchParams({ format: "metadata" });
        for (const h of ["Message-ID", "Subject"]) params.append("metadataHeaders", h);
        const original = await chamaGmail(`/messages/${corpo.resposta_a}?${params}`, accessToken);
        threadId = original.threadId;
        messageIdHeader = cabecalho(original.payload?.headers ?? [], "Message-ID");
        const assuntoOriginal = cabecalho(original.payload?.headers ?? [], "Subject") ?? "";
        assunto = assuntoOriginal.toLowerCase().startsWith("re:") ? assuntoOriginal : `Re: ${assuntoOriginal}`;
      }

      // assinatura vem da conta e entra no fim do texto, do jeito que
      // cliente de e-mail faz: duas quebras, "-- " e o texto dela.
      const anexos = Array.isArray(corpo.anexos) ? corpo.anexos : [];
      const textoFinal = conta.assinatura
        ? `${corpo.texto}\r\n\r\n-- \r\n${conta.assinatura}`
        : corpo.texto;

      const bytesTotais = anexos.reduce((t, a) => t + Math.floor((a.dados ?? "").length * 0.75), 0);
      if (bytesTotais > LIMITE_ANEXOS) {
        return json({ erro: `anexos somam mais que ${Math.round(LIMITE_ANEXOS / 1048576)} MB` }, 400);
      }

      // nunca interpolar direto num cabeçalho MIME sem tirar quebra de
      // linha — um \r\n no meio vira injeção de cabeçalho (dá pra forjar
      // um Bcc, por exemplo). "para" e "assunto" hoje só vêm de dado que
      // o próprio Gmail já devolveu, mas mesmo assim não custa garantir.
      const semQuebra = (s: string) => s.replace(/[\r\n]+/g, " ");
      const cabecalhos = [
        `To: ${semQuebra(corpo.para)}`,
        `Subject: ${semQuebra(assunto)}`,
        `MIME-Version: 1.0`,
      ];
      if (messageIdHeader) {
        const idLimpo = semQuebra(messageIdHeader);
        cabecalhos.push(`In-Reply-To: ${idLimpo}`, `References: ${idLimpo}`);
      }

      const mime = montaMime(cabecalhos, textoFinal, anexos);

      // Sem anexo continua pelo endpoint simples (JSON com `raw`), que é o
      // caminho que já estava funcionando. Com anexo a mensagem passa fácil
      // do limite de 5 MB desse endpoint, então vai pelo de upload.
      const enviado = anexos.length
        ? await enviaComAnexo(mime, threadId, accessToken)
        : await chamaGmail("/messages/send", accessToken, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ raw: base64url(new TextEncoder().encode(mime)), ...(threadId ? { threadId } : {}) }),
          });

      // grava localmente pra aparecer na hora no painel, sem esperar o
      // próximo ciclo de sincronização.
      await upsertMensagens(supabase, [{
        gmail_id: enviado.id,
        thread_id: enviado.threadId,
        de: conta.email,
        para: corpo.para,
        assunto,
        previa: textoFinal.slice(0, 200),
        corpo: textoFinal,
        html: false,
        recebida_em: new Date().toISOString(),
        enviada_por_mim: true,
        labels: ["SENT"],
        caso_id: corpo.caso_id ?? null,
      }]);

      return json({ ok: true, gmail_id: enviado.id, thread_id: enviado.threadId });
    } catch (e) {
      return json({ erro: "falha ao enviar", detalhe: String(e) }, 502);
    }
  }

  return json({ erro: "ação desconhecida" }, 400);
});
