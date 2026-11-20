import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  carregarIncidentesManuais,
  carregarManutencoes,
  componentesComImpactoManual,
  componentesEmManutencao,
  expandirComponentes,
} from "../scripts/lib/conteudo";
import type { Config } from "../scripts/lib/types";

const CONFIG: Config = {
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
        { id: "erp-app", nome: "Aplicação", url: "https://exemplo/1" },
        { id: "erp-api", nome: "API", url: "https://exemplo/2" },
      ],
    },
    {
      id: "pdv",
      nome: "Vital PDV",
      componentes: [{ id: "pdv-api", nome: "API", url: "https://exemplo/3" }],
    },
  ],
};

const tempDirs: string[] = [];

function criarTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vitalstatus-conteudo-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("conteudo", () => {
  it("devolve lista vazia quando o diretório não existe", () => {
    expect(carregarManutencoes(path.join(os.tmpdir(), "nao-existe-vitalstatus-123"), CONFIG)).toEqual([]);
  });

  it("carrega manutenção convertendo horário de Brasília para UTC e expandindo grupo", () => {
    const dir = criarTempDir();
    fs.writeFileSync(
      path.join(dir, "_modelo.md.exemplo"),
      "---\ntitulo: Ignorado\ncomponentes: [erp]\ninicio: 2026-11-25 22:00\nfim: 2026-11-25 23:00\n---\n",
    );
    fs.writeFileSync(
      path.join(dir, "2026-11-25-migracao.md"),
      [
        "---",
        'titulo: "Atualização do ERP"',
        "componentes: [erp]",
        "inicio: 2026-11-25 22:00",
        "fim: 2026-11-25 23:30",
        "---",
        "Texto explicativo.",
      ].join("\n"),
    );

    const lista = carregarManutencoes(dir, CONFIG);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toEqual({
      slug: "2026-11-25-migracao",
      titulo: "Atualização do ERP",
      componentes: ["erp-app", "erp-api"],
      inicio: "2026-11-26T01:00:00.000Z",
      fim: "2026-11-26T02:30:00.000Z",
      corpo: "Texto explicativo.",
    });
  });

  it("respeita as bordas [inicio, fim) em componentesEmManutencao", () => {
    const manutencoes = [
      {
        slug: "janela",
        titulo: "Janela",
        componentes: ["pdv-api"],
        inicio: "2026-11-26T01:00:00.000Z",
        fim: "2026-11-26T02:00:00.000Z",
        corpo: "",
      },
    ];

    expect(componentesEmManutencao(manutencoes, new Date("2026-11-26T00:59:59.000Z")).has("pdv-api")).toBe(false);
    expect(componentesEmManutencao(manutencoes, new Date("2026-11-26T01:00:00.000Z")).has("pdv-api")).toBe(true);
    expect(componentesEmManutencao(manutencoes, new Date("2026-11-26T02:00:00.000Z")).has("pdv-api")).toBe(false);
  });

  it("lança erro com nome do arquivo para componente inexistente, data impossível ou fim < inicio", () => {
    expect(() => expandirComponentes(CONFIG, ["inexistente"])).toThrow(
      "componente 'inexistente' não existe em status.config.json",
    );

    const dir1 = criarTempDir();
    fs.writeFileSync(
      path.join(dir1, "ruim-comp.md"),
      "---\ntitulo: Erro\ncomponentes:\n  - nao-existe\ninicio: 2026-11-25 22:00\nfim: 2026-11-25 23:00\n---\n",
    );
    expect(() => carregarManutencoes(dir1, CONFIG)).toThrow(/ruim-comp\.md/);

    const dir2 = criarTempDir();
    fs.writeFileSync(
      path.join(dir2, "fim-antes.md"),
      "---\ntitulo: Erro\ncomponentes: [pdv-api]\ninicio: 2026-11-25 23:00\nfim: 2026-11-25 22:00\n---\n",
    );
    expect(() => carregarManutencoes(dir2, CONFIG)).toThrow(/fim-antes\.md/);

    const dir3 = criarTempDir();
    fs.writeFileSync(
      path.join(dir3, "data-impossivel.md"),
      "---\ntitulo: Erro\ncomponentes: [pdv-api]\ninicio: 2026-02-30 10:00\nfim: 2026-03-01 10:00\n---\n",
    );
    expect(() => carregarManutencoes(dir3, CONFIG)).toThrow(/data-impossivel\.md/);
  });

  it("carrega incidentes manuais e calcula componentesComImpactoManual", () => {
    const dir = criarTempDir();
    fs.writeFileSync(
      path.join(dir, "01-aberto.md"),
      [
        "---",
        "titulo: Lentidão no caixa",
        "componentes:",
        "  - pdv-api",
        "impacto: degradado",
        "estado: investigando",
        "inicio: 2026-11-25T15:00:00-03:00",
        "---",
        "Investigando.",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(dir, "02-informativo.md"),
      [
        "---",
        "titulo: Comunicado",
        "componentes: [erp-app]",
        "impacto: nenhum",
        "estado: monitorando",
        "inicio: 2026-11-25 14:00",
        "---",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(dir, "03-resolvido.md"),
      [
        "---",
        "titulo: Resolvido",
        "componentes: [erp-api]",
        "impacto: fora",
        "estado: resolvido",
        "inicio: 2026-11-25 12:00",
        "fim: 2026-11-25 13:00",
        "---",
      ].join("\n"),
    );

    const incs = carregarIncidentesManuais(dir, CONFIG);
    expect(incs).toHaveLength(3);

    const impacto = componentesComImpactoManual(incs, new Date("2026-11-25T19:00:00.000Z"));
    expect(impacto.get("pdv-api")).toBe("degradado");
    expect(impacto.has("erp-app")).toBe(false);
    expect(impacto.has("erp-api")).toBe(false);
  });
});
