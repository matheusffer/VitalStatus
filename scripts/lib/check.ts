import { listaComponentes } from "./engine";
import type { Config, ConfigComponente, Resultado } from "./types";

export type Corpo = { http: number; texto: string; ms: number };

/** Navega `a.b.c` em objetos desconhecidos; devolve `undefined` se o caminho quebrar. */
export function lerCaminho(obj: unknown, caminho: string): unknown {
  if (!caminho) return undefined;
  let atual: unknown = obj;
  for (const parte of caminho.split(".")) {
    if (atual === null || typeof atual !== "object") return undefined;
    if (!Object.hasOwn(atual, parte)) return undefined;
    atual = (atual as Record<string, unknown>)[parte];
  }
  return atual;
}

function formatarValor(valor: unknown): string {
  if (typeof valor === "object" && valor !== null) return JSON.stringify(valor);
  return String(valor);
}

/** Avalia a resposta HTTP (ou erro) de um componente contra as regras de `status.config.json`. */
export function avaliar(
  comp: ConfigComponente,
  resp: Corpo | Error,
  latenciaPadraoMs: number,
): Resultado {
  if (resp instanceof Error) {
    return { classe: "fora", ms: 0, erro: resp.message };
  }

  if (comp.esperado !== undefined) {
    if (resp.http !== comp.esperado) {
      return {
        classe: "fora",
        ms: resp.ms,
        http: resp.http,
        erro: `HTTP ${resp.http} (esperado ${comp.esperado})`,
      };
    }
  } else if (!comp.json && (resp.http < 200 || resp.http >= 300)) {
    // Quando há `json` sem `esperado`, o corpo decide (ex.: ?deep=1 pode devolver 503 com JSON válido).
    return {
      classe: "fora",
      ms: resp.ms,
      http: resp.http,
      erro: `HTTP ${resp.http}`,
    };
  }

  if (comp.contem !== undefined && !resp.texto.includes(comp.contem)) {
    return {
      classe: "fora",
      ms: resp.ms,
      http: resp.http,
      erro: "resposta sem o conteúdo esperado",
    };
  }

  if (comp.json) {
    let dados: unknown;
    try {
      dados = JSON.parse(resp.texto);
    } catch {
      return {
        classe: "fora",
        ms: resp.ms,
        http: resp.http,
        erro: "resposta não é JSON válido",
      };
    }
    const valor = lerCaminho(dados, comp.json.caminho);
    if (typeof valor !== "string" || !comp.json.em.includes(valor)) {
      return {
        classe: "fora",
        ms: resp.ms,
        http: resp.http,
        erro: `${comp.json.caminho} = ${formatarValor(valor)}`,
      };
    }
  }

  const limiteMs = comp.latenciaMaxMs ?? latenciaPadraoMs;
  if (resp.ms > limiteMs) {
    return {
      classe: "degradado",
      ms: resp.ms,
      http: resp.http,
      erro: `resposta lenta (${Math.round(resp.ms)} ms)`,
    };
  }

  return { classe: "ok", ms: resp.ms, http: resp.http };
}

function erroDeRede(err: unknown, timeoutMs: number): Error {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
    const segs = Math.max(1, Math.round(timeoutMs / 1000));
    return new Error(`sem resposta em ${segs} s`);
  }
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause;
  const code = typeof cause?.code === "string" ? cause.code : undefined;
  return new Error(code ? `falha de conexão (${code})` : "falha de conexão");
}

async function buscarUmaVez(url: string, timeoutMs: number): Promise<Corpo | Error> {
  const inicio = performance.now();
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { "user-agent": "VitalStatus/1.0 (+https://status.vitalerp.tech)" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const texto = await resp.text();
    const ms = Math.round(performance.now() - inicio);
    return { http: resp.status, texto, ms };
  } catch (err) {
    return erroDeRede(err, timeoutMs);
  }
}

async function buscarComRetentativa(
  url: string,
  timeoutMs: number,
  retentativaMs: number,
): Promise<Corpo | Error> {
  const primeira = await buscarUmaVez(url, timeoutMs);
  const falhou = primeira instanceof Error || primeira.http >= 500;
  if (!falhou) return primeira;
  await new Promise((resolve) => setTimeout(resolve, retentativaMs));
  return buscarUmaVez(url, timeoutMs);
}

/**
 * Executa as checagens de todos os componentes em paralelo.
 * URLs repetidas (ex.: `/api/health?deep=1`) são buscadas uma única vez por rodada.
 */
export async function checarTudo(
  config: Config,
  opts?: { retentativaMs?: number },
): Promise<Record<string, Resultado>> {
  const retentativaMs = opts?.retentativaMs ?? 2000;
  const porUrl = new Map<string, Promise<Corpo | Error>>();
  const itens = listaComponentes(config);

  const entradas = await Promise.all(
    itens.map(async ({ comp }) => {
      let promessa = porUrl.get(comp.url);
      if (!promessa) {
        promessa = buscarComRetentativa(comp.url, config.padroes.timeoutMs, retentativaMs);
        porUrl.set(comp.url, promessa);
      }
      const resp = await promessa;
      return [comp.id, avaliar(comp, resp, config.padroes.latenciaMaxMs)] as const;
    }),
  );

  return Object.fromEntries(entradas);
}
