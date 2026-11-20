const FUSO = "America/Sao_Paulo";

const fmtDia = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Dia (AAAA-MM-DD) no horário de Brasília. */
export function diaBrasilia(d: Date): string {
  return fmtDia.format(d);
}

/** Dia anterior de uma chave AAAA-MM-DD (aritmética em UTC, sem horário de verão). */
export function somaDias(chave: string, dias: number): string {
  const [a, m, d] = chave.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

/** Lista as últimas `n` chaves de dia, da mais antiga para a de hoje. */
export function ultimosDias(hoje: string, n: number): string[] {
  const lista: string[] = [];
  for (let i = n - 1; i >= 0; i--) lista.push(somaDias(hoje, -i));
  return lista;
}

const fmtDataHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** "20/11/2026 14:30" em Brasília. */
export function dataHora(iso: string): string {
  return fmtDataHora.format(new Date(iso)).replace(",", "");
}

/** "20/11/2026" a partir de AAAA-MM-DD. */
export function dataBr(chave: string): string {
  const [a, m, d] = chave.split("-");
  return `${d}/${m}/${a}`;
}

/** "1 h 05 min", "12 min", "menos de 1 min". */
export function duracao(deIso: string, ateIso: string): string {
  const min = Math.max(0, Math.round((Date.parse(ateIso) - Date.parse(deIso)) / 60000));
  if (min < 1) return "menos de 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  if (h >= 24) {
    const dias = Math.floor(h / 24);
    return `${dias} d ${h % 24} h`;
  }
  return r ? `${h} h ${String(r).padStart(2, "0")} min` : `${h} h`;
}
