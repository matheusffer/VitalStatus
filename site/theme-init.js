(function () {
  try {
    var salvo = localStorage.getItem("vital-status-tema");
    var escuro =
      salvo === "dark" ||
      (salvo !== "light" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", escuro ? "dark" : "light");
  } catch (_) {}
})();
