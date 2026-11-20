import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { estadoVazio, listaComponentes } from "../scripts/lib/engine";
import {
  calcularUptime90d,
  construirBarra90d,
  derivarEstadoExibicao,
} from "../scripts/lib/estado-exibicao";
import { diaBrasilia, ultimosDias } from "../scripts/lib/tempo";
import type { Config, Estado, IncidenteManual, Manutencao } from "../scripts/lib/types";

const configPath = fileURLToPath(new URL("../status.config.json", import.meta.url));
const config = JSON.parse(readFileSync(configPath, "utf8")) as Config;

describe("calcularUptime90d", () => {
  const dias = ultimosDias("2026-11-19", 90);

  it("retorna null quando não há dados", () => {
    expect(calcularUptime90d(undefined, dias)).toBeNull();
    expect(calcularUptime90d({}, dias)).toBeNull();
    expect(
      calcularUptime90d({ "2026-11-19": { total: 0, degradado: 0, fora: 0, manutencao: 0 } }, dias),
    ).toBeNull();
  });

  it("retorna 100 quando todas as checagens são ok", () => {
    const diario = {
      "2026-11-18": { total: 288, degradado: 0, fora: 0, manutencao: 0 },
      "2026-11-19": { total: 100, degradado: 0, fora: 0, manutencao: 0 },
    };
    expect(calcularUptime90d(diario, dias)).toBe(100);
  });

  it("pondera fora com peso 1 e degradado com peso 0,5", () => {
    const dFora = { "2026-11-19": { total: 100, degradado: 0, fora: 10, manutencao: 0 } };
    expect(calcularUptime90d(dFora, dias)).toBe(90);

    const dDeg = { "2026-11-19": { total: 100, degradado: 20, fora: 0, manutencao: 0 } };
    expect(calcularUptime90d(dDeg, dias)).toBe(90);

    const dMisto = { "2026-11-19": { total: 200, degradado: 20, fora: 10, manutencao: 0 } };
    expect(calcularUptime90d(dMisto, dias)).toBe(90);
  });

  it("ignora checagens de manutenção no cálculo e retorna null se só houver manutenção", () => {
    const diario = {
      "2026-11-18": { total: 100, degradado: 0, fora: 10, manutencao: 0 },
      "2026-11-19": { total: 100, degradado: 0, fora: 0, manutencao: 100 },
    };
    expect(calcularUptime90d(diario, dias)).toBe(90);

    const soManutencao = {
      "2026-11-19": { total: 50, degradado: 0, fora: 0, manutencao: 50 },
    };
    expect(calcularUptime90d(soManutencao, dias)).toBeNull();
  });
});

describe("construirBarra90d", () => {
  const dias = ultimosDias("2026-11-19", 90);

  it("produz 90 dias ordenados do mais antigo para hoje, preenchendo dias faltantes como sem_dados", () => {
    const { barra, diasComProblemas } = construirBarra90d(
      { "2026-11-19": { total: 288, degradado: 0, fora: 0, manutencao: 0 } },
      dias,
    );
    expect(barra).toHaveLength(90);
    expect(barra[0]?.dia).toBe(dias[0]);
    expect(barra[0]?.estado).toBe("sem_dados");
    expect(barra[89]?.dia).toBe("2026-11-19");
    expect(barra[89]?.estado).toBe("ok");
    expect(diasComProblemas).toBe(0);
  });

  it("classifica pelo pior estado do dia (fora > degradado > manutencao > ok) e calcula minutos aproximados", () => {
    const { barra, diasComProblemas } = construirBarra90d(
      {
        "2026-11-16": { total: 100, degradado: 5, fora: 2, manutencao: 10 },
        "2026-11-17": { total: 100, degradado: 5, fora: 0, manutencao: 10 },
        "2026-11-18": { total: 100, degradado: 0, fora: 0, manutencao: 10 },
        "2026-11-19": { total: 100, degradado: 0, fora: 0, manutencao: 0 },
      },
      dias,
    );
    const porDia = new Map(barra.map((b) => [b.dia, b]));
    expect(porDia.get("2026-11-16")?.estado).toBe("fora");
    expect(porDia.get("2026-11-16")?.minFora).toBe(29);
    expect(porDia.get("2026-11-16")?.label).toContain("16/11/2026: 29 min fora do ar");

    expect(porDia.get("2026-11-17")?.estado).toBe("degradado");
    expect(porDia.get("2026-11-17")?.minDegradado).toBe(72);

    expect(porDia.get("2026-11-18")?.estado).toBe("manutencao");
    expect(porDia.get("2026-11-19")?.estado).toBe("ok");
    expect(diasComProblemas).toBe(2);
  });
});

describe("derivarEstadoExibicao", () => {
  const agora = new Date("2026-11-19T18:00:00Z");
  const hoje = diaBrasilia(agora);

  function estadoComTodosOk(): Estado {
    const e = estadoVazio();
    e.atualizadoEm = new Date(agora.getTime() - 2 * 60000).toISOString();
    for (const { comp } of listaComponentes(config)) {
      e.componentes[comp.id] = {
        confirmado: "ok",
        contagem: 0,
        desde: e.atualizadoEm,
        ultima: { em: e.atualizadoEm, classe: "ok", ms: 120, http: 200 },
        recentes: [{ em: e.atualizadoEm, classe: "ok", ms: 120, http: 200 }],
        diario: { [hoje]: { total: 20, degradado: 0, fora: 0, manutencao: 0 } },
      };
    }
    return e;
  }

  it("lida com state.json ausente sem quebrar", () => {
    const ex = derivarEstadoExibicao({
      estado: null,
      config,
      manutencoes: [],
      incidentesManuais: [],
      emManutencao: new Set(),
      impactoManual: new Map(),
      agora,
    });
    expect(ex.semDados).toBe(true);
    expect(ex.fraseGeral).toBe("Ainda sem dados: a primeira verificação acontece em até 5 minutos");
    expect(ex.produtos.every((p) => p.emBreve && p.rotuloEstado === "Em breve")).toBe(true);
  });

  it("agrega estado geral ok, instabilidade em 1 produto, 2 produtos e manutenção", () => {
    const okState = estadoComTodosOk();
    const exOk = derivarEstadoExibicao({
      estado: okState,
      config,
      manutencoes: [],
      incidentesManuais: [],
      emManutencao: new Set(),
      impactoManual: new Map(),
      agora,
    });
    expect(exOk.estadoGeral).toBe("ok");
    expect(exOk.fraseGeral).toBe("Todos os sistemas operacionais");
    expect(exOk.atrasado).toBe(false);

    // 1 produto afetado
    const umAfetado = estadoComTodosOk();
    if (umAfetado.componentes["erp-api"]) {
      umAfetado.componentes["erp-api"].confirmado = "fora";
    }
    const exUm = derivarEstadoExibicao({
      estado: umAfetado,
      config,
      manutencoes: [],
      incidentesManuais: [],
      emManutencao: new Set(),
      impactoManual: new Map(),
      agora,
    });
    expect(exUm.estadoGeral).toBe("falha_parcial");
    expect(exUm.fraseGeral).toBe("Instabilidade em Vital ERP");

    // 2 produtos afetados
    const doisAfetados = estadoComTodosOk();
    if (doisAfetados.componentes["erp-api"]) doisAfetados.componentes["erp-api"].confirmado = "fora";
    if (doisAfetados.componentes["pdv-api"]) doisAfetados.componentes["pdv-api"].confirmado = "degradado";
    const exDois = derivarEstadoExibicao({
      estado: doisAfetados,
      config,
      manutencoes: [],
      incidentesManuais: [],
      emManutencao: new Set(),
      impactoManual: new Map(),
      agora,
    });
    expect(exDois.fraseGeral).toBe("Instabilidade em 2 produtos");

    // Manutenção
    const exManut = derivarEstadoExibicao({
      estado: okState,
      config,
      manutencoes: [],
      incidentesManuais: [],
      emManutencao: new Set(["pdv-api"]),
      impactoManual: new Map(),
      agora,
    });
    expect(exManut.estadoGeral).toBe("manutencao");
    expect(exManut.fraseGeral).toBe("Manutenção programada em andamento");
  });

  it("incidente manual com impacto sobrepõe o estado exibido", () => {
    const estado = estadoComTodosOk();
    const manual: IncidenteManual = {
      slug: "2026-11-19-pdv-fora",
      titulo: "Instabilidade no caixa web",
      componentes: ["pdv-caixa"],
      impacto: "fora",
      estado: "investigando",
      inicio: "2026-11-19T17:40:00Z",
      corpo: "Estamos **investigando**.",
    };
    const ex = derivarEstadoExibicao({
      estado,
      config,
      manutencoes: [],
      incidentesManuais: [manual],
      emManutencao: new Set(),
      impactoManual: new Map([["pdv-caixa", "fora"]]),
      agora,
    });

    const pdv = ex.produtos.find((p) => p.id === "pdv");
    const caixa = pdv?.componentes.find((c) => c.id === "pdv-caixa");
    expect(caixa?.estado).toBe("fora");
    expect(caixa?.rotuloEstado).toBe("Fora do ar");
    expect(ex.fraseGeral).toBe("Instabilidade em Vital PDV");
    expect(ex.incidentesAtivos).toHaveLength(1);
  });

  it("marca grupo sem nenhum dado como Em breve e não o inclui no estado geral", () => {
    const estado = estadoComTodosOk();
    // Remove dados de todos os componentes do produto Vendas Ativa
    delete estado.componentes["vendasativa-app"];
    delete estado.componentes["vendasativa-site"];

    const ex = derivarEstadoExibicao({
      estado,
      config,
      manutencoes: [],
      incidentesManuais: [],
      emManutencao: new Set(),
      impactoManual: new Map(),
      agora,
    });

    const vendas = ex.produtos.find((p) => p.id === "vendasativa");
    expect(vendas?.emBreve).toBe(true);
    expect(vendas?.rotuloEstado).toBe("Em breve");
    expect(ex.estadoGeral).toBe("ok");
  });

  it("sinaliza verificações atrasadas após 20 minutos e filtra manutenções futuras até 14 dias", () => {
    const estado = estadoComTodosOk();
    estado.atualizadoEm = new Date(agora.getTime() - 25 * 60000).toISOString();

    const dentro14d: Manutencao = {
      slug: "m1",
      titulo: "Troca de certificado",
      componentes: ["erp-api"],
      inicio: new Date(agora.getTime() + 3 * 86400000).toISOString(),
      fim: new Date(agora.getTime() + 3 * 86400000 + 3600000).toISOString(),
      corpo: "Janela breve.",
    };
    const alem14d: Manutencao = {
      slug: "m2",
      titulo: "Migração distante",
      componentes: ["erp-banco"],
      inicio: new Date(agora.getTime() + 20 * 86400000).toISOString(),
      fim: new Date(agora.getTime() + 20 * 86400000 + 3600000).toISOString(),
      corpo: "Depois.",
    };

    const ex = derivarEstadoExibicao({
      estado,
      config,
      manutencoes: [dentro14d, alem14d],
      incidentesManuais: [],
      emManutencao: new Set(),
      impactoManual: new Map(),
      agora,
    });

    expect(ex.atrasado).toBe(true);
    expect(ex.manutencoesProgramadas).toHaveLength(1);
    expect(ex.manutencoesProgramadas[0]?.slug).toBe("m1");
  });
});
