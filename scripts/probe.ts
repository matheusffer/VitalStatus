import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checarTudo } from "./lib/check";
import { carregarManutencoes, componentesEmManutencao } from "./lib/conteudo";
import { aplicar, estadoVazio, listaComponentes } from "./lib/engine";
import { enviar, montarMensagem } from "./lib/telegram";
import type { Config, Estado, Evento, Incidente, Resultado } from "./lib/types";

export interface OpcoesProbe {
  configPath?: string;
  statePath?: string;
  manutencoesDir?: string;
  dry?: boolean;
  semTelegram?: boolean;
  agora?: Date;
  checar?: (config: Config) => Promise<Record<string, Resultado>>;
  controle?: (url: string) => Promise<boolean>;
  enviarMsg?: typeof enviar;
  log?: (linha: string) => void;
}

async function tentarControle(url: string, f: typeof fetch): Promise<boolean> {
  try {
    const resp = await f(url, {
      method: "GET",
      headers: { "user-agent": "VitalStatus/1.0 (+https://status.vitalerp.tech)" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    await resp.body?.cancel?.().catch(() => {});
    return resp.status >= 200 && resp.status < 300;
  } catch {
    return false;
  }
}

/** Verifica acesso à internet em URL neutra antes de responsabilizar os serviços. */
export async function verificarControle(
  url: string,
  f: typeof fetch = fetch,
  retentativaMs = 2000,
): Promise<boolean> {
  if (await tentarControle(url, f)) return true;
  await new Promise((resolve) => setTimeout(resolve, retentativaMs));
  return tentarControle(url, f);
}

function lerConfig(caminho: string): Config {
  let bruto: string;
  try {
    bruto = fs.readFileSync(caminho, "utf8");
  } catch (err) {
    throw new Error(
      `não foi possível ler a configuração '${caminho}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bruto);
  } catch {
    throw new Error(`configuração inválida em '${caminho}': JSON malformado`);
  }
  const cfg = parsed as Partial<Config> | null;
  if (
    !cfg ||
    typeof cfg !== "object" ||
    !cfg.site ||
    !cfg.padroes ||
    !Array.isArray(cfg.grupos)
  ) {
    throw new Error(`configuração inválida em '${caminho}': estrutura esperada ausente`);
  }
  return cfg as Config;
}

function lerEstado(caminho: string): Estado {
  if (!fs.existsSync(caminho)) return estadoVazio();
  let bruto: string;
  try {
    bruto = fs.readFileSync(caminho, "utf8");
  } catch (err) {
    throw new Error(
      `não foi possível ler o estado '${caminho}': ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bruto);
  } catch {
    throw new Error(`estado corrompido em '${caminho}': JSON malformado`);
  }
  const st = parsed as Partial<Estado> | null;
  if (
    !st ||
    typeof st !== "object" ||
    st.versao !== 1 ||
    !st.componentes ||
    typeof st.componentes !== "object" ||
    !Array.isArray(st.incidentes)
  ) {
    throw new Error(`estado corrompido em '${caminho}': formato incompatível`);
  }
  return st as Estado;
}

function gravarEstadoAtomico(caminho: string, estado: Estado): void {
  const dir = path.dirname(caminho);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(caminho)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(estado, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, caminho);
}

function mapaDeNomes(config: Config): Map<string, { grupo: string; componente: string }> {
  const mapa = new Map<string, { grupo: string; componente: string }>();
  for (const g of config.grupos) {
    for (const c of g.componentes) {
      mapa.set(c.id, { grupo: g.nome, componente: c.nome });
    }
  }
  return mapa;
}

async function notificar(
  ev: Evento,
  config: Config,
  nomes: { grupo: string; componente: string },
  detalhe: string | undefined,
  semTelegram: boolean,
  enviarMsg: typeof enviar,
  log: (linha: string) => void,
): Promise<boolean> {
  const msg = montarMensagem(ev, config, nomes, ev.tipo === "resolvido" ? undefined : detalhe);
  if (semTelegram) {
    log(msg);
    return false;
  }
  const res = await enviarMsg(msg);
  if (!res.ok) {
    log(`[telegram] falha ao enviar '${ev.tipo}' (${ev.incidente.id}): ${res.erro ?? "erro"}`);
    return false;
  }
  return true;
}

function nomesDoIncidente(
  inc: Incidente,
  mapaNomes: Map<string, { grupo: string; componente: string }>,
): { grupo: string; componente: string } {
  return mapaNomes.get(inc.componente) ?? { grupo: inc.grupo, componente: inc.componente };
}

/** Executa uma rodada completa da sonda (checagem, máquina de estados, avisos e gravação). */
export async function rodar(opts: OpcoesProbe = {}): Promise<{
  estado: Estado;
  eventos: Evento[];
  resultados: Record<string, Resultado>;
}> {
  const configPath = opts.configPath ?? "status.config.json";
  const statePath = opts.statePath ?? path.join("data", "state.json");
  const manutencoesDir = opts.manutencoesDir ?? path.join("content", "manutencoes");
  const dry = opts.dry ?? false;
  const semTelegram = opts.semTelegram ?? (dry || process.env.SEM_TELEGRAM === "1");
  const agora = opts.agora ?? new Date();
  const checar = opts.checar ?? checarTudo;
  const enviarMsg = opts.enviarMsg ?? enviar;
  const log = opts.log ?? console.log;

  const config = lerConfig(configPath);
  const anterior = lerEstado(statePath);
  const manutencoes = carregarManutencoes(manutencoesDir, config);
  const emManutencao = componentesEmManutencao(manutencoes, agora);

  // Só consulta a rede de controle quando `opts.checar` não foi sobrescrito (ou quando `opts.controle` foi injetado).
  const urlControle = config.padroes.urlControle;
  const deveChecarControle =
    Boolean(urlControle) && (opts.controle !== undefined || opts.checar === undefined);
  if (deveChecarControle && urlControle) {
    const fnControle = opts.controle ?? verificarControle;
    const temRede = await fnControle(urlControle);
    if (!temRede) {
      log("[SONDA] sem acesso à internet de controle; rodada ignorada e estado preservado");
      return { estado: anterior, eventos: [], resultados: {} };
    }
  }

  const resultados = await checar(config);
  const { estado, eventos } = aplicar(anterior, config, resultados, agora, emManutencao);

  for (const { comp } of listaComponentes(config)) {
    const r = resultados[comp.id];
    if (!r) continue;
    const tag = emManutencao.has(comp.id) ? "MANUTENCAO" : r.classe.toUpperCase();
    const httpStr = r.http !== undefined ? ` HTTP ${r.http}` : "";
    const erroStr = r.erro ? ` — ${r.erro}` : "";
    log(`[${tag}] ${comp.id} (${r.ms} ms)${httpStr}${erroStr}`);
  }

  const mapaNomes = mapaDeNomes(config);
  const tentadosAberto = new Set<string>();
  const tentadosResolvido = new Set<string>();

  for (const ev of eventos) {
    const inc = ev.incidente;
    if (ev.tipo === "resolvido" && !inc.avisos.aberto) {
      // Nunca avisa normalização se a abertura nunca chegou a ser avisada.
      inc.avisos.aberto = true;
      inc.avisos.resolvido = true;
      continue;
    }

    const nomes = nomesDoIncidente(inc, mapaNomes);
    const detalhe = estado.componentes[inc.componente]?.ultima?.erro;
    const ok = await notificar(ev, config, nomes, detalhe, semTelegram, enviarMsg, log);

    if (ev.tipo === "aberto") {
      tentadosAberto.add(inc.id);
      if (ok) inc.avisos.aberto = true;
    } else if (ev.tipo === "resolvido") {
      tentadosResolvido.add(inc.id);
      if (ok) inc.avisos.resolvido = true;
    }
  }

  // Reenvio de avisos pendentes (máximo uma tentativa por rodada por incidente).
  for (const inc of estado.incidentes) {
    if (!inc.fim && !inc.avisos.aberto && !tentadosAberto.has(inc.id)) {
      const nomes = nomesDoIncidente(inc, mapaNomes);
      const detalhe = estado.componentes[inc.componente]?.ultima?.erro;
      const ok = await notificar(
        { tipo: "aberto", incidente: inc },
        config,
        nomes,
        detalhe,
        semTelegram,
        enviarMsg,
        log,
      );
      if (ok) inc.avisos.aberto = true;
    } else if (inc.fim && !inc.avisos.resolvido) {
      if (!inc.avisos.aberto) {
        inc.avisos.aberto = true;
        inc.avisos.resolvido = true;
      } else if (!tentadosResolvido.has(inc.id)) {
        const nomes = nomesDoIncidente(inc, mapaNomes);
        const ok = await notificar(
          { tipo: "resolvido", incidente: inc },
          config,
          nomes,
          undefined,
          semTelegram,
          enviarMsg,
          log,
        );
        if (ok) inc.avisos.resolvido = true;
      }
    }
  }

  if (!dry) {
    gravarEstadoAtomico(statePath, estado);
  }

  return { estado, eventos, resultados };
}

export function parseArgs(argv: string[]): { dry: boolean; configPath?: string } {
  let dry = false;
  let configPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry") {
      dry = true;
    } else if (arg === "--config") {
      const valor = argv[i + 1];
      if (!valor || valor.startsWith("--")) {
        throw new Error("--config exige um caminho de arquivo");
      }
      configPath = valor;
      i += 1;
    }
  }
  return { dry, configPath };
}

async function main(): Promise<void> {
  const { dry, configPath } = parseArgs(process.argv.slice(2));
  await rodar({ dry, configPath });
}

const ehEntrypoint =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (ehEntrypoint) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
