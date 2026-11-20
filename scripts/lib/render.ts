import type {
  EstadoExibicao,
  IncidenteExibicao,
  ManutencaoExibicao,
  TomVisual,
} from "./estado-exibicao";
import { formatarPercentualPtBr } from "./estado-exibicao";
import { dataBr, dataHora, diaBrasilia, duracao } from "./tempo";
import type { Config, IncidenteManual } from "./types";

const CSP_CONTENT =
  "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";

export function escaparHtml(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function escaparXml(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatarNegrito(texto: string): string {
  let out = "";
  let pos = 0;
  const re = /\*\*([^*\n]+)\*\*/g;
  for (const m of texto.matchAll(re)) {
    const idx = m.index ?? 0;
    out += escaparHtml(texto.slice(pos, idx));
    out += `<strong>${escaparHtml(m[1] ?? "")}</strong>`;
    pos = idx + m[0].length;
  }
  out += escaparHtml(texto.slice(pos));
  return out;
}

function ehUrlSegura(url: string): boolean {
  if (!url || /[\s<>]/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatarInline(texto: string): string {
  let out = "";
  let pos = 0;
  const reLink = /\[([^\]]+)\]\(([^)]+)\)/g;

  for (const m of texto.matchAll(reLink)) {
    const idx = m.index ?? 0;
    out += formatarNegrito(texto.slice(pos, idx));
    const rotulo = m[1] ?? "";
    const url = (m[2] ?? "").trim();
    if (ehUrlSegura(url)) {
      out += `<a href="${escaparHtml(url)}" rel="noopener noreferrer">${formatarNegrito(rotulo)}</a>`;
    } else {
      // Protocolo não permitido vira texto literal escapado.
      out += formatarNegrito(m[0]);
    }
    pos = idx + m[0].length;
  }
  out += formatarNegrito(texto.slice(pos));
  return out;
}

/**
 * Converte markdown mínimo (parágrafos, **negrito**, listas `- ` e links http/https)
 * em HTML seguro. Qualquer HTML bruto ou protocolo diferente de http/https vira texto.
 */
export function markdownSimples(texto: string): string {
  const linhas = texto.replaceAll("\r\n", "\n").split("\n");
  const blocos: string[] = [];
  let paragrafo: string[] = [];
  let lista: string[] = [];

  const fecharParagrafo = () => {
    if (paragrafo.length > 0) {
      blocos.push(`<p>${formatarInline(paragrafo.join(" "))}</p>`);
      paragrafo = [];
    }
  };
  const fecharLista = () => {
    if (lista.length > 0) {
      blocos.push(`<ul>${lista.map((item) => `<li>${formatarInline(item)}</li>`).join("")}</ul>`);
      lista = [];
    }
  };

  for (const linhaRaw of linhas) {
    const linha = linhaRaw.trim();
    if (linha === "") {
      fecharParagrafo();
      fecharLista();
      continue;
    }
    if (linha.startsWith("- ")) {
      fecharParagrafo();
      lista.push(linha.slice(2).trim());
      continue;
    }
    fecharLista();
    paragrafo.push(linha);
  }
  fecharParagrafo();
  fecharLista();
  return blocos.join("\n");
}

function simboloFormaSvg(tom: TomVisual, tamanho = 10): string {
  const s = String(tamanho);
  switch (tom) {
    case "pos":
      return `<svg class="status-shape" width="${s}" height="${s}" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="5" fill="currentColor"/></svg>`;
    case "alert":
      return `<svg class="status-shape" width="${s}" height="${s}" viewBox="0 0 12 12" aria-hidden="true"><polygon points="6,1 11,11 1,11" fill="currentColor"/></svg>`;
    case "neg":
      return `<svg class="status-shape" width="${s}" height="${s}" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="currentColor"/></svg>`;
    case "info":
      return `<svg class="status-shape" width="${s}" height="${s}" viewBox="0 0 12 12" aria-hidden="true"><polygon points="6,1 11,6 6,11 1,6" fill="currentColor"/></svg>`;
    case "neutral":
      return `<svg class="status-shape" width="${s}" height="${s}" viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
  }
}

function renderBadge(rotulo: string, tom: TomVisual): string {
  return `<span class="badge ${tom}">${simboloFormaSvg(tom, 10)}<span>${escaparHtml(rotulo)}</span></span>`;
}

function rotuloEstadoManual(estado: IncidenteManual["estado"]): string {
  switch (estado) {
    case "investigando":
      return "Investigando";
    case "identificado":
      return "Identificado";
    case "monitorando":
      return "Monitorando";
    case "resolvido":
      return "Resolvido";
  }
}

function rotuloClasseAtualizacao(c: "ok" | "degradado" | "fora"): string {
  switch (c) {
    case "ok":
      return "Resolvido";
    case "degradado":
      return "Instabilidade";
    case "fora":
      return "Fora do ar";
  }
}

function logoVitalSvg(): string {
  return (
    `<svg class="brand-logo" width="32" height="32" viewBox="0 0 96 96" aria-hidden="true">` +
    `<rect class="brand-square" width="96" height="96" rx="22"/>` +
    `<polyline points="21,49 33,49 45,69 56,27 66,43 77,43" fill="none" stroke="#00A79D" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}

function renderHeader(config: Config, prefixo: string): string {
  return `<header class="site-header">
  <div class="site-header-inner">
    <a class="brand" href="${prefixo}index.html">
      ${logoVitalSvg()}
      <span class="brand-name">Vital</span>
      <span class="brand-sep" aria-hidden="true">/</span>
      <span class="brand-sub">Status</span>
    </a>
    <div class="header-actions">
      <a class="btn ghost header-site-link" href="${escaparHtml(config.site.contato)}">Voltar ao site</a>
      <button type="button" class="btn theme-toggle" id="theme-toggle" aria-pressed="false">Tema escuro</button>
    </div>
  </div>
</header>`;
}

function renderFooter(config: Config, prefixo: string): string {
  return `<footer class="site-footer">
  <div class="site-footer-inner">
    <p class="footer-note">Verificado a cada ${config.site.intervaloMin} minutos a partir de servidores independentes da Vital.</p>
    <nav class="footer-links" aria-label="Links úteis">
      <a href="${escaparHtml(config.site.contato)}">Site</a>
      <a href="${escaparHtml(config.site.ajuda)}">Central de Ajuda</a>
      <a href="${prefixo}status.json">status.json</a>
      <a href="${prefixo}incidentes.atom">Feed (Atom)</a>
    </nav>
  </div>
</footer>`;
}

function renderHead(
  titulo: string,
  descricao: string,
  urlCanonica: string,
  prefixo: string,
): string {
  // A prévia do link (WhatsApp, Slack...) exige URL absoluta; a imagem vive na raiz do site.
  const urlImagem = new URL("/og-image.png", urlCanonica).href;
  return `<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escaparHtml(titulo)}</title>
  <meta name="description" content="${escaparHtml(descricao)}">
  <meta name="robots" content="index,follow">
  <meta http-equiv="Content-Security-Policy" content="${CSP_CONTENT}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escaparHtml(titulo)}">
  <meta property="og:description" content="${escaparHtml(descricao)}">
  <meta property="og:url" content="${escaparHtml(urlCanonica)}">
  <meta property="og:site_name" content="Status Vital">
  <meta property="og:locale" content="pt_BR">
  <meta property="og:image" content="${escaparHtml(urlImagem)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Status dos sistemas Vital: Vital ERP, PDV, Talk, Via Supply e Vendas Ativa">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escaparHtml(titulo)}">
  <meta name="twitter:description" content="${escaparHtml(descricao)}">
  <meta name="twitter:image" content="${escaparHtml(urlImagem)}">
  <link rel="icon" href="${prefixo}favicon.svg" type="image/svg+xml">
  <link rel="alternate" type="application/atom+xml" title="Feed de incidentes — Status Vital" href="${prefixo}incidentes.atom">
  <script src="${prefixo}theme-init.js"></script>
  <link rel="stylesheet" href="${prefixo}styles.css">
</head>`;
}

function renderCardIncidente(inc: IncidenteExibicao, mostrarDuracao: boolean): string {
  const metaPartes: string[] = [
    `${escaparHtml(inc.produto)} — ${escaparHtml(inc.componente)}`,
    `Início: <time datetime="${escaparHtml(inc.inicio)}">${escaparHtml(dataHora(inc.inicio))}</time>`,
  ];
  if (mostrarDuracao && inc.fim) {
    metaPartes.push(`Duração: ${escaparHtml(duracao(inc.inicio, inc.fim))}`);
  } else if (!inc.fim && inc.estadoManual !== "resolvido") {
    metaPartes.push("Em andamento");
  }

  let corpoHtml = "";
  if (inc.atualizacoes.length > 0) {
    const itens = inc.atualizacoes
      .map(
        (a) => `<li class="timeline-item">
  <div class="timeline-head">
    <span class="timeline-state">${escaparHtml(rotuloClasseAtualizacao(a.classe))}</span>
    <time class="num muted" datetime="${escaparHtml(a.em)}">${escaparHtml(dataHora(a.em))}</time>
  </div>
  <p class="timeline-text">${escaparHtml(a.texto)}</p>
</li>`,
      )
      .join("\n");
    corpoHtml = `<ul class="timeline">${itens}</ul>`;
  } else if (inc.corpoMarkdown) {
    const estadoTag = inc.estadoManual
      ? `<p class="incidente-estado-manual">Situação: <strong>${escaparHtml(rotuloEstadoManual(inc.estadoManual))}</strong></p>`
      : "";
    corpoHtml = `${estadoTag}<div class="markdown-body">${markdownSimples(inc.corpoMarkdown)}</div>`;
  }

  return `<article class="card incidente-card incidente--${inc.tom}">
  <div class="card-head incidente-head">
    <div class="incidente-titulo-wrap">
      <h3 class="incidente-titulo">${escaparHtml(inc.titulo)}</h3>
      <p class="incidente-meta">${metaPartes.join(' <span aria-hidden="true">·</span> ')}</p>
    </div>
    ${renderBadge(inc.rotuloGravidade, inc.tom)}
  </div>
  <div class="card-pad">${corpoHtml}</div>
</article>`;
}

function renderCardManutencao(m: ManutencaoExibicao): string {
  const rotulo = m.emAndamento ? "Em andamento" : "Programada";
  const comps = m.componentes.length > 0 ? m.componentes.map(escaparHtml).join(", ") : "Geral";
  return `<article class="card manutencao-card">
  <div class="card-head incidente-head">
    <div class="incidente-titulo-wrap">
      <h3 class="incidente-titulo">${escaparHtml(m.titulo)}</h3>
      <p class="incidente-meta">Janela: <time datetime="${escaparHtml(m.inicio)}">${escaparHtml(dataHora(m.inicio))}</time> até <time datetime="${escaparHtml(m.fim)}">${escaparHtml(dataHora(m.fim))}</time> <span aria-hidden="true">·</span> ${comps}</p>
    </div>
    ${renderBadge(rotulo, "info")}
  </div>
  <div class="card-pad markdown-body">${markdownSimples(m.corpoMarkdown)}</div>
</article>`;
}

export function renderPaginaPrincipal(exibicao: EstadoExibicao, config: Config): string {
  const secaoAtivos =
    exibicao.incidentesAtivos.length > 0
      ? `<section class="section" aria-labelledby="titulo-incidentes-ativos">
  <h2 class="section-title" id="titulo-incidentes-ativos">Incidentes ativos</h2>
  <div class="stack">${exibicao.incidentesAtivos.map((i) => renderCardIncidente(i, false)).join("\n")}</div>
</section>`
      : "";

  const secaoManutencoes =
    exibicao.manutencoesProgramadas.length > 0
      ? `<section class="section" aria-labelledby="titulo-manutencoes">
  <h2 class="section-title" id="titulo-manutencoes">Manutenções programadas</h2>
  <div class="stack">${exibicao.manutencoesProgramadas.map(renderCardManutencao).join("\n")}</div>
</section>`
      : "";

  const cardsProdutos = exibicao.produtos
    .map((produto) => {
      const linhas = produto.componentes
        .map((comp) => {
          const barras = comp.barra90d
            .map(
              (d) =>
                `<span class="bar-day bar-day--${d.estado}" tabindex="0" title="${escaparHtml(d.label)}" aria-label="${escaparHtml(d.label)}" data-tip="${escaparHtml(d.label)}"></span>`,
            )
            .join("");

          const uptimeTexto =
            comp.uptime90d !== null
              ? `${formatarPercentualPtBr(comp.uptime90d)} % de disponibilidade`
              : "Sem dados ainda";

          return `<li class="comp-row">
  <div class="comp-top">
    <div class="comp-info">
      <span class="comp-nome">${escaparHtml(comp.nome)}</span>
      ${comp.descricao ? `<span class="comp-desc">${escaparHtml(comp.descricao)}</span>` : ""}
    </div>
    ${renderBadge(comp.rotuloEstado, comp.tom)}
  </div>
  <div class="uptime-wrap">
    <div class="uptime-bar" role="img" aria-label="${escaparHtml(comp.resumoBarraAria)}">${barras}</div>
    <div class="uptime-legend">
      <span>90 dias atrás</span>
      <span class="uptime-pct num">${escaparHtml(uptimeTexto)}</span>
      <span>Hoje</span>
    </div>
  </div>
</li>`;
        })
        .join("\n");

      const linkHtml = produto.link
        ? `<a class="produto-link" href="${escaparHtml(produto.link)}">Acessar</a>`
        : "";

      // Logo decorativo (o nome do produto já está no <h3>): alt vazio e tamanho fixo.
      const logoHtml = produto.logo
        ? `<img class="produto-logo" src="${escaparHtml(produto.logo)}" alt="" width="22" height="22" loading="lazy" decoding="async">`
        : "";

      return `<article class="card produto-card">
  <div class="card-head produto-head">
    <div class="produto-head-info">
      <div class="produto-title-row">
        ${logoHtml}
        <h3>${escaparHtml(produto.nome)}</h3>
        ${linkHtml}
      </div>
      ${produto.descricao ? `<p class="sub">${escaparHtml(produto.descricao)}</p>` : ""}
    </div>
    ${renderBadge(produto.rotuloEstado, produto.tom)}
  </div>
  <ul class="comp-list">${linhas}</ul>
</article>`;
    })
    .join("\n");

  const porDia = new Map<string, IncidenteExibicao[]>();
  for (const inc of exibicao.incidentesRecentes30d) {
    const dia = diaBrasilia(new Date(inc.inicio));
    const lista = porDia.get(dia) ?? [];
    lista.push(inc);
    porDia.set(dia, lista);
  }

  const conteudoRecentes =
    exibicao.incidentesRecentes30d.length === 0
      ? `<div class="card card-pad empty-box"><p class="empty-note">Nenhum incidente nos últimos 30 dias.</p></div>`
      : Array.from(porDia.entries())
          .map(
            ([dia, lista]) => `<div class="day-group">
  <h3 class="day-heading">${escaparHtml(dataBr(dia))}</h3>
  <div class="stack">${lista.map((i) => renderCardIncidente(i, true)).join("\n")}</div>
</div>`,
          )
          .join("\n");

  const metaAtualizacao = exibicao.semDados
    ? `<p class="banner-meta">Aguardando a primeira verificação automática.</p>`
    : `<p class="banner-meta">Atualizado <span id="tempo-relativo">em ${escaparHtml(dataHora(exibicao.atualizadoEm))}</span> (<time id="ultima-atualizacao" class="num" datetime="${escaparHtml(exibicao.atualizadoEm)}">${escaparHtml(dataHora(exibicao.atualizadoEm))}</time>)</p>`;

  const mostrarAtraso = exibicao.atrasado && !exibicao.semDados;
  const avisoAtraso = `<p class="banner-atraso" id="aviso-atraso" data-atualizado-em="${escaparHtml(exibicao.atualizadoEm)}"${mostrarAtraso ? "" : " hidden"}>As verificações estão atrasadas; o estado abaixo pode estar desatualizado.</p>`;

  return `<!doctype html>
<html lang="pt-BR">
${renderHead(
  "Status Vital — Vital ERP, PDV, Talk, Via Supply e Vendas Ativa",
  "Acompanhe em tempo real a disponibilidade e o histórico de incidentes dos produtos Vital.",
  config.site.url,
  "",
)}
<body>
  <a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
  ${renderHeader(config, "")}
  <main id="conteudo" class="page">
    <div class="page-head-simple">
      <h1 class="page-title">Status Vital</h1>
    </div>

    <section class="section" aria-labelledby="titulo-estado-geral">
      <h2 id="titulo-estado-geral" class="sr-only">Estado geral dos serviços</h2>
      <div class="card banner-status banner--${exibicao.tomGeral}" id="banner-estado" data-sem-dados="${exibicao.semDados ? "true" : "false"}">
        <div class="banner-main">
          <div class="banner-badge-wrap" id="banner-badge-wrap">
            ${simboloFormaSvg(exibicao.tomGeral, 16)}
            <span class="banner-word" id="banner-word">${escaparHtml(exibicao.rotuloGeral)}</span>
          </div>
          <p class="banner-phrase" id="banner-phrase">${escaparHtml(exibicao.fraseGeral)}</p>
          ${metaAtualizacao}
          ${avisoAtraso}
        </div>
      </div>
    </section>

    ${secaoAtivos}
    ${secaoManutencoes}

    <section class="section" aria-labelledby="titulo-produtos">
      <h2 class="section-title" id="titulo-produtos">Produtos e serviços</h2>
      <div class="stack">${cardsProdutos}</div>
    </section>

    <section class="section" aria-labelledby="titulo-incidentes-recentes">
      <div class="section-head-row">
        <h2 class="section-title" id="titulo-incidentes-recentes">Incidentes recentes (30 dias)</h2>
        <a class="section-link" href="historico/index.html">Ver histórico completo</a>
      </div>
      ${conteudoRecentes}
    </section>
  </main>
  ${renderFooter(config, "")}
  <div id="tooltip" class="tooltip" role="tooltip" hidden></div>
  <script src="app.js" defer></script>
</body>
</html>
`;
}

const fmtMesAno = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  month: "long",
  year: "numeric",
});

function chaveMesBrasilia(iso: string): string {
  const dia = diaBrasilia(new Date(iso));
  return dia.slice(0, 7);
}

function rotuloMesAno(chaveMes: string): string {
  const [ano, mes] = chaveMes.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(ano, mes - 1, 15, 12, 0, 0));
  const texto = fmtMesAno.format(d);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function renderPaginaHistorico(exibicao: EstadoExibicao, config: Config): string {
  // incidentes90d já chega ordenado dos mais antigos para os mais recentes.
  const porMes = new Map<string, IncidenteExibicao[]>();
  for (const inc of exibicao.incidentes90d) {
    const mes = chaveMesBrasilia(inc.inicio);
    const lista = porMes.get(mes) ?? [];
    lista.push(inc);
    porMes.set(mes, lista);
  }

  const mesesOrdenados = Array.from(porMes.entries()).sort(([a], [b]) => a.localeCompare(b));

  const conteudo =
    mesesOrdenados.length === 0
      ? `<div class="card card-pad empty-box"><p class="empty-note">Nenhum incidente registrado nos últimos 90 dias.</p></div>`
      : mesesOrdenados
          .map(
            ([mes, lista]) => `<section class="section" aria-labelledby="mes-${escaparHtml(mes)}">
  <h2 class="section-title" id="mes-${escaparHtml(mes)}">${escaparHtml(rotuloMesAno(mes))}</h2>
  <div class="stack">${lista.map((i) => renderCardIncidente(i, true)).join("\n")}</div>
</section>`,
          )
          .join("\n");

  return `<!doctype html>
<html lang="pt-BR">
${renderHead(
  "Histórico de incidentes — Status Vital",
  "Histórico completo dos incidentes dos últimos 90 dias nos produtos Vital.",
  `${config.site.url}/historico/`,
  "../",
)}
<body>
  <a class="skip-link" href="#conteudo">Pular para o conteúdo</a>
  ${renderHeader(config, "../")}
  <main id="conteudo" class="page">
    <div class="page-head-simple page-head-historico">
      <div>
        <h1 class="page-title">Histórico de incidentes</h1>
        <p class="page-sub">Últimos 90 dias, dos mais antigos aos mais recentes.</p>
      </div>
      <a class="btn" href="../index.html">Voltar ao status atual</a>
    </div>
    ${conteudo}
  </main>
  ${renderFooter(config, "../")}
  <script src="../app.js" defer></script>
</body>
</html>
`;
}

export function renderStatusJson(exibicao: EstadoExibicao): string {
  const payload = {
    versao: 1,
    atualizado_em: exibicao.atualizadoEm,
    estado: exibicao.estadoGeral,
    produtos: exibicao.produtos.map((p) => ({
      id: p.id,
      nome: p.nome,
      estado: p.estado,
      componentes: p.componentes.map((c) => ({
        id: c.id,
        nome: c.nome,
        estado: c.estadoJson,
        uptime_90d: c.uptime90d,
      })),
    })),
    incidentes_ativos: exibicao.incidentesAtivos.map((i) => ({
      id: i.id,
      titulo: i.titulo,
      gravidade: i.gravidade,
      inicio: i.inicio,
      produto: i.produto,
      componente: i.componente,
    })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function conteudoHtmlIncidenteAtom(inc: IncidenteExibicao): string {
  const resumo = `<p><strong>${escaparHtml(inc.produto)} — ${escaparHtml(inc.componente)}</strong> (${escaparHtml(inc.rotuloGravidade)})</p>`;
  if (inc.atualizacoes.length > 0) {
    const itens = inc.atualizacoes
      .map(
        (a) =>
          `<li><strong>${escaparHtml(dataHora(a.em))}</strong> — ${escaparHtml(rotuloClasseAtualizacao(a.classe))}: ${escaparHtml(a.texto)}</li>`,
      )
      .join("");
    return `${resumo}<ul>${itens}</ul>`;
  }
  if (inc.corpoMarkdown) {
    return `${resumo}${markdownSimples(inc.corpoMarkdown)}`;
  }
  return resumo;
}

export function renderAtom(exibicao: EstadoExibicao, config: Config): string {
  const base = config.site.url.replace(/\/+$/, "");
  const entries = [...exibicao.incidentes90d]
    .sort((a, b) => Date.parse(b.ultimaAtualizacaoEm) - Date.parse(a.ultimaAtualizacaoEm))
    .map((inc) => {
      const html = conteudoHtmlIncidenteAtom(inc);
      return `  <entry>
    <id>tag:status.vitalerp.tech,2026:${escaparXml(inc.id)}</id>
    <title>${escaparXml(inc.titulo)}</title>
    <link href="${escaparXml(base)}/" rel="alternate" type="text/html"/>
    <published>${escaparXml(inc.inicio)}</published>
    <updated>${escaparXml(inc.ultimaAtualizacaoEm)}</updated>
    <content type="html">${escaparXml(html)}</content>
  </entry>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="pt-BR">
  <id>${escaparXml(base)}/incidentes.atom</id>
  <title>${escaparXml(config.site.nome)}</title>
  <link href="${escaparXml(base)}/incidentes.atom" rel="self" type="application/atom+xml"/>
  <link href="${escaparXml(base)}/" rel="alternate" type="text/html"/>
  <updated>${escaparXml(exibicao.atualizadoEm)}</updated>
  <author>
    <name>Vital</name>
  </author>
${entries ? `${entries}\n` : ""}</feed>
`;
}
