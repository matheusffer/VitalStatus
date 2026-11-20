import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rodar, verificarControle } from "../scripts/probe";
import type { enviar } from "../scripts/lib/telegram";
import type { Config } from "../scripts/lib/types";

const tempDirs: string[] = [];

function criarTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vitalstatus-probe-"));
  tempDirs.push(dir);
  return dir;
}

function escreverConfig(dir: string, urlControle?: string): string {
  const cfg: Config = {
    site: {
      nome: "Status Vital",
      url: "https://status.vitalerp.tech",
      contato: "https://vitalerp.tech",
      ajuda: "https://gerencial.vitalerp.tech/ajuda",
      intervaloMin: 5,
    },
    padroes: {
      timeoutMs: 8000,
      latenciaMaxMs: 5000,
      falhasParaConfirmar: 2,
      ...(urlControle ? { urlControle } : {}),
    },
    grupos: [
      {
        id: "pdv",
        nome: "Vital PDV",
        componentes: [{ id: "pdv-api", nome: "API", url: "https://vitalpdv.tech/api/v1/live", esperado: 200 }],
      },
    ],
  };
  const arq = path.join(dir, "status.config.json");
  fs.writeFileSync(arq, JSON.stringify(cfg));
  return arq;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("probe rodar()", () => {
  it("abre na 2ª falha, fecha na 4ª e reenvia aviso pendente após falha do Telegram", async () => {
    const dir = criarTempDir();
    const configPath = escreverConfig(dir);
    const statePath = path.join(dir, "data", "state.json");
    const manutencoesDir = path.join(dir, "manutencoes");

    let statusAtual = 404;
    const fetchMock = vi.fn(async () => new Response("body", { status: statusAtual }));
    vi.stubGlobal("fetch", fetchMock);

    const enviarMsg = vi
      .fn<typeof enviar>()
      // 1ª tentativa (abertura na rodada 2) falha; 2ª (reenvio na rodada 3) e 3ª (resolvido na rodada 4) funcionam
      .mockResolvedValueOnce({ ok: false, erro: "falha de conexão" })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    const logs: string[] = [];
    const base = Date.parse("2026-11-20T14:00:00.000Z");

    // Rodada 1: 1ª falha -> ainda não abre incidente
    await rodar({
      configPath,
      statePath,
      manutencoesDir,
      semTelegram: false,
      agora: new Date(base),
      enviarMsg,
      log: (l) => logs.push(l),
    });
    expect(enviarMsg).not.toHaveBeenCalled();
    expect(fs.existsSync(statePath)).toBe(true);

    // Rodada 2: 2ª falha -> abre incidente e tenta avisar (falha)
    const r2 = await rodar({
      configPath,
      statePath,
      manutencoesDir,
      semTelegram: false,
      agora: new Date(base + 5 * 60_000),
      enviarMsg,
      log: (l) => logs.push(l),
    });
    expect(r2.eventos).toHaveLength(1);
    expect(enviarMsg).toHaveBeenCalledTimes(1);
    expect(r2.estado.incidentes[0]?.avisos).toEqual({ aberto: false, resolvido: false });

    // Rodada 3: 1º OK -> ainda não fecha incidente, mas reenvia aviso pendente de abertura
    statusAtual = 200;
    const r3 = await rodar({
      configPath,
      statePath,
      manutencoesDir,
      semTelegram: false,
      agora: new Date(base + 10 * 60_000),
      enviarMsg,
      log: (l) => logs.push(l),
    });
    expect(r3.eventos).toHaveLength(0);
    expect(enviarMsg).toHaveBeenCalledTimes(2);
    expect(r3.estado.incidentes[0]?.avisos).toEqual({ aberto: true, resolvido: false });

    // Rodada 4: 2º OK -> fecha incidente e envia aviso de normalização
    const r4 = await rodar({
      configPath,
      statePath,
      manutencoesDir,
      semTelegram: false,
      agora: new Date(base + 15 * 60_000),
      enviarMsg,
      log: (l) => logs.push(l),
    });
    expect(r4.eventos).toHaveLength(1);
    expect(r4.eventos[0]?.tipo).toBe("resolvido");
    expect(enviarMsg).toHaveBeenCalledTimes(3);
    expect(r4.estado.incidentes[0]?.avisos).toEqual({ aberto: true, resolvido: true });
    expect(r4.estado.incidentes[0]?.inicio).toBe(new Date(base).toISOString());
    expect(r4.estado.incidentes[0]?.fim).toBe(new Date(base + 10 * 60_000).toISOString());
  });

  it("não grava nem envia Telegram com --dry", async () => {
    const dir = criarTempDir();
    const configPath = escreverConfig(dir);
    const statePath = path.join(dir, "data", "state.json");

    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    const enviarMsg = vi.fn<typeof enviar>();

    await rodar({
      configPath,
      statePath,
      manutencoesDir: path.join(dir, "manutencoes"),
      dry: true,
      enviarMsg,
      log: () => {},
    });

    expect(fs.existsSync(statePath)).toBe(false);
    expect(enviarMsg).not.toHaveBeenCalled();
  });

  it("falha sem sobrescrever quando state.json está corrompido", async () => {
    const dir = criarTempDir();
    const configPath = escreverConfig(dir);
    const statePath = path.join(dir, "data", "state.json");
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, "{corrompido");

    await expect(
      rodar({
        configPath,
        statePath,
        manutencoesDir: path.join(dir, "manutencoes"),
        checar: async () => ({}),
        log: () => {},
      }),
    ).rejects.toThrow(/estado corrompido/);

    expect(fs.readFileSync(statePath, "utf8")).toBe("{corrompido");
  });

  it("não envia normalização se a abertura nunca foi enviada", async () => {
    const dir = criarTempDir();
    const configPath = escreverConfig(dir);
    const statePath = path.join(dir, "data", "state.json");
    const manutencoesDir = path.join(dir, "manutencoes");

    const enviarMsg = vi.fn<typeof enviar>().mockResolvedValue({ ok: false, erro: "Telegram não configurado" });
    const base = Date.parse("2026-11-20T14:00:00.000Z");

    const fora = async () => ({ "pdv-api": { classe: "fora" as const, ms: 0, erro: "HTTP 503" } });
    const ok = async () => ({ "pdv-api": { classe: "ok" as const, ms: 40, http: 200 } });

    await rodar({ configPath, statePath, manutencoesDir, agora: new Date(base), checar: fora, enviarMsg, log: () => {} });
    await rodar({
      configPath,
      statePath,
      manutencoesDir,
      agora: new Date(base + 5 * 60_000),
      checar: fora,
      enviarMsg,
      log: () => {},
    });
    // Rodada 3: 1º ok -> tenta reenviar abertura (falha)
    await rodar({
      configPath,
      statePath,
      manutencoesDir,
      agora: new Date(base + 10 * 60_000),
      checar: ok,
      enviarMsg,
      log: () => {},
    });
    expect(enviarMsg).toHaveBeenCalledTimes(2);

    // Rodada 4: 2º ok -> fecha incidente sem enviar normalização porque abertura nunca foi enviada
    const r4 = await rodar({
      configPath,
      statePath,
      manutencoesDir,
      agora: new Date(base + 15 * 60_000),
      checar: ok,
      enviarMsg,
      log: () => {},
    });
    expect(enviarMsg).toHaveBeenCalledTimes(2);
    expect(r4.estado.incidentes[0]?.avisos).toEqual({ aberto: true, resolvido: true });
  });

  it("ignora a rodada sem gravar nem avisar quando o controle falha e segue normal quando passa", async () => {
    const dir = criarTempDir();
    const configPath = escreverConfig(dir, "https://www.gstatic.com/generate_204");
    const statePath = path.join(dir, "data", "state.json");
    const manutencoesDir = path.join(dir, "manutencoes");

    const checar = vi.fn(async () => ({
      "pdv-api": { classe: "ok" as const, ms: 30, http: 200 },
    }));
    const enviarMsg = vi.fn<typeof enviar>();
    const logs: string[] = [];

    const ignorada = await rodar({
      configPath,
      statePath,
      manutencoesDir,
      semTelegram: false,
      controle: async () => false,
      checar,
      enviarMsg,
      log: (l) => logs.push(l),
    });

    expect(checar).not.toHaveBeenCalled();
    expect(enviarMsg).not.toHaveBeenCalled();
    expect(fs.existsSync(statePath)).toBe(false);
    expect(ignorada.eventos).toEqual([]);
    expect(ignorada.resultados).toEqual({});
    expect(logs).toContain("[SONDA] sem acesso à internet de controle; rodada ignorada e estado preservado");

    const normal = await rodar({
      configPath,
      statePath,
      manutencoesDir,
      semTelegram: false,
      controle: async () => true,
      checar,
      enviarMsg,
      log: () => {},
    });

    expect(checar).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(statePath)).toBe(true);
    expect(normal.resultados["pdv-api"]?.classe).toBe("ok");
  });
});

describe("verificarControle", () => {
  it("retorna true em 2xx na primeira tentativa", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    await expect(verificarControle("https://www.gstatic.com/generate_204", fetchMock, 1)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retorna false quando recebe HTTP 500 duas vezes", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async () => new Response(null, { status: 500 }))
      .mockImplementationOnce(async () => new Response(null, { status: 500 }));

    await expect(verificarControle("https://www.gstatic.com/generate_204", fetchMock, 1)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("faz uma retentativa após erro na 1ª chamada e retorna true com 204 na 2ª", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockImplementationOnce(async () => new Response(null, { status: 204 }));

    await expect(verificarControle("https://www.gstatic.com/generate_204", fetchMock, 1)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
