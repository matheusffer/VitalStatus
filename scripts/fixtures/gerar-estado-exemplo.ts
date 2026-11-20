import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listaComponentes } from "../lib/engine";
import { diaBrasilia, ultimosDias } from "../lib/tempo";
import type { Config, DiaStats, Estado } from "../lib/types";

/** Gerador pseudoaleatório determinístico (Mulberry32) para fixture visual. */
function criarPrng(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gerarEstadoExemplo(config: Config, agora = new Date()): Estado {
  const rand = criarPrng(20261119);
  const hoje = diaBrasilia(agora);
  const dias = ultimosDias(hoje, 90);
  const agoraIso = agora.toISOString();
  const componentesLista = listaComponentes(config);

  const compUptime992 = "erp-fiscal";
  const compAbertoDegradado = "pdv-api";
  const compManutencao = "talk-api";

  const estado: Estado = {
    versao: 1,
    atualizadoEm: agoraIso,
    componentes: {},
    incidentes: [],
  };

  for (const { comp } of componentesLista) {
    const diario: Record<string, DiaStats> = {};
    for (let i = 0; i < dias.length; i++) {
      const dia = dias[i]!;
      const isHoje = i === dias.length - 1;
      const total = isHoje ? 120 : 288;
      diario[dia] = { total, degradado: 0, fora: 0, manutencao: 0 };
    }

    if (comp.id === compUptime992) {
      // ~99,2% de disponibilidade em 90 dias (~207 checagens ponderadas de falha em ~25.752 totais).
      const diaIncidente = dias[dias.length - 4] ?? hoje;
      const diaExtra1 = dias[20] ?? hoje;
      const diaExtra2 = dias[55] ?? hoje;
      if (diario[diaIncidente]) {
        diario[diaIncidente]!.fora = 10;
        diario[diaIncidente]!.degradado = 8;
      }
      if (diario[diaExtra1]) {
        diario[diaExtra1]!.fora = 120;
      }
      if (diario[diaExtra2]) {
        diario[diaExtra2]!.fora = 50;
        diario[diaExtra2]!.degradado = 46;
      }
    }

    if (comp.id === compAbertoDegradado) {
      const dHoje = diario[hoje];
      if (dHoje) dHoje.degradado = 6;
    }

    if (comp.id === compManutencao) {
      const dHoje = diario[hoje];
      if (dHoje) dHoje.manutencao = 12;
    }

    const confirmado =
      comp.id === compAbertoDegradado
        ? "degradado"
        : comp.id === compManutencao
          ? "manutencao"
          : "ok";

    const msBase = Math.round(90 + rand() * 140);
    const inicioDegradado = new Date(agora.getTime() - 25 * 60 * 1000).toISOString();

    estado.componentes[comp.id] = {
      confirmado,
      contagem: 0,
      desde: confirmado === "degradado" ? inicioDegradado : agoraIso,
      ultima: {
        em: agoraIso,
        classe: confirmado === "manutencao" ? "ok" : confirmado,
        ms: confirmado === "degradado" ? 5400 : msBase,
        http: 200,
      },
      recentes: [
        {
          em: agoraIso,
          classe: confirmado === "manutencao" ? "ok" : confirmado,
          ms: confirmado === "degradado" ? 5400 : msBase,
          http: 200,
        },
      ],
      diario,
    };
  }

  const inicioResolvido = new Date(agora.getTime() - 3 * 86400000 - 45 * 60000).toISOString();
  const fimResolvido = new Date(agora.getTime() - 3 * 86400000).toISOString();
  const inicioAberto = new Date(agora.getTime() - 25 * 60000).toISOString();

  estado.incidentes = [
    {
      id: `${compUptime992}-${Math.floor(Date.parse(inicioResolvido) / 1000)}`,
      componente: compUptime992,
      grupo: "erp",
      titulo: "Vital ERP: Emissão de NF-e fora do ar",
      gravidade: "fora",
      inicio: inicioResolvido,
      fim: fimResolvido,
      atualizacoes: [
        {
          em: inicioResolvido,
          classe: "fora",
          texto: "Detectamos que o serviço não está respondendo. Estamos verificando.",
        },
        {
          em: new Date(Date.parse(inicioResolvido) + 20 * 60000).toISOString(),
          classe: "degradado",
          texto: "O serviço voltou a responder, mas ainda com lentidão ou instabilidade.",
        },
        {
          em: fimResolvido,
          classe: "ok",
          texto: "Normalizado. Tudo voltou a funcionar.",
        },
      ],
      avisos: { aberto: true, resolvido: true },
    },
    {
      id: `${compAbertoDegradado}-${Math.floor(Date.parse(inicioAberto) / 1000)}`,
      componente: compAbertoDegradado,
      grupo: "pdv",
      titulo: "Vital PDV: API com lentidão ou instabilidade",
      gravidade: "degradado",
      inicio: inicioAberto,
      atualizacoes: [
        {
          em: inicioAberto,
          classe: "degradado",
          texto: "Detectamos lentidão ou instabilidade. Estamos verificando.",
        },
      ],
      avisos: { aberto: true, resolvido: false },
    },
  ];

  return estado;
}

const ehPrincipal =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (ehPrincipal) {
  const raiz = process.cwd();
  const config = JSON.parse(readFileSync(join(raiz, "status.config.json"), "utf8")) as Config;
  const exemplo = gerarEstadoExemplo(config);
  mkdirSync(join(raiz, "data"), { recursive: true });
  writeFileSync(join(raiz, "data", "state.json"), `${JSON.stringify(exemplo, null, 2)}\n`, "utf8");
}
