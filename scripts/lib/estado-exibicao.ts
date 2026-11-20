import { agregar } from "./engine";
import { dataBr, diaBrasilia, ultimosDias } from "./tempo";
import type {
  AtualizacaoIncidente,
  Config,
  Estado,
  EstadoAgregado,
  EstadoComp,
  IncidenteManual,
  Manutencao,
} from "./types";

export const JANELA_DIAS_BARRA = 90;
export const JANELA_DIAS_RECENTES = 30;
export const JANELA_DIAS_MANUTENCAO_FUTURA = 14;
export const LIMITE_ATRASO_MS = 20 * 60 * 1000;

export type EstadoDiaBarra = "sem_dados" | "ok" | "degradado" | "fora" | "manutencao";
export type TomVisual = "pos" | "alert" | "neg" | "info" | "neutral";

export interface DiaBarra {
  dia: string;
  estado: EstadoDiaBarra;
  minFora: number;
  minDegradado: number;
  label: string;
}

export interface ComponenteExibicao {
  id: string;
  nome: string;
  descricao?: string;
  /** `null` quando nunca houve checagem nem sobreposição manual/manutenção. */
  estado: EstadoComp | null;
  estadoJson: EstadoComp;
  rotuloEstado: string;
  tom: TomVisual;
  uptime90d: number | null;
  barra90d: DiaBarra[];
  resumoBarraAria: string;
}

export interface ProdutoExibicao {
  id: string;
  nome: string;
  descricao?: string;
  link?: string;
  logo?: string;
  emBreve: boolean;
  estado: EstadoAgregado;
  rotuloEstado: string;
  tom: TomVisual;
  componentes: ComponenteExibicao[];
}

export interface IncidenteExibicao {
  id: string;
  origem: "automatico" | "manual";
  titulo: string;
  gravidade: "fora" | "degradado" | "informativo";
  rotuloGravidade: string;
  tom: TomVisual;
  estadoManual?: IncidenteManual["estado"];
  produto: string;
  componente: string;
  inicio: string;
  fim?: string;
  ultimaAtualizacaoEm: string;
  atualizacoes: AtualizacaoIncidente[];
  corpoMarkdown?: string;
}

export interface ManutencaoExibicao {
  slug: string;
  titulo: string;
  emAndamento: boolean;
  inicio: string;
  fim: string;
  componentes: string[];
  corpoMarkdown: string;
}

export interface EstadoExibicao {
  semDados: boolean;
  atualizadoEm: string;
  atrasado: boolean;
  estadoGeral: EstadoAgregado;
  rotuloGeral: string;
  fraseGeral: string;
  tomGeral: TomVisual;
  produtos: ProdutoExibicao[];
  incidentesAtivos: IncidenteExibicao[];
  manutencoesProgramadas: ManutencaoExibicao[];
  incidentesRecentes30d: IncidenteExibicao[];
  incidentes90d: IncidenteExibicao[];
}

export interface EntradaExibicao {
  estado: Estado | null;
  config: Config;
  manutencoes: Manutencao[];
  incidentesManuais: IncidenteManual[];
  emManutencao: ReadonlySet<string>;
  impactoManual: ReadonlyMap<string, "degradado" | "fora">;
  agora: Date;
}

export function rotuloEstadoComp(e: EstadoComp | null): string {
  switch (e) {
    case "ok":
      return "Operacional";
    case "degradado":
      return "Degradado";
    case "fora":
      return "Fora do ar";
    case "manutencao":
      return "Em manutenção";
    case null:
      return "Sem dados";
  }
}

export function rotuloEstadoAgregado(e: EstadoAgregado, emBreve = false): string {
  if (emBreve) return "Em breve";
  switch (e) {
    case "ok":
      return "Operacional";
    case "degradado":
      return "Degradado";
    case "falha_parcial":
      return "Falha parcial";
    case "fora":
      return "Fora do ar";
    case "manutencao":
      return "Em manutenção";
  }
}

export function tomDoEstado(e: EstadoAgregado | null): TomVisual {
  switch (e) {
    case "ok":
      return "pos";
    case "degradado":
    case "falha_parcial":
      return "alert";
    case "fora":
      return "neg";
    case "manutencao":
      return "info";
    case null:
      return "neutral";
  }
}

export function formatarPercentualPtBr(valor: number): string {
  return valor.toFixed(2).replace(".", ",");
}

/**
 * Calcula a disponibilidade dos últimos 90 dias a partir dos contadores diários:
 *
 *   uptime = 1 − (soma(fora) + 0,5 × soma(degradado)) / soma(total − manutencao)
 *
 * Dias sem checagens (`total === 0`) e checagens em janela de manutenção (`manutencao`)
 * são ignorados no denominador para não distorcer a disponibilidade real do serviço.
 * Retorna `null` quando não há nenhuma checagem válida fora de manutenção.
 */
export function calcularUptime90d(
  diario: Record<string, { total: number; degradado: number; fora: number; manutencao: number }> | undefined,
  dias: readonly string[],
): number | null {
  if (!diario) return null;

  let somaFora = 0;
  let somaDegradado = 0;
  let somaTotal = 0;

  for (const chave of dias) {
    const d = diario[chave];
    if (!d || d.total <= 0) continue;
    const efetivo = Math.max(0, d.total - d.manutencao);
    if (efetivo === 0) continue;
    somaFora += Math.min(d.fora, efetivo);
    somaDegradado += Math.min(d.degradado, Math.max(0, efetivo - Math.min(d.fora, efetivo)));
    somaTotal += efetivo;
  }

  if (somaTotal === 0) return null;

  const fracao = 1 - (somaFora + 0.5 * somaDegradado) / somaTotal;
  const clamped = Math.max(0, Math.min(1, fracao));
  return Math.round(clamped * 10000) / 100;
}

export function construirBarra90d(
  diario: Record<string, { total: number; degradado: number; fora: number; manutencao: number }> | undefined,
  dias: readonly string[],
): { barra: DiaBarra[]; diasComProblemas: number } {
  const barra: DiaBarra[] = [];
  let diasComProblemas = 0;

  for (const dia of dias) {
    const d = diario?.[dia];
    const data = dataBr(dia);

    if (!d || d.total <= 0) {
      barra.push({
        dia,
        estado: "sem_dados",
        minFora: 0,
        minDegradado: 0,
        label: `${data}: sem dados`,
      });
      continue;
    }

    const minFora = d.fora > 0 ? Math.max(1, Math.round((d.fora / d.total) * 1440)) : 0;
    const minDegradado =
      d.degradado > 0 ? Math.max(1, Math.round((d.degradado / d.total) * 1440)) : 0;

    // Pior estado observado no dia: fora > degradado > manutencao > ok.
    let estado: EstadoDiaBarra = "ok";
    let label = `${data}: operacional`;

    if (d.fora > 0) {
      estado = "fora";
      diasComProblemas += 1;
      label =
        minDegradado > 0
          ? `${data}: ${minFora} min fora do ar e ${minDegradado} min com instabilidade`
          : `${data}: ${minFora} min fora do ar`;
    } else if (d.degradado > 0) {
      estado = "degradado";
      diasComProblemas += 1;
      label = `${data}: ${minDegradado} min com instabilidade`;
    } else if (d.manutencao > 0) {
      estado = "manutencao";
      label = `${data}: em manutenção`;
    }

    barra.push({ dia, estado, minFora, minDegradado, label });
  }

  return { barra, diasComProblemas };
}

function resumirBarraAria(uptime: number | null, diasComProblemas: number): string {
  if (uptime === null) {
    return "Sem dados suficientes nos últimos 90 dias.";
  }
  const parteProblemas =
    diasComProblemas === 0
      ? "Nenhum dia com problemas."
      : diasComProblemas === 1
        ? "1 dia com problemas."
        : `${diasComProblemas} dias com problemas.`;
  return `Disponibilidade dos últimos 90 dias: ${formatarPercentualPtBr(uptime)} %. ${parteProblemas}`;
}

function fraseEstadoGeral(estadoGeral: EstadoAgregado, produtos: ProdutoExibicao[]): string {
  if (estadoGeral === "ok") return "Todos os sistemas operacionais";
  if (estadoGeral === "manutencao") return "Manutenção programada em andamento";

  const afetados = produtos.filter(
    (p) => !p.emBreve && (p.estado === "fora" || p.estado === "falha_parcial" || p.estado === "degradado"),
  );
  if (afetados.length === 1 && afetados[0]) {
    return `Instabilidade em ${afetados[0].nome}`;
  }
  if (afetados.length > 1) {
    return `Instabilidade em ${afetados.length} produtos`;
  }
  return "Instabilidade parcial nos serviços";
}

/** Deriva toda a estrutura de exibição a partir do estado das sondas e do conteúdo manual. */
export function derivarEstadoExibicao(entrada: EntradaExibicao): EstadoExibicao {
  const { estado, config, manutencoes, incidentesManuais, emManutencao, impactoManual, agora } = entrada;
  const agoraMs = agora.getTime();
  const hoje = diaBrasilia(agora);
  const dias90 = ultimosDias(hoje, JANELA_DIAS_BARRA);

  const semDados = !estado || !estado.atualizadoEm;
  const atualizadoEm = estado?.atualizadoEm ?? agora.toISOString();
  const atrasado = !semDados && agoraMs - Date.parse(atualizadoEm) > LIMITE_ATRASO_MS;

  const compParaNome = new Map<string, { grupoId: string; grupoNome: string; compNome: string }>();
  for (const g of config.grupos) {
    for (const c of g.componentes) {
      compParaNome.set(c.id, { grupoId: g.id, grupoNome: g.nome, compNome: c.nome });
    }
  }

  const produtos: ProdutoExibicao[] = [];
  const estadosGerais: EstadoComp[] = [];

  for (const g of config.grupos) {
    const componentes: ComponenteExibicao[] = [];
    const estadosGrupo: EstadoComp[] = [];

    for (const c of g.componentes) {
      const compEstado = estado?.componentes[c.id];
      const temHistorico = Boolean(
        compEstado && (compEstado.ultima !== undefined || Object.keys(compEstado.diario).length > 0),
      );

      let estadoComp: EstadoComp | null = temHistorico && compEstado ? compEstado.confirmado : null;
      if (emManutencao.has(c.id)) {
        estadoComp = "manutencao";
      }
      const impacto = impactoManual.get(c.id);
      if (impacto) {
        estadoComp = impacto;
      }

      if (estadoComp !== null) {
        estadosGrupo.push(estadoComp);
      }

      const uptime90d = calcularUptime90d(compEstado?.diario, dias90);
      const { barra, diasComProblemas } = construirBarra90d(compEstado?.diario, dias90);

      componentes.push({
        id: c.id,
        nome: c.nome,
        descricao: c.descricao,
        estado: estadoComp,
        estadoJson: estadoComp ?? "ok",
        rotuloEstado: rotuloEstadoComp(estadoComp),
        tom: tomDoEstado(estadoComp),
        uptime90d,
        barra90d: barra,
        resumoBarraAria: resumirBarraAria(uptime90d, diasComProblemas),
      });
    }

    const emBreve = estadosGrupo.length === 0;
    const estadoGrupo: EstadoAgregado = emBreve ? "ok" : agregar(estadosGrupo);
    if (!emBreve) {
      estadosGerais.push(...estadosGrupo);
    }

    produtos.push({
      id: g.id,
      nome: g.nome,
      descricao: g.descricao,
      link: g.link,
      logo: g.logo,
      emBreve,
      estado: estadoGrupo,
      rotuloEstado: rotuloEstadoAgregado(estadoGrupo, emBreve),
      tom: emBreve ? "neutral" : tomDoEstado(estadoGrupo),
      componentes,
    });
  }

  const estadoGeral: EstadoAgregado = estadosGerais.length === 0 ? "ok" : agregar(estadosGerais);
  const rotuloGeral = semDados ? "Sem dados" : rotuloEstadoAgregado(estadoGeral);
  const fraseGeral = semDados
    ? "Ainda sem dados: a primeira verificação acontece em até 5 minutos"
    : fraseEstadoGeral(estadoGeral, produtos);
  const tomGeral: TomVisual = semDados ? "neutral" : tomDoEstado(estadoGeral);

  const grupoPorId = new Map(config.grupos.map((g) => [g.id, g.nome]));
  const todosIncidentes: IncidenteExibicao[] = [];

  for (const inc of estado?.incidentes ?? []) {
    const info = compParaNome.get(inc.componente);
    const produtoNome = info?.grupoNome ?? grupoPorId.get(inc.grupo) ?? inc.grupo;
    const compNome = info?.compNome ?? inc.componente;
    const atualizacoesDesc = [...inc.atualizacoes].sort(
      (a, b) => Date.parse(b.em) - Date.parse(a.em),
    );
    const ultimaAtualizacaoEm = atualizacoesDesc[0]?.em ?? inc.fim ?? inc.inicio;

    todosIncidentes.push({
      id: inc.id,
      origem: "automatico",
      titulo: inc.titulo,
      gravidade: inc.gravidade,
      rotuloGravidade: inc.gravidade === "fora" ? "Fora do ar" : "Degradado",
      tom: inc.gravidade === "fora" ? "neg" : "alert",
      produto: produtoNome,
      componente: compNome,
      inicio: inc.inicio,
      fim: inc.fim,
      ultimaAtualizacaoEm,
      atualizacoes: atualizacoesDesc,
    });
  }

  for (const inc of incidentesManuais) {
    const nomesProdutos: string[] = [];
    const nomesComponentes: string[] = [];
    for (const compId of inc.componentes) {
      const info = compParaNome.get(compId);
      if (info) {
        if (!nomesProdutos.includes(info.grupoNome)) nomesProdutos.push(info.grupoNome);
        nomesComponentes.push(info.compNome);
      } else {
        nomesComponentes.push(compId);
      }
    }

    const gravidade: IncidenteExibicao["gravidade"] =
      inc.impacto === "fora" ? "fora" : inc.impacto === "degradado" ? "degradado" : "informativo";
    const tom: TomVisual =
      gravidade === "fora" ? "neg" : gravidade === "degradado" ? "alert" : "info";
    const rotuloGravidade =
      gravidade === "fora" ? "Fora do ar" : gravidade === "degradado" ? "Degradado" : "Informativo";

    todosIncidentes.push({
      id: `manual-${inc.slug}`,
      origem: "manual",
      titulo: inc.titulo,
      gravidade,
      rotuloGravidade,
      tom,
      estadoManual: inc.estado,
      produto: nomesProdutos.join(", ") || "Vital",
      componente: nomesComponentes.join(", ") || "Geral",
      inicio: inc.inicio,
      fim: inc.fim,
      ultimaAtualizacaoEm: inc.fim ?? inc.inicio,
      atualizacoes: [],
      corpoMarkdown: inc.corpo,
    });
  }

  const incidentesAtivos = todosIncidentes
    .filter((i) => (i.origem === "automatico" ? !i.fim : i.estadoManual !== "resolvido" && !i.fim))
    .sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio));

  const corte30d = agoraMs - JANELA_DIAS_RECENTES * 86400000;
  const corte90d = agoraMs - JANELA_DIAS_BARRA * 86400000;

  const incidentesRecentes30d = todosIncidentes
    .filter((i) => {
      const ativo = i.origem === "automatico" ? !i.fim : i.estadoManual !== "resolvido" && !i.fim;
      if (ativo) return false;
      const refMs = Date.parse(i.fim ?? i.inicio);
      return Number.isFinite(refMs) && refMs >= corte30d;
    })
    .sort((a, b) => Date.parse(b.inicio) - Date.parse(a.inicio));

  const incidentes90d = todosIncidentes
    .filter((i) => {
      const refMs = Date.parse(i.fim ?? i.inicio);
      return Number.isFinite(refMs) && refMs >= corte90d;
    })
    .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));

  const limiteFuturo = agoraMs + JANELA_DIAS_MANUTENCAO_FUTURA * 86400000;
  const manutencoesProgramadas: ManutencaoExibicao[] = manutencoes
    .filter((m) => {
      const iniMs = Date.parse(m.inicio);
      const fimMs = Date.parse(m.fim);
      if (!Number.isFinite(iniMs) || !Number.isFinite(fimMs)) return false;
      const emAndamento = iniMs <= agoraMs && agoraMs <= fimMs;
      const futuraNaJanela = iniMs > agoraMs && iniMs <= limiteFuturo;
      return emAndamento || futuraNaJanela;
    })
    .sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio))
    .map((m) => {
      const iniMs = Date.parse(m.inicio);
      const fimMs = Date.parse(m.fim);
      const nomes = m.componentes.map((id) => {
        const info = compParaNome.get(id);
        return info ? `${info.grupoNome} — ${info.compNome}` : id;
      });
      return {
        slug: m.slug,
        titulo: m.titulo,
        emAndamento: iniMs <= agoraMs && agoraMs <= fimMs,
        inicio: m.inicio,
        fim: m.fim,
        componentes: nomes,
        corpoMarkdown: m.corpo,
      };
    });

  return {
    semDados,
    atualizadoEm,
    atrasado,
    estadoGeral,
    rotuloGeral,
    fraseGeral,
    tomGeral,
    produtos,
    incidentesAtivos,
    manutencoesProgramadas,
    incidentesRecentes30d,
    incidentes90d,
  };
}
