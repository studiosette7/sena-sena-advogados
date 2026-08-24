// ============================================================
// SENA & SENA — Edge Function "lembretes"
//
// Manda no WhatsApp do Gildemi:
//   • todo dia de manhã  → o que vence hoje, o que atrasou, quem está
//                          perto de prescrever, quem chegou novo
//   • toda segunda-feira → o resumo da semana: o que entrou, o que
//                          ficou pendente, o que vem pela frente
//
//   POST { tipo: "diario" }   |   POST { tipo: "semanal" }
//   POST { tipo: "...", previa: true }  → devolve o texto sem enviar
//
// COMO O ENVIO FUNCIONA
// Usa a API oficial da Meta (WhatsApp Cloud API). O número REMETENTE é
// um número novo do escritório, cadastrado na Meta; o DESTINATÁRIO é o
// WhatsApp pessoal do Gildemi. O número pessoal dele não é tocado e
// continua no aplicativo normal.
//
// Mensagem que o sistema começa (fora da janela de 24h) exige TEMPLATE
// aprovado pela Meta. Crie um template de categoria "utility" com um
// único parâmetro de corpo — é dentro dele que o resumo entra:
//
//   Nome: aviso_escritorio
//   Corpo: {{1}}
//
// Segredos necessários:
//   WHATSAPP_TOKEN        token permanente da Meta
//   WHATSAPP_PHONE_ID     id do número remetente
//   WHATSAPP_DESTINO      o celular dele, com 55 e DDD
//   WHATSAPP_TEMPLATE     nome do template (padrão: aviso_escritorio)
//   CRON_SECRET           o mesmo do agendamento
//
// Sem esses segredos a função ainda roda e devolve o texto montado —
// serve pra testar tudo antes de a Meta liberar o template.
//
// Deploy: npx supabase functions deploy lembretes
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const TZ = "America/Sao_Paulo";
const ADV = "Gildemi";

/** Data de hoje no fuso de São Paulo — o servidor roda em UTC. */
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}
function diaLocal(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}
function horaLocal(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}
function dataBR(s: string): string {
  const [a, m, d] = String(s).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}
const ROTULO: Record<string, string> = {
  audiencia: "audiência", prazo: "prazo", reuniao: "reunião", tarefa: "tarefa",
};

// ---------------------------------------------------------------
// Os textos. Mesma lógica que o painel mostra na prévia — se mexer
// aqui, mexa lá também, senão o que ele vê não é o que ele recebe.
// ---------------------------------------------------------------
function textoDiario(casos: any[], tarefas: any[]): string {
  const hoje = hojeSP();
  const abertas = tarefas.filter((t) => !t.feita);
  const doDia = abertas.filter((t) => diaLocal(t.quando) === hoje)
    .sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
  const atrasadas = abertas.filter((t) => diaLocal(t.quando) < hoje);
  const ativos = casos.filter((c) => c.etapa !== "encerrado" && c.etapa !== "descartado");
  const prescrevem = ativos.filter((c) =>
    c.dias_restantes !== null && c.dias_restantes >= 0 && c.dias_restantes <= 30);
  const novos = casos.filter((c) =>
    c.etapa === "triagem" && Date.now() - new Date(c.criado_at).getTime() < 86400000);

  if (!doDia.length && !atrasadas.length && !prescrevem.length && !novos.length) {
    return `Bom dia, ${ADV}. Nada marcado para hoje e nenhum prazo apertado.`;
  }

  const l: string[] = [`*Bom dia, ${ADV}.* Seu dia:`, ""];
  if (doDia.length) {
    l.push("*Hoje*");
    for (const t of doDia) {
      l.push(`• ${horaLocal(t.quando)} — ${t.titulo}` +
        (t.casos?.nome ? ` (${t.casos.nome})` : "") +
        ` [${ROTULO[t.tipo] ?? "tarefa"}]`);
    }
    l.push("");
  }
  if (atrasadas.length) {
    l.push(`*Atrasado* (${atrasadas.length})`);
    for (const t of atrasadas.slice(0, 5)) {
      l.push(`• ${t.titulo}` + (t.casos?.nome ? ` (${t.casos.nome})` : "") +
        ` — venceu em ${dataBR(diaLocal(t.quando))}`);
    }
    l.push("");
  }
  if (prescrevem.length) {
    l.push("*Prescreve em menos de 30 dias*");
    for (const c of prescrevem) {
      l.push(`• ${c.nome} — ${c.dias_restantes} dias (${dataBR(c.prescreve_em)})`);
    }
    l.push("");
  }
  if (novos.length) {
    l.push(`*${novos.length} caso${novos.length > 1 ? "s novos" : " novo"}* esperando triagem.`);
  }
  return l.join("\n").trim();
}

function textoSemanal(casos: any[], tarefas: any[], pubsNaoLidas: number): string {
  const agora = Date.now(), semana = 7 * 86400000;
  const novos = casos.filter((c) => agora - new Date(c.criado_at).getTime() < semana);
  const abertos = casos.filter((c) => c.etapa !== "encerrado" && c.etapa !== "descartado");
  const abertas = tarefas.filter((t) => !t.feita);
  const pendentes = abertas.filter((t) => new Date(t.quando).getTime() < agora);
  const daSemana = abertas
    .filter((t) => {
      const q = new Date(t.quando).getTime();
      return q >= agora && q < agora + semana;
    })
    .sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
  const criticos = abertos.filter((c) =>
    c.alerta_prazo === "critico" || c.alerta_prazo === "prescrito");
  const semTriagem = casos.filter((c) => c.etapa === "triagem");

  const l: string[] = ["*Resumo da semana — Sena & Sena*", "", "*Como está*"];
  l.push(`• ${abertos.length} casos em aberto`);
  l.push(`• ${novos.length} entraram nos últimos 7 dias`);
  l.push(`• ${semTriagem.length} esperando triagem`);
  if (pubsNaoLidas) l.push(`• ${pubsNaoLidas} publicação(ões) do Diário sem ler`);
  l.push("");

  if (criticos.length) {
    l.push(`*Prazo apertado* (${criticos.length})`);
    for (const c of criticos.slice(0, 6)) {
      l.push(`• ${c.nome} — ${c.dias_restantes < 0 ? "VENCIDO" : c.dias_restantes + " dias"}`);
    }
    l.push("");
  }
  if (pendentes.length) {
    l.push(`*Ficou pendente* (${pendentes.length})`);
    for (const t of pendentes.slice(0, 6)) {
      l.push(`• ${t.titulo}` + (t.casos?.nome ? ` (${t.casos.nome})` : ""));
    }
    l.push("");
  }
  if (daSemana.length) {
    l.push("*Esta semana*");
    const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
    for (const t of daSemana.slice(0, 10)) {
      const d = new Date(t.quando);
      l.push(`• ${dias[d.getDay()]} ${d.getDate()}, ${horaLocal(t.quando)} — ${t.titulo}` +
        (t.casos?.nome ? ` (${t.casos.nome})` : ""));
    }
  } else l.push("*Esta semana* — nada marcado.");

  return l.join("\n").trim();
}

// ---------------------------------------------------------------
async function mandaWhatsApp(texto: string) {
  const token    = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId  = Deno.env.get("WHATSAPP_PHONE_ID");
  const destino  = Deno.env.get("WHATSAPP_DESTINO");
  const template = Deno.env.get("WHATSAPP_TEMPLATE") ?? "aviso_escritorio";

  if (!token || !phoneId || !destino) {
    return { enviado: false, motivo: "WhatsApp ainda não configurado" };
  }

  const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: destino,
      type: "template",
      template: {
        name: template,
        language: { code: "pt_BR" },
        components: [{ type: "body", parameters: [{ type: "text", text: texto }] }],
      },
    }),
  });

  const resposta = await r.json().catch(() => ({}));
  if (!r.ok) return { enviado: false, motivo: resposta?.error?.message ?? `erro ${r.status}` };
  return { enviado: true, id: resposta?.messages?.[0]?.id ?? null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "método não permitido" }, 405);

  const segredoCron = Deno.env.get("CRON_SECRET");
  const cron = req.headers.get("x-cron-secret");
  const viaCron = !!(segredoCron && cron && cron === segredoCron);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (!viaCron) {
    const autorizacao = req.headers.get("Authorization") ?? "";
    if (!autorizacao.startsWith("Bearer ")) return json({ erro: "não autenticado" }, 401);
    const comToken = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: autorizacao } } },
    );
    const { data, error } = await comToken.auth.getUser();
    if (error || !data?.user) return json({ erro: "não autenticado" }, 401);
  }

  let corpo: { tipo?: string; previa?: boolean };
  try { corpo = await req.json(); } catch { corpo = {}; }
  const tipo = corpo.tipo === "semanal" ? "semanal" : "diario";

  const [{ data: casos }, { data: tarefas }, { count: naoLidas }] = await Promise.all([
    supabase.from("casos_com_prazo").select("*"),
    supabase.from("tarefas").select("*, casos(nome)"),
    supabase.from("publicacoes").select("id_cnj", { count: "exact", head: true }).eq("lida", false),
  ]);

  const texto = tipo === "semanal"
    ? textoSemanal(casos ?? [], tarefas ?? [], naoLidas ?? 0)
    : textoDiario(casos ?? [], tarefas ?? []);

  if (corpo.previa) return json({ ok: true, tipo, texto, enviado: false });

  const envio = await mandaWhatsApp(texto);
  return json({ ok: true, tipo, texto, ...envio });
});
