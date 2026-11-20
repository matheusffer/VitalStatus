import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  carregarIncidentesManuais,
  carregarManutencoes,
  componentesComImpactoManual,
  componentesEmManutencao,
} from "./lib/conteudo";
import { derivarEstadoExibicao } from "./lib/estado-exibicao";
import {
  renderAtom,
  renderPaginaHistorico,
  renderPaginaPrincipal,
  renderStatusJson,
} from "./lib/render";
import type { Config, Estado } from "./lib/types";

export function construirSite(raiz = process.cwd(), agora = new Date()): void {
  const configPath = join(raiz, "status.config.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as Config;

  const statePath = join(raiz, "data", "state.json");
  const estado = existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, "utf8")) as Estado)
    : null;

  const manutencoes = carregarManutencoes(join(raiz, "content", "manutencoes"), config);
  const incidentesManuais = carregarIncidentesManuais(join(raiz, "content", "incidentes"), config);
  const emManutencao = componentesEmManutencao(manutencoes, agora);
  const impactoManual = componentesComImpactoManual(incidentesManuais, agora);

  const exibicao = derivarEstadoExibicao({
    estado,
    config,
    manutencoes,
    incidentesManuais,
    emManutencao,
    impactoManual,
    agora,
  });

  const distDir = join(raiz, "dist");
  const siteDir = join(raiz, "site");
  const historicoDir = join(distDir, "historico");

  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  cpSync(siteDir, distDir, { recursive: true });
  mkdirSync(historicoDir, { recursive: true });

  writeFileSync(join(distDir, "index.html"), renderPaginaPrincipal(exibicao, config), "utf8");
  writeFileSync(
    join(historicoDir, "index.html"),
    renderPaginaHistorico(exibicao, config),
    "utf8",
  );
  writeFileSync(join(distDir, "status.json"), renderStatusJson(exibicao), "utf8");
  writeFileSync(join(distDir, "incidentes.atom"), renderAtom(exibicao, config), "utf8");
}

const ehPrincipal =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (ehPrincipal) {
  construirSite();
}
