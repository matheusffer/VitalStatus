(function () {
  try {
    var CHAVE_TEMA = "vital-status-tema";
    var LIMITE_ATRASO_MS = 20 * 60 * 1000;
    var root = document.documentElement;
    var btnTema = document.getElementById("theme-toggle");

    function temaAtual() {
      var attr = root.getAttribute("data-theme");
      if (attr === "dark" || attr === "light") return attr;
      try {
        if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
          return "dark";
        }
      } catch (_) {}
      return "light";
    }

    function atualizarBotaoTema(tema) {
      if (!btnTema) return;
      var escuro = tema === "dark";
      btnTema.setAttribute("aria-pressed", escuro ? "true" : "false");
      btnTema.textContent = escuro ? "Tema claro" : "Tema escuro";
    }

    atualizarBotaoTema(temaAtual());

    if (btnTema) {
      btnTema.addEventListener("click", function () {
        var proximo = temaAtual() === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", proximo);
        atualizarBotaoTema(proximo);
        try {
          localStorage.setItem(CHAVE_TEMA, proximo);
        } catch (_) {}
      });
    }

    function formatarRelativo(iso) {
      var ms = Date.parse(iso);
      if (!isFinite(ms)) return "";
      var diffMin = Math.max(0, Math.floor((Date.now() - ms) / 60000));
      if (diffMin < 1) return "há menos de 1 min";
      if (diffMin < 60) return "há " + diffMin + " min";
      var h = Math.floor(diffMin / 60);
      var r = diffMin % 60;
      if (h >= 24) {
        var dias = Math.floor(h / 24);
        return dias === 1 ? "há 1 dia" : "há " + dias + " dias";
      }
      return r ? "há " + h + " h " + String(r).padStart(2, "0") + " min" : "há " + h + " h";
    }

    function atualizarTempoEAtraso(iso) {
      var elRel = document.getElementById("tempo-relativo");
      var elTime = document.getElementById("ultima-atualizacao");
      var elAtraso = document.getElementById("aviso-atraso");
      var banner = document.getElementById("banner-estado");
      var semDados = banner && banner.getAttribute("data-sem-dados") === "true";

      if (elTime && iso) {
        elTime.setAttribute("datetime", iso);
      }
      if (elRel && iso) {
        var texto = formatarRelativo(iso);
        if (texto) elRel.textContent = texto;
      }
      if (elAtraso && iso) {
        elAtraso.setAttribute("data-atualizado-em", iso);
        if (semDados) {
          elAtraso.setAttribute("hidden", "");
        } else {
          var atrasado = Date.now() - Date.parse(iso) > LIMITE_ATRASO_MS;
          if (atrasado) {
            elAtraso.removeAttribute("hidden");
          } else {
            elAtraso.setAttribute("hidden", "");
          }
        }
      }
    }

    var elAtrasoInicial = document.getElementById("aviso-atraso");
    var isoInicial = elAtrasoInicial ? elAtrasoInicial.getAttribute("data-atualizado-em") : null;
    if (isoInicial) {
      atualizarTempoEAtraso(isoInicial);
      setInterval(function () {
        var atual = elAtrasoInicial.getAttribute("data-atualizado-em");
        if (atual) atualizarTempoEAtraso(atual);
      }, 30000);
    }

    /* Tooltip acessível para as colunas da barra de 90 dias */
    var tooltip = document.getElementById("tooltip");
    if (tooltip) {
      function mostrarTooltip(alvo) {
        var texto = alvo.getAttribute("data-tip");
        if (!texto) return;
        tooltip.textContent = texto;
        tooltip.removeAttribute("hidden");
        var rect = alvo.getBoundingClientRect();
        var tipRect = tooltip.getBoundingClientRect();
        var left = rect.left + rect.width / 2 - tipRect.width / 2;
        left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left));
        var top = rect.top - tipRect.height - 8;
        if (top < 8) top = rect.bottom + 8;
        tooltip.style.left = Math.round(left) + "px";
        tooltip.style.top = Math.round(top) + "px";
      }

      function esconderTooltip() {
        tooltip.setAttribute("hidden", "");
      }

      document.addEventListener("mouseover", function (ev) {
        var alvo = ev.target && ev.target.closest ? ev.target.closest(".bar-day") : null;
        if (alvo) mostrarTooltip(alvo);
      });
      document.addEventListener("mouseout", function (ev) {
        var alvo = ev.target && ev.target.closest ? ev.target.closest(".bar-day") : null;
        if (alvo) esconderTooltip();
      });
      document.addEventListener("focusin", function (ev) {
        var alvo = ev.target && ev.target.closest ? ev.target.closest(".bar-day") : null;
        if (alvo) mostrarTooltip(alvo);
      });
      document.addEventListener("focusout", function (ev) {
        var alvo = ev.target && ev.target.closest ? ev.target.closest(".bar-day") : null;
        if (alvo) esconderTooltip();
      });
      document.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape") esconderTooltip();
      });
    }

    /* Atualização silenciosa de status.json a cada 60 s na página principal */
    var bannerEstado = document.getElementById("banner-estado");
    if (bannerEstado && typeof fetch === "function") {
      function criarIconeForma(tom) {
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("class", "status-shape");
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
        svg.setAttribute("viewBox", "0 0 12 12");
        svg.setAttribute("aria-hidden", "true");
        var shape;
        if (tom === "pos") {
          shape = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          shape.setAttribute("cx", "6");
          shape.setAttribute("cy", "6");
          shape.setAttribute("r", "5");
          shape.setAttribute("fill", "currentColor");
        } else if (tom === "alert") {
          shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          shape.setAttribute("points", "6,1 11,11 1,11");
          shape.setAttribute("fill", "currentColor");
        } else if (tom === "neg") {
          shape = document.createElementNS("http://www.w3.org/2000/svg", "rect");
          shape.setAttribute("x", "1.5");
          shape.setAttribute("y", "1.5");
          shape.setAttribute("width", "9");
          shape.setAttribute("height", "9");
          shape.setAttribute("rx", "1.5");
          shape.setAttribute("fill", "currentColor");
        } else if (tom === "info") {
          shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
          shape.setAttribute("points", "6,1 11,6 6,11 1,6");
          shape.setAttribute("fill", "currentColor");
        } else {
          shape = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          shape.setAttribute("cx", "6");
          shape.setAttribute("cy", "6");
          shape.setAttribute("r", "4.2");
          shape.setAttribute("fill", "none");
          shape.setAttribute("stroke", "currentColor");
          shape.setAttribute("stroke-width", "1.6");
        }
        svg.appendChild(shape);
        return svg;
      }

      function mapearGeral(dados) {
        var estado = dados.estado;
        var tom = "pos";
        var word = "Operacional";
        var frase = "Todos os sistemas operacionais";

        if (estado === "manutencao") {
          tom = "info";
          word = "Em manutenção";
          frase = "Manutenção programada em andamento";
        } else if (estado === "degradado" || estado === "falha_parcial" || estado === "fora") {
          tom = estado === "fora" ? "neg" : "alert";
          word =
            estado === "fora"
              ? "Fora do ar"
              : estado === "falha_parcial"
                ? "Falha parcial"
                : "Degradado";
          var afetados = Array.isArray(dados.produtos)
            ? dados.produtos.filter(function (p) {
                return p && (p.estado === "fora" || p.estado === "falha_parcial" || p.estado === "degradado");
              })
            : [];
          if (afetados.length === 1) {
            frase = "Instabilidade em " + afetados[0].nome;
          } else if (afetados.length > 1) {
            frase = "Instabilidade em " + afetados.length + " produtos";
          } else {
            frase = "Instabilidade parcial nos serviços";
          }
        }
        return { tom: tom, word: word, frase: frase };
      }

      setInterval(function () {
        try {
          fetch("status.json", { cache: "no-store" })
            .then(function (resp) {
              if (!resp.ok) return null;
              return resp.json();
            })
            .then(function (dados) {
              if (!dados || typeof dados.atualizado_em !== "string") return;
              if (bannerEstado.getAttribute("data-sem-dados") === "true") return;

              var info = mapearGeral(dados);
              bannerEstado.className = "card banner-status banner--" + info.tom;

              var wrap = document.getElementById("banner-badge-wrap");
              var wordEl = document.getElementById("banner-word");
              var phraseEl = document.getElementById("banner-phrase");

              if (wrap && wordEl) {
                var oldSvg = wrap.querySelector("svg");
                if (oldSvg) wrap.replaceChild(criarIconeForma(info.tom), oldSvg);
                wordEl.textContent = info.word;
              }
              if (phraseEl) phraseEl.textContent = info.frase;

              atualizarTempoEAtraso(dados.atualizado_em);
            })
            .catch(function () {});
        } catch (_) {}
      }, 60000);
    }
  } catch (_) {}
})();
