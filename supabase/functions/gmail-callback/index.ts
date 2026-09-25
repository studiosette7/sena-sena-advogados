// ============================================================
// SENA & SENA — Edge Function "gmail-callback"
//
// Recebe o redirect do Google depois do consentimento OAuth. Fica
// separada de "gmail" (e deploya com --no-verify-jwt) porque o redirect
// do Google é um GET puro do navegador, sem Authorization nenhum — a
// plataforma bloquearia a chamada antes até de chegar aqui.
//
// A autenticidade não vem do JWT do Supabase, vem do "state" assinado
// (ver _shared/gmailAuth.ts) que a function "gmail" gerou quando o
// advogado clicou em "Conectar Gmail" — sem esse state válido e recente,
// o callback não faz nada.
//
// Deploy: npx supabase functions deploy gmail-callback --no-verify-jwt
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verificaEstado } from "../_shared/gmailAuth.ts";

const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")!;
const GOOGLE_CLIENT_ID     = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const GOOGLE_STATE_SECRET  = Deno.env.get("GOOGLE_STATE_SECRET") ?? "";

// o "error" que o Google manda de volta é query string — em tese
// controlável por quem monta o link, então nunca pode ir cru pro HTML.
function escHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function pagina(titulo: string, corpoHtml: string) {
  return new Response(
    `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
    <title>${escHtml(titulo)}</title>
    <body style="font:16px system-ui;max-width:420px;margin:80px auto;text-align:center;color:#1a1a1a">
      ${corpoHtml}
      <p style="color:#888;font-size:13px">Pode fechar esta aba e voltar pro painel.</p>
    </body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const erroGoogle = url.searchParams.get("error");
  const code  = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (erroGoogle) {
    return pagina("Conexão cancelada", `<h1>Conexão cancelada</h1><p>${erroGoogle === "access_denied" ? "Você não autorizou o acesso." : escHtml(erroGoogle)}</p>`);
  }
  if (!code || !state) {
    return pagina("Link inválido", "<h1>Link inválido</h1><p>Faltam parâmetros do Google. Tente conectar de novo pelo painel.</p>");
  }

  const usuarioId = await verificaEstado(state, GOOGLE_STATE_SECRET);
  if (!usuarioId) {
    return pagina("Link expirado ou inválido", "<h1>Link expirado ou inválido</h1><p>Volte ao painel e clique em \"Conectar Gmail\" de novo.</p>");
  }

  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        code,
        redirect_uri: `${SUPABASE_URL}/functions/v1/gmail-callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await r.json();
    if (!r.ok || !tokens.refresh_token) {
      // sem refresh_token normalmente é porque o Google já tinha dado
      // consentimento antes e não repetiu — no painel isso não deveria
      // acontecer porque sempre pedimos prompt=consent, mas cobrir mesmo assim.
      return pagina("Não deu pra conectar", `<h1>Não deu pra conectar</h1><p>O Google não devolveu um token permanente. Detalhe: ${escHtml(JSON.stringify(tokens).slice(0, 300))}</p>`);
    }

    const infoR = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = await infoR.json();

    const supabase = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error } = await supabase.from("gmail_conta").upsert({
      id: 1,
      usuario_id: usuarioId,
      email: info.email ?? "desconhecido",
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expira: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString(),
      history_id: null,
      backfill_page_token: null,
      sincronizando: false,
      erro: null,
      conectado_em: new Date().toISOString(),
    }, { onConflict: "id" });

    if (error) return pagina("Erro ao salvar", `<h1>Erro ao salvar</h1><p>${escHtml(error.message)}</p>`);

    return pagina("Gmail conectado", `<h1>✓ Gmail conectado</h1><p><b>${escHtml(info.email ?? "")}</b></p><p>A sincronização do histórico começa agora — pode levar alguns minutos.</p>`);
  } catch (e) {
    return pagina("Erro inesperado", `<h1>Erro inesperado</h1><p>${escHtml(String(e).slice(0, 300))}</p>`);
  }
});
