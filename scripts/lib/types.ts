/** Resultado de uma checagem, já classificado. */
export type Classe = "ok" | "degradado" | "fora";

/** Estado de um componente. `manutencao` vem de content/manutencoes. */
export type EstadoComp = Classe | "manutencao";

/** Estado de um grupo ou do conjunto: soma o `falha_parcial` (parte do grupo fora). */
export type EstadoAgregado = "ok" | "degradado" | "falha_parcial" | "fora" | "manutencao";

export interface ConfigComponente {
  id: string;
  nome: string;
  descricao?: string;
  url: string;
  /** Status HTTP esperado. Sem `esperado` nem `json`, qualquer 2xx vale. */
  esperado?: number;
  /** Trecho que precisa aparecer no corpo. */
  contem?: string;
  /** Valor lido do JSON da resposta (`a.b.c`) que precisa estar em `em`. */
  json?: { caminho: string; em: string[] };
  latenciaMaxMs?: number;
}

export interface ConfigGrupo {
  id: string;
  nome: string;
  descricao?: string;
  link?: string;
  /** Caminho do logo (relativo a site/), exibido ao lado do nome do produto. */
  logo?: string;
  componentes: ConfigComponente[];
}

export interface Config {
  site: { nome: string; url: string; contato: string; ajuda: string; intervaloMin: number };
  padroes: { timeoutMs: number; latenciaMaxMs: number; falhasParaConfirmar: number; urlControle?: string };
  grupos: ConfigGrupo[];
}

export interface Resultado {
  classe: Classe;
  ms: number;
  http?: number;
  erro?: string;
}

export interface Checagem {
  em: string;
  classe: Classe;
  ms: number;
  http?: number;
  erro?: string;
}

export interface DiaStats {
  total: number;
  degradado: number;
  fora: number;
  manutencao: number;
}

export interface EstadoComponente {
  confirmado: EstadoComp;
  /** Classe observada que ainda não foi confirmada (anti-oscilação). */
  candidato?: Classe;
  candidatoDesde?: string;
  contagem: number;
  desde: string;
  ultima?: Checagem;
  recentes: Checagem[];
  /** Chave AAAA-MM-DD no horário de Brasília. */
  diario: Record<string, DiaStats>;
}

export interface AtualizacaoIncidente {
  em: string;
  classe: Classe;
  texto: string;
}

export interface Incidente {
  id: string;
  componente: string;
  grupo: string;
  titulo: string;
  gravidade: Exclude<Classe, "ok">;
  inicio: string;
  fim?: string;
  atualizacoes: AtualizacaoIncidente[];
  /** Controle do aviso no Telegram, para reenviar se o envio falhar. */
  avisos: { aberto: boolean; resolvido: boolean };
}

export interface Estado {
  versao: 1;
  atualizadoEm?: string;
  componentes: Record<string, EstadoComponente>;
  incidentes: Incidente[];
}

export type Evento =
  | { tipo: "aberto"; incidente: Incidente }
  | { tipo: "atualizado"; incidente: Incidente; anterior: Exclude<Classe, "ok"> }
  | { tipo: "resolvido"; incidente: Incidente };

/** Manutenção programada (content/manutencoes/*.md), já com os componentes expandidos. */
export interface Manutencao {
  slug: string;
  titulo: string;
  componentes: string[];
  inicio: string;
  fim: string;
  corpo: string;
}

/** Incidente escrito à mão (content/incidentes/*.md). */
export interface IncidenteManual {
  slug: string;
  titulo: string;
  componentes: string[];
  /** `nenhum` só informa; os outros mantêm o componente nesse estado enquanto aberto. */
  impacto: "nenhum" | "degradado" | "fora";
  estado: "investigando" | "identificado" | "monitorando" | "resolvido";
  inicio: string;
  fim?: string;
  corpo: string;
}
