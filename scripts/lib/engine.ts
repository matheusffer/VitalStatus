import { diaBrasilia } from "./tempo";
import type {
  Checagem,
  Classe,
  Config,
  ConfigComponente,
  Estado,
  EstadoComponente,
  EstadoComp,
  Evento,
  Incidente,
  Resultado,
} from "./types";

export const RECENTES_MAX = 300;
export const DIAS_RETENCAO = 100;
export const DIAS_INCIDENTES = 90;

export function estadoVazio(): Estado {
  return { versao: 1, componentes: {}, incidentes: [] };
}

function novoComponente(agora: string): EstadoComponente {
  return { confirmado: "ok", contagem: 0, desde: agora, recentes: [], diario: {} };
}

function peso(c: Classe): number {
  return c === "fora" ? 2 : c === "degradado" ? 1 : 0;
}

export function listaComponentes(config: Config): { grupo: string; comp: ConfigComponente }[] {
  return config.grupos.flatMap((g) => g.componentes.map((comp) => ({ grupo: g.id, comp })));
}

function tituloIncidente(nomeGrupo: string, nomeComp: string, g: Exclude<Classe, "ok">): string {
  return g === "fora"
    ? `${nomeGrupo}: ${nomeComp} fora do ar`
    : `${nomeGrupo}: ${nomeComp} com lentidão ou instabilidade`;
}

/**
 * Aplica o resultado de uma rodada de checagens ao estado.
 *
 * Anti-oscilação: uma classe nova só vira o estado confirmado depois de
 * `falhasParaConfirmar` checagens seguidas iguais. O incidente nasce com a hora da
 * PRIMEIRA checagem ruim e fecha com a hora da primeira boa, não com a da confirmação.
 *
 * Função pura em relação ao estado recebido: devolve uma cópia nova.
 */
export function aplicar(
  anterior: Estado,
  config: Config,
  resultados: Record<string, Resultado>,
  agora: Date,
  emManutencao: ReadonlySet<string>,
): { estado: Estado; eventos: Evento[] } {
  const estado: Estado = structuredClone(anterior);
  const eventos: Evento[] = [];
  const iso = agora.toISOString();
  const dia = diaBrasilia(agora);
  const n = config.padroes.falhasParaConfirmar;
  const nomes = new Map(config.grupos.map((g) => [g.id, g]));

  for (const { grupo, comp } of listaComponentes(config)) {
    const r = resultados[comp.id];
    if (!r) continue; // componente sem resultado nesta rodada: não mexe
    const st = (estado.componentes[comp.id] ??= novoComponente(iso));
    const g = nomes.get(grupo)!;

    const reg: Checagem = { em: iso, classe: r.classe, ms: r.ms };
    if (r.http !== undefined) reg.http = r.http;
    if (r.erro) reg.erro = r.erro;
    st.ultima = reg;
    st.recentes.push(reg);
    if (st.recentes.length > RECENTES_MAX) st.recentes.splice(0, st.recentes.length - RECENTES_MAX);

    if (emManutencao.has(comp.id)) {
      if (st.confirmado !== "manutencao") {
        st.confirmado = "manutencao";
        st.desde = iso;
      }
      st.candidato = undefined;
      st.candidatoDesde = undefined;
      st.contagem = 0;
    } else {
      if (st.confirmado === "manutencao") {
        // Saiu da janela: parte do "ok" e a rodada seguinte confirma ou não.
        st.confirmado = "ok";
        st.desde = iso;
      }
      const atual = st.confirmado as Classe;
      if (r.classe === atual) {
        st.candidato = undefined;
        st.candidatoDesde = undefined;
        st.contagem = 0;
      } else {
        if (st.candidato === r.classe) {
          st.contagem += 1;
        } else {
          st.candidato = r.classe;
          st.candidatoDesde = iso;
          st.contagem = 1;
        }
        if (st.contagem >= n) {
          const nova = st.candidato;
          const desde = st.candidatoDesde ?? iso;
          st.confirmado = nova;
          st.desde = desde;
          st.candidato = undefined;
          st.candidatoDesde = undefined;
          st.contagem = 0;
          transicao(estado, eventos, g.id, g.nome, comp, atual, nova, desde);
        }
      }
    }

    const d = (st.diario[dia] ??= { total: 0, degradado: 0, fora: 0, manutencao: 0 });
    d.total += 1;
    if (st.confirmado === "fora") d.fora += 1;
    else if (st.confirmado === "degradado") d.degradado += 1;
    else if (st.confirmado === "manutencao") d.manutencao += 1;

    podaDiario(st, dia);
  }

  estado.incidentes = estado.incidentes.filter(
    (i) => !i.fim || Date.parse(i.fim) > agora.getTime() - DIAS_INCIDENTES * 86400000,
  );
  estado.atualizadoEm = iso;
  return { estado, eventos };
}

function podaDiario(st: EstadoComponente, hoje: string) {
  const corte = Date.parse(`${hoje}T00:00:00Z`) - DIAS_RETENCAO * 86400000;
  for (const k of Object.keys(st.diario)) {
    if (Date.parse(`${k}T00:00:00Z`) < corte) delete st.diario[k];
  }
}

function transicao(
  estado: Estado,
  eventos: Evento[],
  grupoId: string,
  grupoNome: string,
  comp: ConfigComponente,
  de: Classe,
  para: Classe,
  desde: string,
) {
  const aberto = estado.incidentes.find((i) => i.componente === comp.id && !i.fim);

  if (para === "ok") {
    if (!aberto) return;
    aberto.fim = desde;
    aberto.atualizacoes.push({ em: desde, classe: "ok", texto: "Normalizado. Tudo voltou a funcionar." });
    eventos.push({ tipo: "resolvido", incidente: aberto });
    return;
  }

  if (de === "ok" || !aberto) {
    const inc: Incidente = {
      id: `${comp.id}-${Math.floor(Date.parse(desde) / 1000)}`,
      componente: comp.id,
      grupo: grupoId,
      titulo: tituloIncidente(grupoNome, comp.nome, para),
      gravidade: para,
      inicio: desde,
      atualizacoes: [
        {
          em: desde,
          classe: para,
          texto:
            para === "fora"
              ? "Detectamos que o serviço não está respondendo. Estamos verificando."
              : "Detectamos lentidão ou instabilidade. Estamos verificando.",
        },
      ],
      avisos: { aberto: false, resolvido: false },
    };
    estado.incidentes.push(inc);
    eventos.push({ tipo: "aberto", incidente: inc });
    return;
  }

  // degradado <-> fora com incidente já aberto
  const anterior = aberto.gravidade;
  aberto.gravidade = para;
  aberto.titulo = tituloIncidente(grupoNome, comp.nome, para);
  aberto.atualizacoes.push({
    em: desde,
    classe: para,
    texto:
      peso(para) > peso(anterior)
        ? "A situação piorou: o serviço deixou de responder."
        : "O serviço voltou a responder, mas ainda com lentidão ou instabilidade.",
  });
  eventos.push({ tipo: "atualizado", incidente: aberto, anterior });
}

/** Combina o estado de vários componentes no de um grupo (ou do conjunto). */
export function agregar(estados: EstadoComp[]): "ok" | "degradado" | "falha_parcial" | "fora" | "manutencao" {
  if (estados.length === 0) return "ok";
  const fora = estados.filter((e) => e === "fora").length;
  if (fora === estados.length) return "fora";
  if (fora > 0) return "falha_parcial";
  if (estados.some((e) => e === "degradado")) return "degradado";
  if (estados.every((e) => e === "manutencao")) return "manutencao";
  if (estados.some((e) => e === "manutencao")) return "manutencao";
  return "ok";
}
