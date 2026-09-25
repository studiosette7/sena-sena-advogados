// ============================================================
// SENA & SENA — Edge Function "agenda"
//
// Devolve a agenda do escritório no formato .ics, pra ser ASSINADA no
// calendário do celular (não baixada). O iPhone e o Google Agenda
// releem sozinhos de tempos em tempos, então compromisso marcado no
// painel aparece no celular — com o alarme do próprio aparelho, sem
// precisar abrir o sistema.
//
// Entram dois tipos de evento:
//   1. As tarefas (audiência, prazo, reunião, tarefa) — com hora.
//   2. A data de prescrição de cada caso ativo — dia inteiro. Ninguém
//      marca isso à mão, e é justamente o que não pode passar batido.
//
// GET /functions/v1/agenda?u=<token>
//
// Autenticação: calendário de celular não manda header, só busca a URL.
// Por isso a chave vai no próprio endereço e é um segredo por si só —
// quem tiver o link lê a agenda. Trate como senha: se vazar, gere outro
// com `npx supabase secrets set AGENDA_TOKEN=<novo>`.
//
// Deploy: npx supabase functions deploy agenda --no-verify-jwt
//         (o --no-verify-jwt é obrigatório: o app de calendário não
//          tem como mandar o Bearer do Supabase)
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TZ = "America/Sao_Paulo";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

/** Escapa conforme o RFC 5545: vírgula, ponto e vírgula, barra e quebra de linha. */
function txt(s: unknown): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Linha de no máximo 75 octetos, dobrada com espaço — exigência do formato. */
function dobra(linha: string): string {
  const bytes = new TextEncoder().encode(linha);
  if (bytes.length <= 75) return linha;
  const partes: string[] = [];
  let atual = "";
  for (const ch of linha) {
    const teste = atual + ch;
    if (new TextEncoder().encode(teste).length > (partes.length ? 74 : 75)) {
      partes.push(atual);
      atual = ch;
    } else atual = teste;
  }
  partes.push(atual);
  return partes.join("\r\n ");
}

const carimbo = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const soData  = (s: string) => String(s).slice(0, 10).replace(/-/g, "");

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("u") ?? "";
  const esperado = Deno.env.get("AGENDA_TOKEN");

  if (!esperado) return new Response("AGENDA_TOKEN não configurada", { status: 500 });

  // O painel pergunta "qual é o meu endereço de assinatura?" com o login
  // dele. Assim o segredo mora num lugar só — aqui — e não precisa ser
  // copiado pra dentro do banco nem pro código do navegador.
  if (url.searchParams.get("link") === "1") {
    const autorizacao = req.headers.get("Authorization") ?? "";
    if (!autorizacao.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ erro: "não autenticado" }), {
        status: 401,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }
    const comToken = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: autorizacao } } },
    );
    const { data, error } = await comToken.auth.getUser();
    if (error || !data?.user) {
      return new Response(JSON.stringify({ erro: "não autenticado" }), {
        status: 401,
        headers: { ...CORS, "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ url: `${url.origin}${url.pathname}?u=${encodeURIComponent(esperado)}` }),
      { headers: { ...CORS, "content-type": "application/json" } },
    );
  }

  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (token !== esperado) return new Response("não autorizado", { status: 401 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const [{ data: tarefas }, { data: casos }] = await Promise.all([
    supabase.from("tarefas").select("*, casos(nome, whatsapp)").order("quando"),
    supabase.from("casos_com_prazo").select("id, nome, prescreve_em, etapa"),
  ]);

  const agora = carimbo(new Date());
  const linhas: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Escritório//Painel//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Escritório — prazos e audiências",
    `X-WR-TIMEZONE:${TZ}`,
    // 1 hora: o celular volta a checar mais ou menos nesse ritmo
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  const ROTULO: Record<string, string> = {
    audiencia: "Audiência", prazo: "Prazo", reuniao: "Reunião", tarefa: "Tarefa",
  };

  for (const t of tarefas ?? []) {
    if (t.feita) continue;
    const inicio = new Date(t.quando);
    const fim = new Date(inicio.getTime() + 60 * 60000);
    const cliente = (t as any).casos?.nome;

    linhas.push(
      "BEGIN:VEVENT",
      `UID:tarefa-${t.id}@escritorio`,
      `DTSTAMP:${agora}`,
      `DTSTART:${carimbo(inicio)}`,
      `DTEND:${carimbo(fim)}`,
      dobra(`SUMMARY:${txt((ROTULO[t.tipo] ?? "Compromisso") + ": " + t.titulo)}`),
      cliente ? dobra(`DESCRIPTION:${txt("Cliente: " + cliente)}`) : "DESCRIPTION:",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      // audiência avisa com um dia; o resto, duas horas antes
      `TRIGGER:${t.tipo === "audiencia" ? "-P1D" : "-PT2H"}`,
      dobra(`DESCRIPTION:${txt(t.titulo)}`),
      "END:VALARM",
      "END:VEVENT",
    );
  }

  for (const c of casos ?? []) {
    if (!c.prescreve_em) continue;
    if (c.etapa === "encerrado" || c.etapa === "descartado") continue;

    const dia = soData(c.prescreve_em);
    const seguinte = new Date(c.prescreve_em + "T00:00:00");
    seguinte.setDate(seguinte.getDate() + 1);

    linhas.push(
      "BEGIN:VEVENT",
      `UID:prescricao-${c.id}@escritorio`,
      `DTSTAMP:${agora}`,
      `DTSTART;VALUE=DATE:${dia}`,
      `DTEND;VALUE=DATE:${soData(seguinte.toISOString())}`,
      dobra(`SUMMARY:${txt("PRESCREVE: " + c.nome)}`),
      dobra(`DESCRIPTION:${txt(
        "Prazo bienal do art. 7º, XXIX da Constituição. Depois desta data a ação trabalhista prescreve."
      )}`),
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      // 30 dias antes: prazo de prescrição avisado em cima da hora não serve
      "TRIGGER:-P30D",
      dobra(`DESCRIPTION:${txt("Falta um mês para prescrever: " + c.nome)}`),
      "END:VALARM",
      "END:VEVENT",
    );
  }

  linhas.push("END:VCALENDAR");

  return new Response(linhas.join("\r\n"), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
});
