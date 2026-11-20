import { afterEach, describe, expect, it, vi } from "vitest";
import { enviar, montarMensagem } from "../scripts/lib/telegram";
import type { Config, Evento, Incidente } from "../scripts/lib/types";

const CONFIG: Config = {
  site: {
    nome: "Status Vital",
    url: "https://status.vitalerp.tech",
    contato: "https://vitalerp.tech",
    ajuda: "https://gerencial.vitalerp.tech/ajuda",
    intervaloMin: 5,
  },
  padroes: { timeoutMs: 8000, latenciaMaxMs: 5000, falhasParaConfirmar: 2 },
  grupos: [],
};

const NOMES = { grupo: "Vital ERP", componente: "Banco de dados" };

function incBase(override: Partial<Incidente> = {}): Incidente {
  return {
    id: "erp-banco-1",
    componente: "erp-banco",
    grupo: "erp",
    titulo: "Vital ERP: Banco de dados fora do ar",
    gravidade: "fora",
    inicio: "2026-11-20T17:30:00.000Z", // 14:30 em Brasília
    atualizacoes: [{ em: "2026-11-20T17:30:00.000Z", classe: "fora", texto: "HTTP 503" }],
    avisos: { aberto: false, resolvido: false },
    ...override,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("montarMensagem", () => {
  it("formata abertura fora do ar e instabilidade sem emoji nem URL interna", () => {
    const msgFora = montarMensagem({ tipo: "aberto", incidente: incBase() }, CONFIG, NOMES, "HTTP 503");
    expect(msgFora).toBe(
      [
        "[FORA DO AR] Vital ERP — Banco de dados",
        "Início: 20/11/2026 14:30",
        "Detalhe: HTTP 503",
        "Acompanhe: https://status.vitalerp.tech",
      ].join("\n"),
    );

    const msgDeg = montarMensagem(
      { tipo: "aberto", incidente: incBase({ gravidade: "degradado" }) },
      CONFIG,
      NOMES,
      "resposta lenta (6100 ms)",
    );
    expect(msgDeg).toContain("[INSTABILIDADE] Vital ERP — Banco de dados");
    expect(msgDeg).toContain("Detalhe: resposta lenta (6100 ms)");
  });

  it("formata atualização de gravidade e normalização", () => {
    const piora: Evento = {
      tipo: "atualizado",
      anterior: "degradado",
      incidente: incBase({ gravidade: "fora" }),
    };
    expect(montarMensagem(piora, CONFIG, NOMES)).toContain(
      "[ATUALIZAÇÃO] Vital ERP — Banco de dados agora fora do ar",
    );

    const melhora: Evento = {
      tipo: "atualizado",
      anterior: "fora",
      incidente: incBase({ gravidade: "degradado" }),
    };
    expect(montarMensagem(melhora, CONFIG, NOMES)).toContain(
      "[ATUALIZAÇÃO] Vital ERP — Banco de dados voltou a responder, ainda instável",
    );

    const resolvido: Evento = {
      tipo: "resolvido",
      incidente: incBase({ fim: "2026-11-20T17:42:00.000Z" }),
    };
    expect(montarMensagem(resolvido, CONFIG, NOMES)).toBe(
      [
        "[NORMALIZADO] Vital ERP — Banco de dados",
        "Duração: 12 min",
        "Acompanhe: https://status.vitalerp.tech",
      ].join("\n"),
    );
  });
});

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

describe("enviar", () => {
  it("retorna erro sem chamar fetch quando env não está configurado", async () => {
    const f = vi.fn<FetchFn>();
    const res = await enviar("teste", {}, f as unknown as typeof fetch);
    expect(res).toEqual({ ok: false, erro: "Telegram não configurado" });
    expect(f).not.toHaveBeenCalled();
  });

  it("envia JSON correto com message_thread_id", async () => {
    const f = vi.fn<FetchFn>().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const res = await enviar(
      "Olá",
      {
        TELEGRAM_BOT_TOKEN: "123:SEGREDO",
        ALERT_CHAT_ID: "-100999",
        ALERT_THREAD_ID: "42",
      },
      f as unknown as typeof fetch,
    );

    expect(res).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/bot123:SEGREDO/sendMessage");
    expect(JSON.parse(String(init?.body))).toEqual({
      chat_id: "-100999",
      text: "Olá",
      message_thread_id: 42,
      disable_web_page_preview: true,
    });
  });

  it("nunca vaza o token em erros de rede ou HTTP", async () => {
    const token = "999999:TOKEN_MUITO_SECRETO";
    const fRede = vi
      .fn<FetchFn>()
      .mockRejectedValue(new Error(`falha em https://api.telegram.org/bot${token}/sendMessage`));

    const r1 = await enviar("Olá", { TELEGRAM_BOT_TOKEN: token, ALERT_CHAT_ID: "1" }, fRede as unknown as typeof fetch);
    expect(r1.ok).toBe(false);
    expect(r1.erro).toBe("falha de conexão");
    expect(r1.erro).not.toContain(token);

    const fHttp = vi
      .fn<FetchFn>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: false, description: "Bad Request" }), { status: 400 }));

    const r2 = await enviar("Olá", { TELEGRAM_BOT_TOKEN: token, ALERT_CHAT_ID: "1" }, fHttp as unknown as typeof fetch);
    expect(r2).toEqual({ ok: false, erro: "HTTP 400: Bad Request" });
    expect(r2.erro).not.toContain(token);
  });
});
