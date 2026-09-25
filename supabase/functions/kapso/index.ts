// ============================================================
// SENA & SENA — Edge Function "kapso"
//
// O lado de saída do WhatsApp. Antes o painel gravava numa fila
// (`wpp_fila`) e a ponte do Baileys consumia; agora o painel chama aqui
// e a mensagem vai direto pela Cloud API oficial, via Kapso.
//
//   POST { acao: "status" }              → conectado? qual número?
//   POST { acao: "enviar", telefone, texto } → manda a mensagem
//
// A entrada (mensagem que chega) é a function `kapso-webhook`.
//
// Deploy: npx supabase functions deploy kapso
// Segredos: KAPSO_API_KEY e KAPSO_PHONE_NUMBER_ID
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

const KAPSO_API_KEY = Deno.env.get("KAPSO_API_KEY") ?? "";
const KAPSO_PHONE_NUMBER_ID = Deno.env.get("KAPSO_PHONE_NUMBER_ID") ?? "";
const KAPSO_WHATSAPP = "https://api.kapso.ai/meta/whatsapp/v24.0";
const KAPSO_PLATAFORMA = "https://api.kapso.ai/platform/v1";

async function chamaKapso(url: string, opcoes: RequestInit = {}) {
  const r = await fetch(url, {
    ...opcoes,
    headers: { ...(opcoes.headers ?? {}), "X-API-Key": KAPSO_API_KEY, "Content-Type": "application/json" },
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Kapso ${r.status}: ${JSON.stringify(dados).slice(0, 300)}`);
  return dados;
}

function soDigitos(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

/** Lista os números conectados na conta do Kapso. */
async function listaNumeros(): Promise<any[]> {
  const dados = await chamaKapso(`${KAPSO_PLATAFORMA}/whatsapp/phone_numbers`);
  return dados?.data ?? [];
}

// Descoberto uma vez e guardado enquanto o isolate vive — evita uma
// chamada extra ao Kapso a cada mensagem enviada.
let numeroEmCache: string | null = null;

/** Qual número usar pra enviar. Com o segredo definido, manda nele; sem
 * ele, pega o único número conectado. Assim o escritório não precisa
 * configurar nada depois de conectar — só se tiver mais de um número é
 * que vale fixar KAPSO_PHONE_NUMBER_ID. */
async function numeroDeEnvio(): Promise<string | null> {
  if (KAPSO_PHONE_NUMBER_ID) return KAPSO_PHONE_NUMBER_ID;
  if (numeroEmCache) return numeroEmCache;
  const numeros = await listaNumeros();
  // Prioriza sempre o número do escritório. O sandbox só entra quando não
  // existe número real ainda — é o que deixa dar pra testar o fluxo
  // inteiro antes da coexistência estar ligada. Assim que o número real
  // aparecer, o envio migra pra ele sozinho.
  const real = numeros.find((n: any) => n.kind !== "sandbox");
  const escolhido = real ?? numeros[0];
  numeroEmCache = escolhido?.phone_number_id ?? escolhido?.id ?? null;
  return numeroEmCache;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "método não permitido" }, 405);

  // Mesmo padrão das outras: confere o usuário logado com a chave anon e
  // grava com a service role.
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao.startsWith("Bearer ")) return json({ erro: "não autenticado" }, 401);

  const comToken = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: autorizacao } } },
  );
  const { data: sessao, error: erroAuth } = await comToken.auth.getUser();
  if (erroAuth || !sessao?.user) return json({ erro: "não autenticado" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let corpo: { acao?: string; telefone?: string; texto?: string };
  try { corpo = await req.json(); } catch { corpo = {}; }

  // ---------- está configurado e conectado? ----------
  if (corpo.acao === "status") {
    if (!KAPSO_API_KEY) return json({ ok: true, conectado: false, motivo: "falta KAPSO_API_KEY" });
    try {
      const numeros = await listaNumeros();
      const escolhido = KAPSO_PHONE_NUMBER_ID
        ? numeros.find((n: any) => String(n.phone_number_id ?? n.id) === KAPSO_PHONE_NUMBER_ID)
        : numeros.find((n: any) => n.kind !== "sandbox") ?? numeros[0];

      // Toda conta nova do Kapso já vem com um número "sandbox" de teste.
      // Ele responde à API, mas não é o WhatsApp do escritório — dar isso
      // como conectado faria a tela mentir.
      const ehSandbox = escolhido?.kind === "sandbox";
      return json({
        ok: true,
        conectado: !!escolhido && !ehSandbox,
        // com sandbox dá pra usar a tela normalmente, só que em teste
        modo_teste: ehSandbox,
        sandbox: ehSandbox,
        numero: escolhido?.display_phone_number ?? null,
        nome: escolhido?.display_name ?? null,
        coexistencia: !!escolhido?.is_coexistence,
        id: escolhido?.phone_number_id ?? escolhido?.id ?? null,
        total: numeros.length,
        motivo: !escolhido
          ? "nenhum número conectado na conta do Kapso ainda"
          : ehSandbox
            ? "só o número sandbox de teste do Kapso está conectado — falta conectar o número do escritório"
            : null,
      });
    } catch (e) {
      return json({ ok: true, conectado: false, motivo: String(e) });
    }
  }

  // ---------- manda a mensagem ----------
  if (corpo.acao === "enviar") {
    const telefone = soDigitos(corpo.telefone);
    const texto = String(corpo.texto ?? "").trim();
    if (!telefone || !texto) return json({ erro: "informe telefone e texto" }, 400);
    if (!KAPSO_API_KEY) return json({ erro: "WhatsApp não configurado (falta KAPSO_API_KEY)" }, 500);

    try {
      const numeroId = await numeroDeEnvio();
      if (!numeroId) return json({ erro: "nenhum número do WhatsApp conectado no Kapso" }, 400);

      const enviado = await chamaKapso(`${KAPSO_WHATSAPP}/${numeroId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: telefone,
          type: "text",
          text: { body: texto },
        }),
      });

      // O eco do envio volta pelo webhook e grava a mensagem com o id
      // definitivo. Gravar aqui também, com o mesmo id, deixa a mensagem
      // na tela na hora — e o `onConflict: id_wpp` impede duplicar quando
      // o eco chegar.
      const idWpp = enviado?.messages?.[0]?.id ?? null;
      const { data: contato } = await supabase
        .from("contatos").select("id").eq("telefone", telefone).maybeSingle();

      if (contato && idWpp) {
        const { data: conversa } = await supabase
          .from("conversas_wpp").select("id").eq("contato_id", contato.id).maybeSingle();
        if (conversa) {
          await supabase.from("mensagens_wpp").upsert({
            conversa_id: conversa.id,
            id_wpp: idWpp,
            de_mim: true,
            tipo: "texto",
            texto,
            entregue: true,
          }, { onConflict: "id_wpp", ignoreDuplicates: true });
          await supabase.from("conversas_wpp").update({
            ultima_at: new Date().toISOString(),
            ultima_previa: "Você: " + texto.slice(0, 120),
            nao_lidas: 0,
          }).eq("id", conversa.id);
        }
      }

      return json({ ok: true, id_wpp: idWpp });
    } catch (e) {
      return json({ erro: "falha ao enviar", detalhe: String(e) }, 502);
    }
  }

  return json({ erro: "ação desconhecida" }, 400);
});
