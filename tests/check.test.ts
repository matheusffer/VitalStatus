import { afterEach, describe, expect, it, vi } from "vitest";
import { avaliar, checarTudo, lerCaminho } from "../scripts/lib/check";
import type { Config, ConfigComponente } from "../scripts/lib/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lerCaminho", () => {
  it("navega objetos aninhados e devolve undefined quando quebra", () => {
    const obj = { dependencias: { banco: { estado: "ok" } }, nulo: null };
    expect(lerCaminho(obj, "dependencias.banco.estado")).toBe("ok");
    expect(lerCaminho(obj, "dependencias.cache.estado")).toBeUndefined();
    expect(lerCaminho(obj, "nulo.x")).toBeUndefined();
    expect(lerCaminho(obj, "")).toBeUndefined();
    expect(lerCaminho(obj, "toString")).toBeUndefined();
  });
});

describe("avaliar", () => {
  const baseComp: ConfigComponente = {
    id: "comp",
    nome: "Comp",
    url: "https://exemplo.vitalerp.tech",
  };

  it("retorna fora com ms 0 quando recebe Error", () => {
    const res = avaliar(baseComp, new Error("sem resposta em 8 s"), 5000);
    expect(res).toEqual({ classe: "fora", ms: 0, erro: "sem resposta em 8 s" });
  });

  it("valida status esperado explícito", () => {
    const comp: ConfigComponente = { ...baseComp, esperado: 200 };
    expect(avaliar(comp, { http: 503, texto: "err", ms: 100 }, 5000)).toEqual({
      classe: "fora",
      ms: 100,
      http: 503,
      erro: "HTTP 503 (esperado 200)",
    });
  });

  it("exige 2xx quando não há esperado nem json", () => {
    expect(avaliar(baseComp, { http: 404, texto: "", ms: 50 }, 5000)).toEqual({
      classe: "fora",
      ms: 50,
      http: 404,
      erro: "HTTP 404",
    });
    expect(avaliar(baseComp, { http: 204, texto: "", ms: 50 }, 5000)).toEqual({
      classe: "ok",
      ms: 50,
      http: 204,
    });
  });

  it("verifica trecho obrigatório em contem", () => {
    const comp: ConfigComponente = { ...baseComp, esperado: 200, contem: "Vital" };
    expect(avaliar(comp, { http: 200, texto: "Página qualquer", ms: 40 }, 5000)).toEqual({
      classe: "fora",
      ms: 40,
      http: 200,
      erro: "resposta sem o conteúdo esperado",
    });
    expect(avaliar(comp, { http: 200, texto: "Bem-vindo ao Vital", ms: 40 }, 5000).classe).toBe("ok");
  });

  it("avalia json mesmo com HTTP 503 quando esperado não está definido", () => {
    const comp: ConfigComponente = {
      ...baseComp,
      json: { caminho: "dependencias.banco.estado", em: ["ok"] },
    };

    const bom = avaliar(
      comp,
      { http: 503, texto: JSON.stringify({ dependencias: { banco: { estado: "ok" } } }), ms: 120 },
      5000,
    );
    expect(bom).toEqual({ classe: "ok", ms: 120, http: 503 });

    const ruim = avaliar(
      comp,
      { http: 503, texto: JSON.stringify({ dependencias: { banco: { estado: "erro" } } }), ms: 120 },
      5000,
    );
    expect(ruim).toEqual({
      classe: "fora",
      ms: 120,
      http: 503,
      erro: "dependencias.banco.estado = erro",
    });

    const invalido = avaliar(comp, { http: 200, texto: "{nao-json", ms: 30 }, 5000);
    expect(invalido).toEqual({
      classe: "fora",
      ms: 30,
      http: 200,
      erro: "resposta não é JSON válido",
    });
  });

  it("classifica como degradado quando excede latenciaMaxMs", () => {
    const comp: ConfigComponente = { ...baseComp, esperado: 200, latenciaMaxMs: 1000 };
    expect(avaliar(comp, { http: 200, texto: "ok", ms: 1500 }, 5000)).toEqual({
      classe: "degradado",
      ms: 1500,
      http: 200,
      erro: "resposta lenta (1500 ms)",
    });
  });
});

describe("checarTudo", () => {
  it("busca URL compartilhada apenas uma vez por rodada", async () => {
    const config: Config = {
      site: {
        nome: "Status Vital",
        url: "https://status.vitalerp.tech",
        contato: "https://vitalerp.tech",
        ajuda: "https://gerencial.vitalerp.tech/ajuda",
        intervaloMin: 5,
      },
      padroes: { timeoutMs: 8000, latenciaMaxMs: 5000, falhasParaConfirmar: 2 },
      grupos: [
        {
          id: "erp",
          nome: "Vital ERP",
          componentes: [
            {
              id: "erp-banco",
              nome: "Banco",
              url: "https://gerencial.vitalerp.tech/api/health?deep=1",
              json: { caminho: "dependencias.banco.estado", em: ["ok"] },
            },
            {
              id: "erp-fiscal",
              nome: "NF-e",
              url: "https://gerencial.vitalerp.tech/api/health?deep=1",
              json: { caminho: "dependencias.nfe.estado", em: ["ok"] },
            },
            {
              id: "erp-worker",
              nome: "Worker",
              url: "https://gerencial.vitalerp.tech/api/health?deep=1",
              json: { caminho: "dependencias.worker.estado", em: ["ok"] },
            },
          ],
        },
      ],
    };

    // Uma Response nova por chamada: o corpo só pode ser lido uma vez.
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            dependencias: {
              banco: { estado: "ok" },
              nfe: { estado: "ok" },
              worker: { estado: "falha" },
            },
          }),
          { status: 503 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await checarTudo(config, { retentativaMs: 1 });
    // 1ª tentativa devolveu 503, então ocorre 1 retentativa = 2 chamadas totais (não 6!).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res["erp-banco"]?.classe).toBe("ok");
    expect(res["erp-fiscal"]?.classe).toBe("ok");
    expect(res["erp-worker"]?.classe).toBe("fora");
    expect(res["erp-worker"]?.erro).toBe("dependencias.worker.estado = falha");
  });

  it("faz uma retentativa após erro de rede e usa a 2ª resposta", async () => {
    const config: Config = {
      site: {
        nome: "Status Vital",
        url: "https://status.vitalerp.tech",
        contato: "https://vitalerp.tech",
        ajuda: "https://gerencial.vitalerp.tech/ajuda",
        intervaloMin: 5,
      },
      padroes: { timeoutMs: 8000, latenciaMaxMs: 5000, falhasParaConfirmar: 2 },
      grupos: [
        {
          id: "pdv",
          nome: "Vital PDV",
          componentes: [{ id: "pdv-api", nome: "API", url: "https://vitalpdv.tech/api/v1/live", esperado: 200 }],
        },
      ],
    };

    const errRede = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(errRede)
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const okRes = await checarTudo(config, { retentativaMs: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(okRes["pdv-api"]?.classe).toBe("ok");

    const timeoutErr = new DOMException("timed out", "TimeoutError");
    const fetchTimeout = vi
      .fn()
      .mockRejectedValueOnce(errRede)
      .mockRejectedValueOnce(timeoutErr);
    vi.stubGlobal("fetch", fetchTimeout);

    const failRes = await checarTudo(config, { retentativaMs: 1 });
    expect(failRes["pdv-api"]).toEqual({ classe: "fora", ms: 0, erro: "sem resposta em 8 s" });
  });
});
