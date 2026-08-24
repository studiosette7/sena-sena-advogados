/* ============================================================
   SENA & SENA — ponte do WhatsApp

   Um processo Node que segura a sessao do WhatsApp Web e conversa
   com o Supabase. O painel nunca fala com o WhatsApp direto: ele le
   e escreve nas tabelas, e quem faz a ponte e este arquivo.

   O que ele faz:
     1. Gera o QR Code e grava em `wpp_sessao` — o painel mostra na tela.
     2. Mensagem que chega  -> cria/atualiza `contatos`, `conversas_wpp`
        e grava em `mensagens_wpp`.
     3. Mensagem pra enviar -> le `wpp_fila`, manda, marca enviada.
     4. Puxa a agenda de contatos do aparelho na primeira conexao.

   ⚠️ LEIA ANTES DE RODAR
   Espelhar o WhatsApp por QR Code usa biblioteca nao-oficial. Funciona
   e muita gente usa, mas contraria os termos do WhatsApp e existe risco
   real de o numero ser bloqueado. Use um NUMERO NOVO do escritorio —
   nunca o numero pessoal do advogado, que e a agenda de clientes dele.

   Nao roda em Edge Function: precisa de um processo vivo com websocket
   aberto. Suba num servidor pequeno (Railway, Render, Fly.io ou VPS).

   Variaveis de ambiente:
     SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY
   ============================================================ */

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import QRCode from 'qrcode';
import pino from 'pino';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const log = pino({ level: 'warn' });

/* ---------- ajudantes ---------- */

/** O JID do WhatsApp vem como 5511999998888@s.whatsapp.net */
function soDigitos(jid) {
  return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

/** Grupo, status e transmissao ficam de fora: aqui e atendimento 1 a 1. */
function ehPessoa(jid) {
  return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
}

function textoDaMensagem(m) {
  const c = m.message || {};
  if (c.conversation) return { tipo: 'texto', texto: c.conversation };
  if (c.extendedTextMessage?.text) return { tipo: 'texto', texto: c.extendedTextMessage.text };
  if (c.imageMessage) return { tipo: 'imagem', texto: c.imageMessage.caption || '[imagem]' };
  if (c.videoMessage) return { tipo: 'outro', texto: c.videoMessage.caption || '[vídeo]' };
  if (c.audioMessage) return { tipo: 'audio', texto: '[áudio]' };
  if (c.documentMessage) return {
    tipo: 'documento',
    texto: c.documentMessage.fileName ? `[documento] ${c.documentMessage.fileName}` : '[documento]',
  };
  if (c.stickerMessage) return { tipo: 'outro', texto: '[figurinha]' };
  if (c.locationMessage) return { tipo: 'outro', texto: '[localização]' };
  return null;
}

async function marcaSessao(campos) {
  await supabase.from('wpp_sessao')
    .update({ ...campos, visto_at: new Date().toISOString() })
    .eq('id', 1);
}

/** Acha ou cria o contato e a conversa. Devolve o id da conversa. */
async function garanteConversa(jid, nomeWpp) {
  const telefone = soDigitos(jid);
  if (!telefone) return null;

  let { data: contato } = await supabase
    .from('contatos').select('id, nome, nome_wpp').eq('telefone', telefone).maybeSingle();

  if (!contato) {
    const { data, error } = await supabase.from('contatos')
      .insert({ telefone, jid, nome_wpp: nomeWpp || null })
      .select('id, nome, nome_wpp').single();
    if (error) { console.error('contato:', error.message); return null; }
    contato = data;
  } else if (nomeWpp && contato.nome_wpp !== nomeWpp) {
    // o nome do aparelho muda; o nome que o Gildemi editou nunca e sobrescrito
    await supabase.from('contatos').update({ nome_wpp: nomeWpp, jid }).eq('id', contato.id);
  }

  let { data: conversa } = await supabase
    .from('conversas_wpp').select('id').eq('contato_id', contato.id).maybeSingle();

  if (!conversa) {
    const { data, error } = await supabase.from('conversas_wpp')
      .insert({ contato_id: contato.id }).select('id').single();
    if (error) { console.error('conversa:', error.message); return null; }
    conversa = data;
  }
  return conversa.id;
}

/* ---------- o laco principal ---------- */
async function conectar() {
  // A sessao fica em disco: sem isso ele pede QR toda vez que reinicia.
  // Num servidor efemero, monte um volume nesta pasta.
  const { state, saveCreds } = await useMultiFileAuthState('./sessao');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: log,
    // marcar como online faz o WhatsApp parar de mandar notificacao pro
    // celular do Gildemi; ele continua usando o aparelho normalmente
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect, qr } = u;

    if (qr) {
      // grava o QR ja como imagem: o painel so precisa mostrar
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      await marcaSessao({ estado: 'qr', qr: dataUrl, erro: null });
      console.log('QR gerado — escaneie pelo painel');
    }

    if (connection === 'open') {
      await marcaSessao({
        estado: 'conectado',
        qr: null,
        numero: soDigitos(sock.user?.id),
        erro: null,
      });
      console.log('conectado como', sock.user?.id);
      puxaAgenda(sock).catch((e) => console.error('agenda:', e.message));
    }

    if (connection === 'close') {
      const motivo = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const deslogado = motivo === DisconnectReason.loggedOut;
      await marcaSessao({
        estado: 'desconectado',
        qr: null,
        erro: deslogado ? 'sessão encerrada no aparelho — precisa parear de novo' : null,
      });
      console.log('caiu.', deslogado ? 'deslogado' : 'reconectando…');
      if (!deslogado) setTimeout(conectar, 4000);
    }
  });

  /* ---------- mensagens que chegam ---------- */
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const m of messages) {
      const jid = m.key?.remoteJid;
      if (!ehPessoa(jid)) continue;

      const conteudo = textoDaMensagem(m);
      if (!conteudo) continue;

      const conversaId = await garanteConversa(jid, m.pushName);
      if (!conversaId) continue;

      const deMim = !!m.key.fromMe;

      // id_wpp e unico: se a mesma mensagem chegar duas vezes, nao duplica
      const { error } = await supabase.from('mensagens_wpp').upsert({
        conversa_id: conversaId,
        id_wpp: m.key.id,
        de_mim: deMim,
        tipo: conteudo.tipo,
        texto: conteudo.texto,
        entregue: true,
        criado_at: m.messageTimestamp
          ? new Date(Number(m.messageTimestamp) * 1000).toISOString()
          : new Date().toISOString(),
      }, { onConflict: 'id_wpp', ignoreDuplicates: true });

      if (error) { console.error('mensagem:', error.message); continue; }

      const previa = conteudo.texto.slice(0, 120);
      const { data: atual } = await supabase
        .from('conversas_wpp').select('nao_lidas').eq('id', conversaId).single();

      await supabase.from('conversas_wpp').update({
        ultima_at: new Date().toISOString(),
        ultima_previa: (deMim ? 'Você: ' : '') + previa,
        nao_lidas: deMim ? 0 : (atual?.nao_lidas ?? 0) + 1,
      }).eq('id', conversaId);
    }
  });

  /* ---------- fila de saida ---------- */
  // O painel enfileira e segue a vida; quem entrega e este laco.
  setInterval(async () => {
    const { data: pendentes } = await supabase
      .from('wpp_fila').select('*').is('enviada_at', null)
      .order('criado_at').limit(5);

    for (const item of pendentes ?? []) {
      try {
        const jid = item.telefone.replace(/\D/g, '') + '@s.whatsapp.net';
        const enviada = await sock.sendMessage(jid, { text: item.texto });

        await supabase.from('wpp_fila')
          .update({ enviada_at: new Date().toISOString(), erro: null }).eq('id', item.id);

        // grava tambem na conversa, pra aparecer na tela na hora
        const conversaId = await garanteConversa(jid, null);
        if (conversaId) {
          await supabase.from('mensagens_wpp').upsert({
            conversa_id: conversaId,
            id_wpp: enviada?.key?.id ?? null,
            de_mim: true, tipo: 'texto', texto: item.texto, entregue: true,
          }, { onConflict: 'id_wpp', ignoreDuplicates: true });

          await supabase.from('conversas_wpp').update({
            ultima_at: new Date().toISOString(),
            ultima_previa: 'Você: ' + item.texto.slice(0, 120),
            nao_lidas: 0,
          }).eq('id', conversaId);
        }
      } catch (e) {
        await supabase.from('wpp_fila')
          .update({ enviada_at: new Date().toISOString(), erro: String(e.message || e) })
          .eq('id', item.id);
        console.error('envio:', e.message);
      }
    }
  }, 3000);

  return sock;
}

/** Traz a agenda do aparelho pro CRM na primeira conexao. */
async function puxaAgenda(sock) {
  const store = sock.store?.contacts;
  if (!store) return;

  const linhas = Object.values(store)
    .filter((c) => ehPessoa(c.id))
    .map((c) => ({
      telefone: soDigitos(c.id),
      jid: c.id,
      nome_wpp: c.name || c.notify || c.verifiedName || null,
    }))
    .filter((c) => c.telefone.length >= 10);

  if (!linhas.length) return;

  // ignoreDuplicates: contato que ja existe mantem o nome que ele editou
  const { error } = await supabase.from('contatos')
    .upsert(linhas, { onConflict: 'telefone', ignoreDuplicates: true });

  if (error) console.error('agenda:', error.message);
  else console.log(linhas.length, 'contatos sincronizados');
}

conectar().catch((e) => {
  console.error('não subiu:', e);
  process.exit(1);
});
