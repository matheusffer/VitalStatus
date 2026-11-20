import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { estadoVazio, listaComponentes } from "../scripts/lib/engine";
import { derivarEstadoExibicao } from "../scripts/lib/estado-exibicao";
import {
  escaparHtml,
  escaparXml,
  markdownSimples,
  renderAtom,
  renderPaginaHistorico,
  renderPaginaPrincipal,
  renderStatusJson,
} from "../scripts/lib/render";
import { diaBrasilia } from "../scripts/lib/tempo";
import type { Config, Estado } from "../scripts/lib/types";

const configPath = fileURLToPath(new URL("../status.config.json", import.meta.url));
const config = JSON.parse(readFileSync(configPath, "utf8")) as Config;

function verificaTagsAtomBalanceadas(xml: string): boolean {
  const tokens = xml.match(/<\/?[A-Za-z_][\w:-]*(?:\s[^>]*)?\/?>/g) ?? [];
  const pilha: string[] = [];
  for (const tag of tokens) {
    if (tag.startsWith("<?") || tag.startsWith("<!") || tag.endsWith("/>")) continue;
    if (tag.startsWith("</")) {
      const nome = tag.slice(2, -1).trim();
      const topo = pilha.pop();
      if (topo !== nome) return false;
    } else {
      const match = /^<([A-Za-z_][\w:-]*)/.exec(tag);
      if (!match?.[1]) return false;
      pilha.push(match[1]);
    }
  }
  return pilha.length === 0;
}

describe("escaparHtml e escaparXml", () => {
  it("escapa caracteres maliciosos em HTML e XML", () => {
    const payload = `<script>alert("xss" & '1')</script>`;
    expect(escaparHtml(payload)).toBe(
      "&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;1&#39;)&lt;/script&gt;",
    );
    expect(escaparXml(payload)).toBe(
      "&lt;script&gt;alert(&quot;xss&quot; &amp; &apos;1&apos;)&lt;/script&gt;",
    );
  });
});

describe("markdownSimples", () => {
  it("renderiza parágrafos, negrito, listas e links http/https, bloqueando protocolos perigosos", () => {
    const md = [
      "Primeiro **aviso** importante.",
      "",
      "- Item com [link seguro](https://vitalerp.tech)",
      "- Link http [legado](http://vitalerp.tech/status)",
      "- Tentativa [xss](javascript:alert(1))",
      "- Tentativa maiúscula [xss2](JavaScript:alert(1))",
      "- Tentativa data [xss3](data:text/html,<script>alert(1)</script>)",
      "- HTML bruto <img src=x onerror=alert(1)>",
    ].join("\n");

    const html = markdownSimples(md);
    expect(html).toContain("<p>Primeiro <strong>aviso</strong> importante.</p>");
    expect(html).toContain('href="https://vitalerp.tech"');
    expect(html).toContain('href="http://vitalerp.tech/status"');
    expect(html).not.toContain("href=\"javascript:");
    expect(html).not.toContain("href=\"JavaScript:");
    expect(html).not.toContain("href=\"data:");
    expect(html).toContain("[xss](javascript:alert(1))");
    expect(html).toContain("[xss2](JavaScript:alert(1))");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("<ul><li>");
  });
});

describe("renderização de páginas, status.json e feed Atom", () => {
  const agora = new Date("2026-11-19T18:00:00Z");
  const hoje = diaBrasilia(agora);

  function criarEstadoBase(): Estado {
    const e = estadoVazio();
    e.atualizadoEm = new Date(agora.getTime() - 3 * 60000).toISOString();
    for (const { comp } of listaComponentes(config)) {
      e.componentes[comp.id] = {
        confirmado: "ok",
        contagem: 0,
        desde: e.atualizadoEm,
        ultima: {
          em: e.atualizadoEm,
          classe: "ok",
          ms: 95,
          http: 200,
          erro: "ECONNREFUSED 10.0.0.42:5432 interno",
        },
        recentes: [
          {
            em: e.atualizadoEm,
            classe: "ok",
            ms: 95,
            http: 200,
            erro: "ECONNREFUSED 10.0.0.42:5432 interno",
          },
        ],
        diario: { [hoje]: { total: 100, degradado: 0, fora: 0, manutencao: 0 } },
      };
    }
    return e;
  }

  it("renderiza página principal com os 5 produtos, todos os componentes e estado geral ok sem vazar erros ou URLs internas", () => {
    const estado = criarEstadoBase();
    const exibicao = derivarEstadoExibicao({
      estado,
      config,
      manutencoes: [],
      incidentesManuais: [],
      emManutencao: new Set(),
      impactoManual: new Map(),
      agora,
    });

    const html = renderPaginaPrincipal(exibicao, config);
    expect(html).toContain("Todos os sistemas operacionais");
    for (const g of config.grupos) {
      expect(html).toContain(g.nome);
      for (const c of g.componentes) {
        expect(html).toContain(c.nome);
      }
    }
    expect(html).not.toContain("ECONNREFUSED 10.0.0.42:5432");
    expect(html).not.toContain("/api/health");
  });

  it("exibe corretamente os estados gerais degradado, fora e manutenção", () => {
    // Degradado
    const estDeg = criarEstadoBase();
    if (estDeg.componentes["erp-api"]) estDeg.componentes["erp-api"].confirmado = "degradado";
    const htmlDeg = renderPaginaPrincipal(
      derivarEstadoExibicao({
        estado: estDeg,
        config,
        manutencoes: [],
        incidentesManuais: [],
        emManutencao: new Set(),
        impactoManual: new Map(),
        agora,
      }),
      config,
    );
    expect(htmlDeg).toContain("Degradado");
    expect(htmlDeg).toContain("Instabilidade em Vital ERP");

    // Fora do ar (todos componentes fora)
    const estFora = criarEstadoBase();
    for (const key of Object.keys(estFora.componentes)) {
      const comp = estFora.componentes[key];
      if (comp) comp.confirmado = "fora";
    }
    const htmlFora = renderPaginaPrincipal(
      derivarEstadoExibicao({
        estado: estFora,
        config,
        manutencoes: [],
        incidentesManuais: [],
        emManutencao: new Set(),
        impactoManual: new Map(),
        agora,
      }),
      config,
    );
    expect(htmlFora).toContain("Fora do ar");
    expect(htmlFora).toContain("Instabilidade em 5 produtos");

    // Manutenção
    const estManut = criarEstadoBase();
    const htmlManut = renderPaginaPrincipal(
      derivarEstadoExibicao({
        estado: estManut,
        config,
        manutencoes: [],
        incidentesManuais: [],
        emManutencao: new Set(["erp-banco"]),
        impactoManual: new Map(),
        agora,
      }),
      config,
    );
    expect(htmlManut).toContain("Em manutenção");
    expect(htmlManut).toContain("Manutenção programada em andamento");
  });

  it("gera status.json válido conforme schema e sem vazar erros ou URLs internas", () => {
    const estado = criarEstadoBase();
    estado.incidentes.push({
      id: "erp-api-1700000000",
      componente: "erp-api",
      grupo: "erp",
      titulo: "Vital ERP: API com lentidão ou instabilidade",
      gravidade: "degradado",
      inicio: "2026-11-19T17:45:00Z",
      atualizacoes: [
        {
          em: "2026-11-19T17:45:00Z",
          classe: "degradado",
          texto: "Detectamos lentidão ou instabilidade. Estamos verificando.",
        },
      ],
      avisos: { aberto: true, resolvido: false },
    });
    if (estado.componentes["erp-api"]) estado.componentes["erp-api"].confirmado = "degradado";

    const exibicao = derivarEstadoExibicao({
      estado,
      config,
      manutencoes: [],
      incidentesManuais: [],
      emManutencao: new Set(),
      impactoManual: new Map(),
      agora,
    });

    const jsonStr = renderStatusJson(exibicao);
    expect(jsonStr).not.toContain("ECONNREFUSED");
    expect(jsonStr).not.toContain("/api/health");

    const parsed = JSON.parse(jsonStr) as {
      versao: number;
      atualizado_em: string;
      estado: string;
      produtos: Array<{
        id: string;
        nome: string;
        estado: string;
        componentes: Array<{ id: string; nome: string; estado: string; uptime_90d: number | null }>;
      }>;
      incidentes_ativos: Array<{
        id: string;
        titulo: string;
        gravidade: string;
        inicio: string;
        produto: string;
        componente: string;
      }>;
    };

    expect(parsed.versao).toBe(1);
    expect(parsed.atualizado_em).toBe(estado.atualizadoEm);
    expect(parsed.estado).toBe("degradado");
    expect(parsed.produtos).toHaveLength(5);
    expect(parsed.incidentes_ativos).toHaveLength(1);
    expect(parsed.incidentes_ativos[0]?.produto).toBe("Vital ERP");
    expect(parsed.incidentes_ativos[0]?.componente).toBe("API");
  });

  it("gera feed Atom 1.0 válido com HTML escapado, tags balanceadas e sem vazamentos", () => {
    const estado = criarEstadoBase();
    estado.incidentes.push({
      id: "erp-api-1700000100",
      componente: "erp-api",
      grupo: "erp",
      titulo: "Vital ERP: API <teste & validação>",
      gravidade: "fora",
      inicio: "2026-11-18T12:00:00Z",
      fim: "2026-11-18T12:30:00Z",
      atualizacoes: [
        {
          em: "2026-11-18T12:00:00Z",
          classe: "fora",
          texto: "Detectamos que o serviço não está respondendo. Estamos verificando.",
        },
        {
          em: "2026-11-18T12:30:00Z",
          classe: "ok",
          texto: "Normalizado. Tudo voltou a funcionar.",
        },
      ],
      avisos: { aberto: true, resolvido: true },
    });

    const exibicao = derivarEstadoExibicao({
      estado,
      config,
      manutencoes: [],
      incidentesManuais: [],
      emManutencao: new Set(),
      impactoManual: new Map(),
      agora,
    });

    const atom = renderAtom(exibicao, config);
    expect(atom).toContain('xmlns="http://www.w3.org/2005/Atom"');
    expect(atom).toContain("<id>tag:status.vitalerp.tech,2026:erp-api-1700000100</id>");
    expect(atom).toContain("Vital ERP: API &lt;teste &amp; validação&gt;");
    expect(atom).toContain('<content type="html">&lt;p&gt;');
    expect(atom).not.toContain("ECONNREFUSED");
    expect(atom).not.toContain("/api/health");
    expect(verificaTagsAtomBalanceadas(atom)).toBe(true);
  });

  it("renderiza histórico de 90 dias ordenado dos mais antigos primeiro agrupados por mês", () => {
    const estado = criarEstadoBase();
    estado.incidentes.push(
      {
        id: "inc-nov",
        componente: "pdv-api",
        grupo: "pdv",
        titulo: "Incidente de Novembro",
        gravidade: "degradado",
        inicio: "2026-11-10T15:00:00Z",
        fim: "2026-11-10T15:20:00Z",
        atualizacoes: [{ em: "2026-11-10T15:00:00Z", classe: "degradado", texto: "Lento." }],
        avisos: { aberto: true, resolvido: true },
      },
      {
        id: "inc-out",
        componente: "erp-api",
        grupo: "erp",
        titulo: "Incidente de Outubro",
        gravidade: "fora",
        inicio: "2026-10-05T15:00:00Z",
        fim: "2026-10-05T15:20:00Z",
        atualizacoes: [{ em: "2026-10-05T15:00:00Z", classe: "fora", texto: "Fora." }],
        avisos: { aberto: true, resolvido: true },
      },
    );

    const exibicao = derivarEstadoExibicao({
      estado,
      config,
      manutencoes: [],
      incidentesManuais: [],
      emManutencao: new Set(),
      impactoManual: new Map(),
      agora,
    });

    const hist = renderPaginaHistorico(exibicao, config);
    const posOut = hist.indexOf("Incidente de Outubro");
    const posNov = hist.indexOf("Incidente de Novembro");
    expect(posOut).toBeGreaterThan(-1);
    expect(posNov).toBeGreaterThan(posOut);
    expect(hist).toContain("Outubro de 2026");
    expect(hist).toContain("Novembro de 2026");
  });
});
