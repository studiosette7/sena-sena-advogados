// ============================================================
// SENA & SENA — Edge Function "triagem"
//
// Recebe o id de um caso, lê a ficha que a pessoa preencheu na landing e
// devolve uma análise preliminar: viabilidade, o que pedir de documento,
// o que ainda falta perguntar e um rascunho de resposta pro WhatsApp.
//
// Roda no servidor (Deno). A chave da Anthropic é secret do Supabase e
// nunca chega no navegador. Exige usuário logado — o público não chama isso.
//
// Deploy:  npx supabase functions deploy triagem
// Segredo: npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// ============================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// ---------- o formato exato que a IA tem que devolver ----------
// Structured outputs: a API garante que a resposta valida contra este schema,
// então o painel nunca recebe JSON quebrado e não precisa de try/catch de parse.
const SCHEMA = {
  type: "object",
  properties: {
    viabilidade: {
      type: "string",
      enum: ["provavel", "possivel", "improvavel", "fora_da_area"],
      description:
        "provavel = há caminho claro; possivel = depende de prova ou de informação que falta; " +
        "improvavel = os fatos relatados não sustentam ação; fora_da_area = não é trabalhista nem previdenciário",
    },
    resumo: {
      type: "string",
      description: "Uma ou duas frases dizendo o que aconteceu com essa pessoa, em português simples.",
    },
    teses: {
      type: "array",
      items: { type: "string" },
      description: "Pedidos ou teses que os fatos relatados comportam. Vazio se não houver.",
    },
    pontos_atencao: {
      type: "array",
      items: { type: "string" },
      description:
        "O que pode derrubar ou enfraquecer o caso: prazo apertado, falta de prova, " +
        "relato contraditório, verba já quitada. Vazio se não houver.",
    },
    documentos_pedir: {
      type: "array",
      items: { type: "string" },
      description: "Documentos a pedir para essa pessoa, do mais decisivo para o menos.",
    },
    perguntas_fazer: {
      type: "array",
      items: { type: "string" },
      description: "O que ainda falta saber antes de decidir. No máximo 4.",
    },
    resposta_whatsapp: {
      type: "string",
      description:
        "Rascunho da primeira resposta ao cliente pelo WhatsApp, para o advogado revisar antes de enviar.",
    },
    urgencia: {
      type: "string",
      enum: ["alta", "media", "baixa"],
      description: "alta quando o prazo aperta ou há risco de perda de direito.",
    },
  },
  required: [
    "viabilidade", "resumo", "teses", "pontos_atencao",
    "documentos_pedir", "perguntas_fazer", "resposta_whatsapp", "urgencia",
  ],
  additionalProperties: false,
};

// ---------- instruções ----------
// Fica estável de propósito: assim o prompt caching funciona e as chamadas
// seguintes leem o cache em vez de reprocessar tudo.
const SISTEMA = `
Você assessora Gildemi Sena, advogado (OAB/SP 417.105) que atua em Direito do
Trabalho e Previdenciário no ABC Paulista. Ele é sempre o polo ativo: processa
empregador e processa o INSS.

Sua função é fazer a TRIAGEM INTERNA de um lead que preencheu o formulário do
site. Você escreve para o advogado, não para o cliente.

Como avaliar
- Trabalhe apenas com os fatos relatados. Não invente vínculo, salário, data,
  função nem documento que a pessoa não mencionou.
- O relato é de leigo, feito num formulário. É incompleto por natureza. Quando
  faltar informação decisiva, diga isso em "perguntas_fazer" em vez de supor.
- Prazo importa: na Justiça do Trabalho a ação prescreve em 2 anos contados do
  fim do contrato, e dentro dela se cobra os últimos 5 anos. Se o relato indicar
  que o prazo está perto do fim ou já passou, isso é ponto de atenção e a
  urgência sobe.
- No INSS a lógica é outra: indeferimento pode ser rediscutido, e revisão de
  valor tem prazo decadencial de 10 anos. O motivo da negativa determina a
  estratégia — se a pessoa não disse o motivo, pergunte.
- "viabilidade" é leitura preliminar, não parecer. Prefira "possivel" quando o
  caso depender de prova ou de informação que não está na ficha.

O rascunho de WhatsApp
Escreva como o próprio advogado escreveria: primeira pessoa, direto, sem
juridiquês, sem saudação genérica longa. De 3 a 6 linhas. Deve reconhecer o
caso da pessoa, pedir o documento mais decisivo e propor o próximo passo.

Restrições da OAB — valem para o rascunho e para tudo que possa chegar ao cliente:
- Não prometa nem sugira resultado. Nada de "você vai receber", "é ganho certo",
  "garantimos". Fale em analisar, verificar, entrar com a ação.
- Não cite valores, honorários, percentuais nem estimativa de quanto a pessoa
  tem a receber.
- Não ofereça consulta gratuita nem qualquer serviço sem custo como atrativo.
- Sem sensacionalismo e sem comparação com outros advogados.

Escreva tudo em português do Brasil.
`.trim();

function fichaEmTexto(c: Record<string, any>): string {
  const linha = (rotulo: string, valor: unknown) => {
    if (valor === null || valor === undefined) return "";
    const t = Array.isArray(valor) ? valor.join(", ") : String(valor).trim();
    return t ? `${rotulo}: ${t}\n` : "";
  };
  return (
    linha("Área", c.area) +
    linha("Situação", c.situacao) +
    linha("Tempo desde a saída", c.saida) +
    linha("O que a pessoa acha que ficou pra trás", c.pontos) +
    linha("Benefício pretendido", c.beneficio) +
    linha("Situação no INSS", c.inss) +
    linha("Documentos que diz ter", c.documentos) +
    linha("Relato dela", c.relato) +
    linha("Cidade", c.cidade)
  ).trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "método não permitido" }, 405);

  // ---------- 1) só usuário logado ----------
  const autorizacao = req.headers.get("Authorization") ?? "";
  if (!autorizacao.startsWith("Bearer ")) {
    return json({ erro: "não autenticado" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: autorizacao } } },
  );

  const { data: sessao, error: erroAuth } = await supabase.auth.getUser();
  if (erroAuth || !sessao?.user) return json({ erro: "não autenticado" }, 401);

  // ---------- 2) carrega o caso ----------
  let corpo: { caso_id?: string };
  try {
    corpo = await req.json();
  } catch {
    return json({ erro: "corpo inválido" }, 400);
  }
  if (!corpo.caso_id) return json({ erro: "informe caso_id" }, 400);

  // O select passa pelo RLS com o token do usuário: se ele não pode ver o
  // caso, não vem nada — a função não contorna a permissão do banco.
  const { data: caso, error: erroCaso } = await supabase
    .from("casos")
    .select("*")
    .eq("id", corpo.caso_id)
    .single();

  if (erroCaso || !caso) return json({ erro: "caso não encontrado" }, 404);

  // ---------- 3) chama a IA ----------
  const chave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!chave) return json({ erro: "ANTHROPIC_API_KEY não configurada" }, 500);

  const anthropic = new Anthropic({ apiKey: chave });

  let resposta;
  try {
    resposta = await anthropic.beta.messages.create({
      model: "claude-opus-5",
      // Folgado de propósito: no Opus 5 o raciocínio vem ligado por padrão e
      // divide o teto de max_tokens com o texto da resposta.
      max_tokens: 8000,
      // Se o classificador recusar, a API reprocessa sozinha noutro modelo em
      // vez de devolver resposta vazia.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{
        type: "text",
        text: SISTEMA,
        // As instruções não mudam entre chamadas: cacheadas, as próximas
        // triagens leem por ~10% do preço de entrada.
        cache_control: { type: "ephemeral" },
      }],
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: `Faça a triagem desta ficha:\n\n${fichaEmTexto(caso)}`,
      }],
      // `fallbacks` ainda não está nos tipos publicados do SDK.
    } as any);
  } catch (e) {
    return json({ erro: "falha ao chamar a IA", detalhe: String(e) }, 502);
  }

  // Recusa do classificador vem como HTTP 200 com content vazio — precisa
  // ser checada antes de ler o conteúdo, senão quebra em content[0].
  if (resposta.stop_reason === "refusal") {
    return json({
      erro: "a IA recusou analisar esse caso",
      categoria: resposta.stop_details?.category ?? null,
    }, 422);
  }
  if (resposta.stop_reason === "max_tokens") {
    return json({ erro: "análise ficou incompleta (max_tokens)" }, 502);
  }

  const bloco = resposta.content.find((b: any) => b.type === "text");
  if (!bloco) return json({ erro: "resposta da IA sem texto" }, 502);

  const analise = JSON.parse((bloco as any).text);

  // ---------- 4) grava no caso ----------
  const { error: erroGravar } = await supabase
    .from("casos")
    .update({ ia: analise, ia_at: new Date().toISOString() })
    .eq("id", corpo.caso_id);

  if (erroGravar) {
    return json({ erro: "análise feita, mas falhou ao gravar", detalhe: erroGravar.message }, 500);
  }

  return json({
    ok: true,
    analise,
    uso: {
      entrada: resposta.usage.input_tokens,
      saida: resposta.usage.output_tokens,
      cache_lido: resposta.usage.cache_read_input_tokens ?? 0,
      cache_escrito: resposta.usage.cache_creation_input_tokens ?? 0,
    },
  });
});
