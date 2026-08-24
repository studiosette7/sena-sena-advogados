// ============================================================
// SENA & SENA — Edge Function "advogado"
//
// A assistente especializada em Direito do Trabalho e Previdenciário.
// Três coisas:
//
//   POST { acao: "ler",      documento_id }        → lê um PDF e destrincha
//   POST { acao: "perguntar", pergunta, caso_id? } → responde com fonte real
//   POST { acao: "minutar",  caso_id, peca }       → rascunha a peça
//
// A REGRA QUE MANDA EM TUDO
// Jurisprudência inventada é o modo de falha conhecido desses sistemas, e
// já rendeu punição a advogado que citou acórdão inexistente. Por isso:
//   • citação de lei, súmula ou acórdão só sai com busca feita na hora;
//   • sem fonte verificável, a IA diz que não achou em vez de preencher;
//   • peça sai como MINUTA, com os pontos a conferir listados no fim.
//
// Deploy: npx supabase functions deploy advogado
// Segredo: npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// ============================================================

import Anthropic from "npm:@anthropic-ai/sdk@0.69.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "content-type": "application/json" } });

const MODELO = "claude-opus-5";

// ---------------------------------------------------------------
// As instruções. Ficam estáveis de propósito: assim o prompt caching
// pega e as chamadas seguintes leem por uma fração do preço.
// ---------------------------------------------------------------
const SISTEMA = `
Você assessora Gildemi Sena, advogado (OAB/SP 417.105) que atua em Direito do
Trabalho e Previdenciário no ABC Paulista. Ele é sempre o polo ativo: processa
empregador e processa o INSS. Você fala com o advogado, não com o cliente.

O QUE VOCÊ DOMINA
Direito do Trabalho: CLT, Constituição art. 7º, súmulas e orientações
jurisprudenciais do TST, reforma trabalhista (Lei 13.467/2017), prescrição
bienal e quinquenal, verbas rescisórias, jornada e horas extras, adicionais
(insalubridade, periculosidade, noturno), equiparação salarial, acúmulo de
função, rescisão indireta, dano moral trabalhista, grupo econômico e sucessão.

Direito Previdenciário: Lei 8.213/91, Decreto 3.048/99, benefícios por
incapacidade, aposentadorias (idade, tempo de contribuição, especial, PCD),
EC 103/2019 e suas regras de transição, tempo especial e conversão, PPP e
LTCAT, revisão da vida toda e demais teses de revisão, decadência decenal,
salário-maternidade, pensão por morte, BPC/LOAS.

COMO CITAR — leia com atenção
1. Artigo de lei você pode citar de memória quando tiver certeza absoluta do
   número e do texto. Na dúvida, busque antes.
2. Súmula, OJ, tema repetitivo e acórdão: NUNCA cite sem buscar. Se a busca
   não confirmar, escreva "não localizei precedente específico" em vez de
   arriscar. Número de processo inventado é o erro mais grave possível aqui.
3. Toda citação de jurisprudência vem com o link da fonte.
4. Quando o caso depender de entendimento que mudou ou está em disputa, diga
   isso explicitamente em vez de apresentar como pacífico.

COMO ESCREVER
Direto, técnico, sem encher linguiça. Ele é advogado: não explique o que é
prescrição, diga o que o prazo dele está pedindo. Use os fatos que estão no
material — não invente vínculo, salário, data, função nem documento.
Quando faltar informação decisiva, aponte a falta em vez de supor.

Português do Brasil.
`.trim();

const REGRA_PECA = `
A peça é MINUTA para o advogado revisar e assinar. Nunca escreva como se
estivesse pronta para protocolo.

- Use [COLCHETES MAIÚSCULOS] em tudo que você não sabe: [VALOR DA CAUSA],
  [CNPJ DA RECLAMADA], [DATA DA ADMISSÃO]. Não chute nenhum dado.
- Estrutura completa: endereçamento, qualificação, dos fatos, do direito
  (um tópico por tese), dos pedidos, do valor da causa, das provas, fecho.
- Cada tese no "do direito" vem com o fundamento legal. Jurisprudência só
  se você tiver buscado e confirmado.
- No fim, uma seção "A CONFERIR ANTES DE PROTOCOLAR" listando o que precisa
  ser preenchido, confirmado ou decidido por ele.
`.trim();

// ---------------------------------------------------------------
const ESQUEMA_DOCUMENTO = {
  type: "object",
  properties: {
    tipo_documento: { type: "string", description: "O que é esse documento, em duas ou três palavras." },
    resumo: { type: "string", description: "O que o documento diz, em um parágrafo." },
    partes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          nome: { type: "string" },
          papel: { type: "string", description: "reclamante, reclamada, autor, réu, segurado, perito…" },
        },
        required: ["nome", "papel"],
        additionalProperties: false,
      },
    },
    fatos: { type: "array", items: { type: "string" }, description: "Os fatos relevantes, do mais ao menos importante." },
    valores: {
      type: "array",
      items: { type: "string" },
      description: "Valores em dinheiro citados no documento, com o que cada um representa. Vazio se não houver.",
    },
    datas: {
      type: "array",
      description: "Datas com consequência: prazo, audiência, admissão, demissão, indeferimento.",
      items: {
        type: "object",
        properties: {
          data: { type: "string", description: "AAAA-MM-DD. Só se estiver no documento." },
          titulo: { type: "string" },
          tipo: { type: "string", enum: ["audiencia", "prazo", "reuniao", "tarefa"] },
          por_que: { type: "string" },
        },
        required: ["data", "titulo", "tipo", "por_que"],
        additionalProperties: false,
      },
    },
    pontos_favoraveis: { type: "array", items: { type: "string" } },
    pontos_contra: { type: "array", items: { type: "string" } },
    proximos_passos: { type: "array", items: { type: "string" } },
    documentos_faltando: { type: "array", items: { type: "string" } },
    alerta: {
      type: "string",
      description: "O que ele precisa saber AGORA. Vazio se não houver nada urgente.",
    },
  },
  required: [
    "tipo_documento", "resumo", "partes", "fatos", "valores", "datas",
    "pontos_favoraveis", "pontos_contra", "proximos_passos", "documentos_faltando", "alerta",
  ],
  additionalProperties: false,
};

// A busca é o que separa citação real de citação inventada.
const BUSCA = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 6,
  allowed_domains: [
    "planalto.gov.br", "tst.jus.br", "stf.jus.br", "stj.jus.br",
    "trt2.jus.br", "trf3.jus.br", "cnj.jus.br", "in.gov.br",
    "jusbrasil.com.br", "conjur.com.br", "gov.br",
  ],
};

function fichaEmTexto(c: Record<string, any>): string {
  const linha = (r: string, v: unknown) => {
    if (v === null || v === undefined) return "";
    const t = Array.isArray(v) ? v.join(", ") : String(v).trim();
    return t ? `${r}: ${t}\n` : "";
  };
  return (
    linha("Cliente", c.nome) + linha("Cidade", c.cidade) + linha("Área", c.area) +
    linha("Situação", c.situacao) + linha("Fim do contrato", c.data_saida) +
    linha("Tempo desde a saída", c.saida) + linha("Verbas apontadas", c.pontos) +
    linha("Benefício pretendido", c.beneficio) + linha("Situação no INSS", c.inss) +
    linha("Documentos que tem", c.documentos) + linha("Relato", c.relato) +
    linha("Notas do escritório", c.notas) +
    linha("Etapa", c.etapa) +
    (c.dias_restantes !== null && c.dias_restantes !== undefined
      ? `Prescrição: ${c.dias_restantes < 0 ? "JÁ PRESCREVEU" : c.dias_restantes + " dias restantes"} (${c.prescreve_em})\n`
      : "")
  ).trim();
}

/** Junta o texto e as fontes que a busca trouxe. */
function extrai(resposta: any) {
  let texto = "";
  const fontes: { titulo: string; url: string }[] = [];
  const vistos = new Set<string>();

  for (const bloco of resposta.content ?? []) {
    if (bloco.type === "text") {
      texto += bloco.text;
      for (const c of bloco.citations ?? []) {
        if (c.url && !vistos.has(c.url)) {
          vistos.add(c.url);
          fontes.push({ titulo: c.title ?? c.url, url: c.url });
        }
      }
    }
    if (bloco.type === "web_search_tool_result") {
      for (const r of bloco.content ?? []) {
        if (r.url && !vistos.has(r.url)) {
          vistos.add(r.url);
          fontes.push({ titulo: r.title ?? r.url, url: r.url });
        }
      }
    }
  }
  return { texto, fontes };
}

function checaParada(resposta: any) {
  if (resposta.stop_reason === "refusal") {
    return { erro: "a IA recusou responder isso", status: 422 };
  }
  if (resposta.stop_reason === "max_tokens") {
    return { erro: "a resposta ficou incompleta — tente uma pergunta mais estreita", status: 502 };
  }
  return null;
}

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

  const chave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!chave) return json({ erro: "ANTHROPIC_API_KEY não configurada" }, 500);
  const anthropic = new Anthropic({ apiKey: chave });

  let corpo: any;
  try { corpo = await req.json(); } catch { return json({ erro: "corpo inválido" }, 400); }

  const base = {
    model: MODELO,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    // Raciocínio adaptativo: análise jurídica pede pensamento, pergunta
    // curta não — e o modelo decide quanto gastar em cada uma.
    thinking: { type: "adaptive" },
  };

  try {
    // ============ LER UM DOCUMENTO ============
    if (corpo.acao === "ler") {
      if (!corpo.documento_id) return json({ erro: "informe documento_id" }, 400);

      const { data: doc, error: erroDoc } = await supabase
        .from("documentos").select("*, casos(*)").eq("id", corpo.documento_id).single();
      if (erroDoc || !doc) return json({ erro: "documento não encontrado" }, 404);

      const { data: arquivo, error: erroArq } = await supabase
        .storage.from("documentos").download(doc.caminho);
      if (erroArq || !arquivo) return json({ erro: "não deu pra abrir o arquivo" }, 404);

      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      // base64 em pedaços: string muito grande de uma vez estoura a pilha
      let bin = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const b64 = btoa(bin);

      const contexto = doc.casos ? `\n\nContexto do caso no escritório:\n${fichaEmTexto(doc.casos)}` : "";

      const resposta: any = await anthropic.beta.messages.create({
        ...base,
        max_tokens: 16000,
        system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
        output_config: { format: { type: "json_schema", schema: ESQUEMA_DOCUMENTO } },
        messages: [{
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } },
            {
              type: "text",
              text: `Leia este documento e destrinche para o Dr. Gildemi.

Só extraia data em "datas" se ela estiver escrita no documento. Não calcule
prazo processual de cabeça — se o documento disser "prazo de 15 dias", diga
isso em "por_que" e ponha a data só se o documento trouxer o termo inicial.${contexto}`,
            },
          ],
        }],
      } as any);

      const parada = checaParada(resposta);
      if (parada) return json({ erro: parada.erro }, parada.status);

      const bloco = resposta.content.find((b: any) => b.type === "text");
      if (!bloco) return json({ erro: "resposta sem texto" }, 502);
      const analise = JSON.parse(bloco.text);

      await supabase.from("documentos")
        .update({ analise, analise_at: new Date().toISOString(), tipo: analise.tipo_documento })
        .eq("id", corpo.documento_id);

      return json({
        ok: true, analise,
        uso: {
          entrada: resposta.usage.input_tokens, saida: resposta.usage.output_tokens,
          cache_lido: resposta.usage.cache_read_input_tokens ?? 0,
        },
      });
    }

    // ============ CONVERSAR ============
    // Responde em tempo real (SSE): o texto aparece enquanto sai, em vez
    // de a tela ficar parada um minuto. É o que faz parecer conversa.
    if (corpo.acao === "conversar") {
      if (!corpo.conversa_id) return json({ erro: "informe conversa_id" }, 400);
      if (!corpo.mensagem)    return json({ erro: "informe a mensagem" }, 400);

      const { data: conversa, error: erroConv } = await supabase
        .from("conversas").select("*").eq("id", corpo.conversa_id).single();
      if (erroConv || !conversa) return json({ erro: "conversa não encontrada" }, 404);

      // histórico: é isso que faz a IA lembrar do que foi dito antes
      const { data: anteriores } = await supabase
        .from("mensagens").select("papel, texto")
        .eq("conversa_id", corpo.conversa_id).order("criado_at").limit(40);

      // contexto do caso e do documento, quando a conversa está presa a algum
      let contexto = "";
      if (conversa.caso_id) {
        const { data: caso } = await supabase
          .from("casos_com_prazo").select("*").eq("id", conversa.caso_id).single();
        if (caso) contexto += `\n\n[Caso aberto no sistema]\n${fichaEmTexto(caso)}`;
      }
      if (conversa.documento_id) {
        const { data: doc } = await supabase
          .from("documentos").select("nome, tipo, analise").eq("id", conversa.documento_id).single();
        if (doc?.analise) {
          contexto += `\n\n[Documento que o advogado está olhando: ${doc.nome}]\n` +
            `${doc.analise.resumo}\nFatos: ${(doc.analise.fatos ?? []).join("; ")}\n` +
            `A favor: ${(doc.analise.pontos_favoraveis ?? []).join("; ")}\n` +
            `Contra: ${(doc.analise.pontos_contra ?? []).join("; ")}`;
        }
      }

      const mensagens = [
        ...(anteriores ?? []).map((m: any) => ({ role: m.papel, content: m.texto })),
        { role: "user" as const, content: corpo.mensagem + (anteriores?.length ? "" : contexto) },
      ];

      // grava a pergunta antes de responder: se a conexão cair no meio,
      // o que ele escreveu não some
      await supabase.from("mensagens").insert({
        conversa_id: corpo.conversa_id, papel: "user", texto: corpo.mensagem,
      });
      if (!conversa.titulo) {
        await supabase.from("conversas")
          .update({ titulo: String(corpo.mensagem).slice(0, 70) })
          .eq("id", corpo.conversa_id);
      }

      const fluxo = anthropic.beta.messages.stream({
        ...base,
        max_tokens: 12000,
        system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
        tools: [BUSCA],
        messages: mensagens,
      } as any);

      const enc = new TextEncoder();
      const corpoSSE = new ReadableStream({
        async start(controlador) {
          const manda = (evento: string, dados: unknown) =>
            controlador.enqueue(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`));

          try {
            for await (const ev of fluxo) {
              if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
                manda("texto", { t: ev.delta.text });
              }
              // avisa que foi buscar: um silêncio de 20s sem explicação
              // parece travamento
              if (ev.type === "content_block_start" && ev.content_block?.type === "server_tool_use") {
                manda("buscando", { q: (ev.content_block as any).input?.query ?? "" });
              }
            }

            const final: any = await fluxo.finalMessage();
            const parada = checaParada(final);
            if (parada) { manda("erro", { erro: parada.erro }); controlador.close(); return; }

            const { texto, fontes } = extrai(final);
            const uso = {
              entrada: final.usage.input_tokens,
              saida: final.usage.output_tokens,
              buscas: final.usage.server_tool_use?.web_search_requests ?? 0,
            };

            await supabase.from("mensagens").insert({
              conversa_id: corpo.conversa_id, papel: "assistant", texto, fontes, uso,
            });
            await supabase.from("conversas")
              .update({ mexida_at: new Date().toISOString() }).eq("id", corpo.conversa_id);

            manda("fim", { fontes, uso });
          } catch (e) {
            manda("erro", { erro: String(e) });
          }
          controlador.close();
        },
      });

      return new Response(corpoSSE, {
        headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }

    // ============ RESUMIR UM DOCUMENTO ============
    // O "próximo passo" depois da leitura: um resumo curto, do jeito que
    // ele mandaria pro cliente ou colaria numa nota do processo.
    if (corpo.acao === "resumir") {
      if (!corpo.documento_id) return json({ erro: "informe documento_id" }, 400);

      const { data: doc, error: erroDoc } = await supabase
        .from("documentos").select("*, casos(nome)").eq("id", corpo.documento_id).single();
      if (erroDoc || !doc?.analise) return json({ erro: "documento ainda não foi lido" }, 400);

      const para = corpo.para === "cliente" ? "cliente" : "escritorio";
      const instrucao = para === "cliente"
        ? `Escreva o resumo PARA O CLIENTE, no WhatsApp. Português de gente comum, sem
juridiquês, de 4 a 8 linhas. Diga o que aconteceu no processo e qual é o próximo
passo. Restrições da OAB: não prometa resultado, não cite valor de honorário, não
diga que vai ganhar. Assine como o escritório.`
        : `Escreva o resumo PARA O PRÓPRIO ADVOGADO, do jeito que ele colaria numa nota
do processo. Técnico, direto, de 5 a 10 linhas. O que a peça faz, o que ataca, o
que ele precisa responder e até quando.`;

      const resposta: any = await anthropic.beta.messages.create({
        ...base,
        max_tokens: 3000,
        system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
        messages: [{
          role: "user",
          content: `${instrucao}\n\nDocumento: ${doc.nome}` +
            (doc.casos?.nome ? `\nCliente: ${doc.casos.nome}` : "") +
            `\n\nO que foi lido dele:\n${JSON.stringify(doc.analise, null, 1)}`,
        }],
      } as any);

      const parada = checaParada(resposta);
      if (parada) return json({ erro: parada.erro }, parada.status);
      const { texto } = extrai(resposta);
      return json({ ok: true, resumo: texto, para });
    }

    // ============ MINUTAR PEÇA ============
    // Aceita caso_id, documento_id ou os dois. Vindo de um documento, a
    // peça já nasce respondendo o que está escrito nele.
    if (corpo.acao === "minutar") {
      let caso: any = null, doc: any = null;

      if (corpo.documento_id) {
        const { data } = await supabase
          .from("documentos").select("*, casos(*)").eq("id", corpo.documento_id).single();
        doc = data;
        if (doc?.casos) caso = doc.casos;
      }
      if (corpo.caso_id) {
        const { data } = await supabase
          .from("casos_com_prazo").select("*").eq("id", corpo.caso_id).single();
        if (data) caso = data;
      }
      if (!caso && !doc) return json({ erro: "informe caso_id ou documento_id" }, 400);

      // tudo que já foi lido dos documentos daquele caso entra junto
      let lidos: any[] = [];
      if (caso?.id) {
        const { data: docs } = await supabase
          .from("documentos").select("nome, tipo, analise").eq("caso_id", caso.id);
        lidos = (docs ?? []).filter((d: any) => d.analise);
      }
      if (doc?.analise && !lidos.some((d) => d.nome === doc.nome)) lidos.unshift(doc);

      const doDocumento = lidos.length
        ? "\n\nO que já foi lido dos documentos do caso:\n" +
          lidos.map((d: any) =>
            `— ${d.nome}: ${d.analise.resumo}\n  Fatos: ${(d.analise.fatos ?? []).join("; ")}` +
            (d.analise.pontos_contra?.length ? `\n  A rebater: ${d.analise.pontos_contra.join("; ")}` : "")
          ).join("\n")
        : "";

      const peca = String(corpo.peca || "petição inicial");
      const daFicha = caso ? fichaEmTexto(caso) : "Sem ficha de caso no sistema.";

      const resposta: any = await anthropic.beta.messages.create({
        ...base,
        max_tokens: 24000,
        system: [
          { type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } },
          { type: "text", text: REGRA_PECA, cache_control: { type: "ephemeral" } },
        ],
        tools: [BUSCA],
        messages: [{
          role: "user",
          content: `Minute uma ${peca}.\n\n${daFicha}${doDocumento}`,
        }],
      } as any);

      const parada = checaParada(resposta);
      if (parada) return json({ erro: parada.erro }, parada.status);

      const { texto, fontes } = extrai(resposta);
      return json({
        ok: true, peca: texto, fontes,
        uso: { entrada: resposta.usage.input_tokens, saida: resposta.usage.output_tokens },
      });
    }

    return json({ erro: "ação desconhecida" }, 400);
  } catch (e) {
    return json({ erro: "falha ao falar com a IA", detalhe: String(e) }, 502);
  }
});
