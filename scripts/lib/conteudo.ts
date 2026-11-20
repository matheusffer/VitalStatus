import fs from "node:fs";
import path from "node:path";
import type { Config, IncidenteManual, Manutencao } from "./types";

type ValorFm = string | string[];

const IMPACTOS_VALIDOS = new Set<IncidenteManual["impacto"]>(["nenhum", "degradado", "fora"]);
const ESTADOS_VALIDOS = new Set<IncidenteManual["estado"]>([
  "investigando",
  "identificado",
  "monitorando",
  "resolvido",
]);

function tirarAspas(s: string): string {
  if (s.length >= 2) {
    const inicio = s[0];
    const fim = s[s.length - 1];
    if ((inicio === '"' && fim === '"') || (inicio === "'" && fim === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function parseFrontmatter(conteudo: string, arquivo: string): { dados: Record<string, ValorFm>; corpo: string } {
  const normalizado = conteudo.replace(/\r\n/g, "\n");
  const linhas = normalizado.split("\n");
  if (linhas[0]?.trim() !== "---") {
    throw new Error(`${arquivo}: frontmatter ausente (esperado '---' na primeira linha)`);
  }

  let fimIdx = -1;
  for (let i = 1; i < linhas.length; i++) {
    if (linhas[i]?.trim() === "---") {
      fimIdx = i;
      break;
    }
  }
  if (fimIdx === -1) {
    throw new Error(`${arquivo}: frontmatter não fechado com '---'`);
  }

  const dados: Record<string, ValorFm> = {};
  let chaveLista: string | null = null;

  for (let i = 1; i < fimIdx; i++) {
    const bruta = linhas[i] ?? "";
    const aparada = bruta.trim();
    if (!aparada || aparada.startsWith("#")) continue;

    if (/^\s*-\s+/.test(bruta)) {
      if (!chaveLista) {
        throw new Error(`${arquivo}: item de lista sem chave na linha ${i + 1}`);
      }
      const item = tirarAspas(aparada.slice(1).trim());
      const atual = dados[chaveLista];
      if (!Array.isArray(atual)) {
        throw new Error(`${arquivo}: '${chaveLista}' não é uma lista`);
      }
      atual.push(item);
      continue;
    }

    const match = /^([a-zA-Z0-9_]+)\s*:\s*(.*)$/.exec(aparada);
    if (!match) {
      throw new Error(`${arquivo}: linha inválida no frontmatter (${i + 1}): ${aparada}`);
    }
    const chave = match[1]!;
    const valorBruto = (match[2] ?? "").trim();

    if (valorBruto === "") {
      dados[chave] = [];
      chaveLista = chave;
    } else if (valorBruto.startsWith("[") && valorBruto.endsWith("]")) {
      const miolo = valorBruto.slice(1, -1).trim();
      dados[chave] = miolo
        ? miolo
            .split(",")
            .map((p) => tirarAspas(p.trim()))
            .filter((p) => p.length > 0)
        : [];
      chaveLista = null;
    } else {
      dados[chave] = tirarAspas(valorBruto);
      chaveLista = null;
    }
  }

  const corpo = linhas
    .slice(fimIdx + 1)
    .join("\n")
    .trim();

  return { dados, corpo };
}

function dataCalendarioValida(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  min: number,
  seg: number,
): boolean {
  const dt = new Date(Date.UTC(ano, mes - 1, dia, hora, min, seg));
  return (
    dt.getUTCFullYear() === ano &&
    dt.getUTCMonth() === mes - 1 &&
    dt.getUTCDate() === dia &&
    dt.getUTCHours() === hora &&
    dt.getUTCMinutes() === min &&
    dt.getUTCSeconds() === seg
  );
}

/**
 * Converte data ISO com fuso ou `AAAA-MM-DD HH:mm` (Brasília UTC-03:00) para ISO UTC.
 * Rejeita datas impossíveis (ex.: 30 de fevereiro) em vez de rolar para o mês seguinte.
 */
function parseDataIsoUtc(valor: string, arquivo: string, campo: string): string {
  const texto = valor.trim();
  const matchLocal = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(texto);
  if (matchLocal) {
    const ano = Number(matchLocal[1]);
    const mes = Number(matchLocal[2]);
    const dia = Number(matchLocal[3]);
    const hora = Number(matchLocal[4]);
    const min = Number(matchLocal[5]);
    const seg = Number(matchLocal[6] ?? "0");
    if (!dataCalendarioValida(ano, mes, dia, hora, min, seg)) {
      throw new Error(`${arquivo}: data inválida em '${campo}': ${valor}`);
    }
    const utcMs = Date.UTC(ano, mes - 1, dia, hora, min, seg) + 3 * 3600_000;
    return new Date(utcMs).toISOString();
  }

  const matchIso =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      texto,
    );
  if (matchIso) {
    const ano = Number(matchIso[1]);
    const mes = Number(matchIso[2]);
    const dia = Number(matchIso[3]);
    const hora = Number(matchIso[4]);
    const min = Number(matchIso[5]);
    const seg = Number(matchIso[6] ?? "0");
    if (!dataCalendarioValida(ano, mes, dia, hora, min, seg)) {
      throw new Error(`${arquivo}: data inválida em '${campo}': ${valor}`);
    }
    if (matchIso[7] !== "Z") {
      const fusoH = Number(matchIso[9]);
      const fusoM = Number(matchIso[10]);
      if (fusoH > 23 || fusoM > 59) {
        throw new Error(`${arquivo}: fuso inválido em '${campo}': ${valor}`);
      }
    }
    const ms = Date.parse(texto);
    if (!Number.isNaN(ms)) {
      return new Date(ms).toISOString();
    }
  }

  throw new Error(`${arquivo}: data inválida em '${campo}': ${valor}`);
}

function textoObrigatorio(dados: Record<string, ValorFm>, campo: string, arquivo: string): string {
  const val = dados[campo];
  if (typeof val !== "string" || val.trim() === "") {
    throw new Error(`${arquivo}: campo '${campo}' obrigatório`);
  }
  return val.trim();
}

function listaObrigatoria(dados: Record<string, ValorFm>, campo: string, arquivo: string): string[] {
  const val = dados[campo];
  if (Array.isArray(val)) return val;
  if (typeof val === "string" && val.trim() !== "") return [val.trim()];
  throw new Error(`${arquivo}: campo '${campo}' obrigatório`);
}

/**
 * Expande ids de grupo (ex.: `erp`) para os ids de seus componentes e valida cada referência.
 */
export function expandirComponentes(config: Config, refs: string[]): string[] {
  const grupos = new Map<string, string[]>();
  const comps = new Set<string>();
  for (const g of config.grupos) {
    grupos.set(
      g.id,
      g.componentes.map((c) => c.id),
    );
    for (const c of g.componentes) comps.add(c.id);
  }

  const resultado: string[] = [];
  const vistos = new Set<string>();
  const adicionar = (id: string) => {
    if (!vistos.has(id)) {
      vistos.add(id);
      resultado.push(id);
    }
  };

  for (const ref of refs) {
    const doGrupo = grupos.get(ref);
    if (doGrupo) {
      for (const id of doGrupo) adicionar(id);
    } else if (comps.has(ref)) {
      adicionar(ref);
    } else {
      throw new Error(`componente '${ref}' não existe em status.config.json`);
    }
  }

  return resultado;
}

function listarArquivosMarkdown(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("_modelo"))
    .map((e) => e.name)
    .sort();
}

/** Carrega as manutenções programadas de `content/manutencoes/*.md`. */
export function carregarManutencoes(dir: string, config: Config): Manutencao[] {
  const arquivos = listarArquivosMarkdown(dir);
  const lista: Manutencao[] = [];

  for (const arquivo of arquivos) {
    const conteudo = fs.readFileSync(path.join(dir, arquivo), "utf8");
    const { dados, corpo } = parseFrontmatter(conteudo, arquivo);
    const titulo = textoObrigatorio(dados, "titulo", arquivo);
    const refs = listaObrigatoria(dados, "componentes", arquivo);
    let componentes: string[];
    try {
      componentes = expandirComponentes(config, refs);
    } catch (err) {
      throw new Error(`${arquivo}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const inicio = parseDataIsoUtc(textoObrigatorio(dados, "inicio", arquivo), arquivo, "inicio");
    const fim = parseDataIsoUtc(textoObrigatorio(dados, "fim", arquivo), arquivo, "fim");

    if (Date.parse(fim) < Date.parse(inicio)) {
      throw new Error(`${arquivo}: 'fim' não pode ser anterior a 'inicio'`);
    }

    lista.push({
      slug: arquivo.slice(0, -3),
      titulo,
      componentes,
      inicio,
      fim,
      corpo,
    });
  }

  return lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/** Carrega os incidentes manuais de `content/incidentes/*.md`. */
export function carregarIncidentesManuais(dir: string, config: Config): IncidenteManual[] {
  const arquivos = listarArquivosMarkdown(dir);
  const lista: IncidenteManual[] = [];

  for (const arquivo of arquivos) {
    const conteudo = fs.readFileSync(path.join(dir, arquivo), "utf8");
    const { dados, corpo } = parseFrontmatter(conteudo, arquivo);
    const titulo = textoObrigatorio(dados, "titulo", arquivo);
    const refs = listaObrigatoria(dados, "componentes", arquivo);
    let componentes: string[];
    try {
      componentes = expandirComponentes(config, refs);
    } catch (err) {
      throw new Error(`${arquivo}: ${err instanceof Error ? err.message : String(err)}`);
    }

    const impactoBruto = textoObrigatorio(dados, "impacto", arquivo);
    if (!IMPACTOS_VALIDOS.has(impactoBruto as IncidenteManual["impacto"])) {
      throw new Error(`${arquivo}: impacto desconhecido '${impactoBruto}'`);
    }
    const impacto = impactoBruto as IncidenteManual["impacto"];

    const estadoBruto = textoObrigatorio(dados, "estado", arquivo);
    if (!ESTADOS_VALIDOS.has(estadoBruto as IncidenteManual["estado"])) {
      throw new Error(`${arquivo}: estado desconhecido '${estadoBruto}'`);
    }
    const estado = estadoBruto as IncidenteManual["estado"];

    const inicio = parseDataIsoUtc(textoObrigatorio(dados, "inicio", arquivo), arquivo, "inicio");
    let fim: string | undefined;
    const fimBruto = dados["fim"];
    if (typeof fimBruto === "string" && fimBruto.trim() !== "") {
      fim = parseDataIsoUtc(fimBruto, arquivo, "fim");
      if (Date.parse(fim) < Date.parse(inicio)) {
        throw new Error(`${arquivo}: 'fim' não pode ser anterior a 'inicio'`);
      }
    }

    const inc: IncidenteManual = {
      slug: arquivo.slice(0, -3),
      titulo,
      componentes,
      impacto,
      estado,
      inicio,
      corpo,
    };
    if (fim !== undefined) inc.fim = fim;
    lista.push(inc);
  }

  return lista.sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/** Retorna os ids de componentes cuja janela `[inicio, fim)` contém `agora`. */
export function componentesEmManutencao(manutencoes: Manutencao[], agora: Date): Set<string> {
  const t = agora.getTime();
  const ativos = new Set<string>();
  for (const m of manutencoes) {
    if (Date.parse(m.inicio) <= t && t < Date.parse(m.fim)) {
      for (const id of m.componentes) ativos.add(id);
    }
  }
  return ativos;
}

/** Retorna os componentes afetados por incidentes manuais abertos com impacto diferente de `nenhum`. */
export function componentesComImpactoManual(
  incs: IncidenteManual[],
  agora: Date,
): Map<string, "degradado" | "fora"> {
  const t = agora.getTime();
  const mapa = new Map<string, "degradado" | "fora">();
  for (const inc of incs) {
    if (inc.estado === "resolvido" || inc.impacto === "nenhum") continue;
    if (inc.fim && Date.parse(inc.fim) <= t) continue;
    for (const id of inc.componentes) {
      const atual = mapa.get(id);
      if (atual !== "fora") {
        mapa.set(id, inc.impacto);
      }
    }
  }
  return mapa;
}
