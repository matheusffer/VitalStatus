import { dataHora, duracao } from "./tempo";
import type { Config, Evento } from "./types";

/** Monta a mensagem de alerta em texto puro (sem Markdown/HTML/emoji). */
export function montarMensagem(
  evento: Evento,
  config: Config,
  nomes: { grupo: string; componente: string },
  detalhe?: string,
): string {
  const inc = evento.incidente;
  const alvo = `${nomes.grupo} — ${nomes.componente}`;
  const link = `Acompanhe: ${config.site.url}`;
  const ultimoTexto = detalhe ?? inc.atualizacoes[inc.atualizacoes.length - 1]?.texto;

  if (evento.tipo === "resolvido") {
    const fim = inc.fim ?? inc.atualizacoes[inc.atualizacoes.length - 1]?.em ?? inc.inicio;
    return [
      `[NORMALIZADO] ${alvo}`,
      `Duração: ${duracao(inc.inicio, fim)}`,
      link,
    ].join("\n");
  }

  let cabecalho: string;
  if (evento.tipo === "aberto") {
    const tag = inc.gravidade === "fora" ? "FORA DO AR" : "INSTABILIDADE";
    cabecalho = `[${tag}] ${alvo}`;
  } else {
    cabecalho =
      inc.gravidade === "fora"
        ? `[ATUALIZAÇÃO] ${alvo} agora fora do ar`
        : `[ATUALIZAÇÃO] ${alvo} voltou a responder, ainda instável`;
  }

  const linhas = [cabecalho, `Início: ${dataHora(inc.inicio)}`];
  if (ultimoTexto) linhas.push(`Detalhe: ${ultimoTexto}`);
  linhas.push(link);
  return linhas.join("\n");
}

/** Envia uma mensagem para o Telegram sem vazar token ou URL em logs ou erros. */
export async function enviar(
  texto: string,
  env: NodeJS.ProcessEnv = process.env,
  f: typeof fetch = fetch,
): Promise<{ ok: boolean; erro?: string }> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.ALERT_CHAT_ID?.trim();
  if (!token || !chatId) {
    return { ok: false, erro: "Telegram não configurado" };
  }

  const corpo: Record<string, unknown> = {
    chat_id: chatId,
    text: texto,
    disable_web_page_preview: true,
  };

  const threadBruto = env.ALERT_THREAD_ID?.trim();
  if (threadBruto) {
    const threadId = Number(threadBruto);
    if (Number.isInteger(threadId) && threadId > 0) {
      corpo.message_thread_id = threadId;
    }
  }

  try {
    const resp = await f(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(10_000),
    });

    let dados: { ok?: boolean; description?: string; error_code?: number } | undefined;
    try {
      dados = (await resp.json()) as { ok?: boolean; description?: string; error_code?: number };
    } catch {
      dados = undefined;
    }

    if (!resp.ok) {
      const desc = typeof dados?.description === "string" ? `: ${dados.description}` : "";
      return { ok: false, erro: `HTTP ${resp.status}${desc}` };
    }
    if (dados && dados.ok === false) {
      return {
        ok: false,
        erro: typeof dados.description === "string" ? dados.description : "erro na API do Telegram",
      };
    }
    return { ok: true };
  } catch {
    // Nunca inclui err.message para evitar qualquer vazamento acidental da URL com token.
    return { ok: false, erro: "falha de conexão" };
  }
}
