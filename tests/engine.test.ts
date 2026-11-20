import { describe, expect, it } from "vitest";
import { RECENTES_MAX, agregar, aplicar, estadoVazio } from "../scripts/lib/engine";
import type { Config, Resultado } from "../scripts/lib/types";

const CONFIG_TESTE: Config = {
  site: {
    nome: "Status Vital",
    url: "https://status.vitalerp.tech",
    contato: "https://vitalerp.tech",
    ajuda: "https://gerencial.vitalerp.tech/ajuda",
    intervaloMin: 5,
  },
  padroes: {
    timeoutMs: 8000,
    latenciaMaxMs: 5000,
    falhasParaConfirmar: 2,
  },
  grupos: [
    {
      id: "erp",
      nome: "Vital ERP",
      componentes: [
        { id: "erp-api", nome: "API", url: "https://exemplo/api" },
        { id: "erp-banco", nome: "Banco de dados", url: "https://exemplo/banco" },
      ],
    },
  ],
};

const OK: Resultado = { classe: "ok", ms: 50, http: 200 };
const FORA: Resultado = { classe: "fora", ms: 0, erro: "HTTP 503" };
const DEGRADADO: Resultado = { classe: "degradado", ms: 6200, http: 200, erro: "resposta lenta (6200 ms)" };
const SEM_MANUT = new Set<string>();

describe("engine", () => {
  it("não abre incidente com 1 falha e abre na 2ª seguida com início na 1ª falha", () => {
    const t1 = new Date("2026-11-20T14:00:00.000Z");
    const t2 = new Date("2026-11-20T14:05:00.000Z");

    const r1 = aplicar(estadoVazio(), CONFIG_TESTE, { "erp-api": FORA }, t1, SEM_MANUT);
    expect(r1.eventos).toHaveLength(0);
    expect(r1.estado.incidentes).toHaveLength(0);
    expect(r1.estado.componentes["erp-api"]?.confirmado).toBe("ok");
    expect(r1.estado.componentes["erp-api"]?.candidato).toBe("fora");

    const r2 = aplicar(r1.estado, CONFIG_TESTE, { "erp-api": FORA }, t2, SEM_MANUT);
    expect(r2.eventos).toHaveLength(1);
    expect(r2.eventos[0]?.tipo).toBe("aberto");
    expect(r2.estado.componentes["erp-api"]?.confirmado).toBe("fora");
    expect(r2.estado.incidentes).toHaveLength(1);
    expect(r2.estado.incidentes[0]?.inicio).toBe(t1.toISOString());
    expect(r2.estado.incidentes[0]?.gravidade).toBe("fora");
  });

  it("aplica anti-oscilação quando ocorre falha, ok e falha", () => {
    const t1 = new Date("2026-11-20T14:00:00.000Z");
    const t2 = new Date("2026-11-20T14:05:00.000Z");
    const t3 = new Date("2026-11-20T14:10:00.000Z");

    const r1 = aplicar(estadoVazio(), CONFIG_TESTE, { "erp-api": FORA }, t1, SEM_MANUT);
    const r2 = aplicar(r1.estado, CONFIG_TESTE, { "erp-api": OK }, t2, SEM_MANUT);
    const r3 = aplicar(r2.estado, CONFIG_TESTE, { "erp-api": FORA }, t3, SEM_MANUT);

    expect(r1.eventos).toHaveLength(0);
    expect(r2.eventos).toHaveLength(0);
    expect(r3.eventos).toHaveLength(0);
    expect(r3.estado.incidentes).toHaveLength(0);
    expect(r3.estado.componentes["erp-api"]?.confirmado).toBe("ok");
    expect(r3.estado.componentes["erp-api"]?.contagem).toBe(1);
  });

  it("fecha incidente após 2 oks seguidos usando a hora do 1º ok como fim", () => {
    const t1 = new Date("2026-11-20T14:00:00.000Z");
    const t2 = new Date("2026-11-20T14:05:00.000Z");
    const t3 = new Date("2026-11-20T14:10:00.000Z");
    const t4 = new Date("2026-11-20T14:15:00.000Z");

    const r1 = aplicar(estadoVazio(), CONFIG_TESTE, { "erp-api": FORA }, t1, SEM_MANUT);
    const r2 = aplicar(r1.estado, CONFIG_TESTE, { "erp-api": FORA }, t2, SEM_MANUT);
    const r3 = aplicar(r2.estado, CONFIG_TESTE, { "erp-api": OK }, t3, SEM_MANUT);
    expect(r3.eventos).toHaveLength(0);
    expect(r3.estado.incidentes[0]?.fim).toBeUndefined();

    const r4 = aplicar(r3.estado, CONFIG_TESTE, { "erp-api": OK }, t4, SEM_MANUT);
    expect(r4.eventos).toHaveLength(1);
    expect(r4.eventos[0]?.tipo).toBe("resolvido");
    expect(r4.estado.componentes["erp-api"]?.confirmado).toBe("ok");
    expect(r4.estado.incidentes[0]?.fim).toBe(t3.toISOString());
  });

  it("atualiza gravidade quando incidente degradado piora para fora", () => {
    const t1 = new Date("2026-11-20T14:00:00.000Z");
    const t2 = new Date("2026-11-20T14:05:00.000Z");
    const t3 = new Date("2026-11-20T14:10:00.000Z");
    const t4 = new Date("2026-11-20T14:15:00.000Z");

    const r1 = aplicar(estadoVazio(), CONFIG_TESTE, { "erp-api": DEGRADADO }, t1, SEM_MANUT);
    const r2 = aplicar(r1.estado, CONFIG_TESTE, { "erp-api": DEGRADADO }, t2, SEM_MANUT);
    expect(r2.eventos[0]?.tipo).toBe("aberto");
    expect(r2.estado.incidentes[0]?.gravidade).toBe("degradado");

    const r3 = aplicar(r2.estado, CONFIG_TESTE, { "erp-api": FORA }, t3, SEM_MANUT);
    expect(r3.eventos).toHaveLength(0);

    const r4 = aplicar(r3.estado, CONFIG_TESTE, { "erp-api": FORA }, t4, SEM_MANUT);
    expect(r4.eventos).toHaveLength(1);
    expect(r4.eventos[0]).toMatchObject({ tipo: "atualizado", anterior: "degradado" });
    expect(r4.estado.incidentes[0]?.gravidade).toBe("fora");
  });

  it("suprime incidente em manutenção e volta para ok ao sair da janela", () => {
    const t1 = new Date("2026-11-20T14:00:00.000Z");
    const t2 = new Date("2026-11-20T14:05:00.000Z");
    const t3 = new Date("2026-11-20T14:10:00.000Z");
    const emManut = new Set(["erp-api"]);

    const r1 = aplicar(estadoVazio(), CONFIG_TESTE, { "erp-api": FORA }, t1, emManut);
    const r2 = aplicar(r1.estado, CONFIG_TESTE, { "erp-api": FORA }, t2, emManut);

    expect(r2.eventos).toHaveLength(0);
    expect(r2.estado.incidentes).toHaveLength(0);
    expect(r2.estado.componentes["erp-api"]?.confirmado).toBe("manutencao");

    const r3 = aplicar(r2.estado, CONFIG_TESTE, { "erp-api": OK }, t3, SEM_MANUT);
    expect(r3.eventos).toHaveLength(0);
    expect(r3.estado.componentes["erp-api"]?.confirmado).toBe("ok");
  });

  it("contabiliza diário por dia no fuso de Brasília perto da meia-noite", () => {
    // 2026-11-26T02:30Z = 2026-11-25 23:30 em Brasília (UTC-3)
    const antesMeiaNoiteBr = new Date("2026-11-26T02:30:00.000Z");
    // 2026-11-26T02:35Z = 2026-11-25 23:35 em Brasília (2ª falha confirma `fora`)
    const segundaAntes = new Date("2026-11-26T02:35:00.000Z");
    // 2026-11-26T03:05Z = 2026-11-26 00:05 em Brasília
    const depoisMeiaNoiteBr = new Date("2026-11-26T03:05:00.000Z");

    const r1 = aplicar(estadoVazio(), CONFIG_TESTE, { "erp-api": FORA }, antesMeiaNoiteBr, SEM_MANUT);
    const r2 = aplicar(r1.estado, CONFIG_TESTE, { "erp-api": FORA }, segundaAntes, SEM_MANUT);
    const r3 = aplicar(r2.estado, CONFIG_TESTE, { "erp-api": FORA }, depoisMeiaNoiteBr, SEM_MANUT);

    const diario = r3.estado.componentes["erp-api"]?.diario;
    expect(diario?.["2026-11-25"]).toEqual({ total: 2, degradado: 0, fora: 1, manutencao: 0 });
    expect(diario?.["2026-11-26"]).toEqual({ total: 1, degradado: 0, fora: 1, manutencao: 0 });
  });

  it("agrega corretamente os 5 estados possíveis", () => {
    expect(agregar([])).toBe("ok");
    expect(agregar(["ok", "ok"])).toBe("ok");
    expect(agregar(["ok", "degradado"])).toBe("degradado");
    expect(agregar(["ok", "fora"])).toBe("falha_parcial");
    expect(agregar(["degradado", "fora"])).toBe("falha_parcial");
    expect(agregar(["fora", "fora"])).toBe("fora");
    expect(agregar(["manutencao", "manutencao"])).toBe("manutencao");
    expect(agregar(["ok", "manutencao"])).toBe("manutencao");
  });

  it("mantém no máximo 300 checagens recentes por componente", () => {
    let estado = estadoVazio();
    const base = Date.parse("2026-11-20T00:00:00.000Z");
    for (let i = 0; i < RECENTES_MAX + 15; i++) {
      const agora = new Date(base + i * 60_000);
      estado = aplicar(estado, CONFIG_TESTE, { "erp-api": OK }, agora, SEM_MANUT).estado;
    }

    const recentes = estado.componentes["erp-api"]?.recentes ?? [];
    expect(recentes).toHaveLength(RECENTES_MAX);
    expect(recentes[0]?.em).toBe(new Date(base + 15 * 60_000).toISOString());
  });
});
