(function () {
  const root = document.documentElement;
  const basePath = window.__BLOG_BASE_PATH__ || "";
  const themeStorageKey = "myentangled-theme";

  function setTheme(theme) {
    root.dataset.theme = theme;
    try {
      localStorage.setItem(themeStorageKey, theme);
    } catch (_) {
      /* localStorage can be unavailable in strict privacy modes. */
    }
  }

  function preferredTheme() {
    try {
      const stored = localStorage.getItem(themeStorageKey);
      if (stored === "dark" || stored === "light") return stored;
    } catch (_) {
      /* Ignore storage errors. */
    }
    return "light";
  }

  setTheme(preferredTheme());

  document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      setTheme(root.dataset.theme === "dark" ? "light" : "dark");
    });
  });

  document.querySelectorAll("[data-youtube]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-youtube");
      const title = button.getAttribute("data-title") || "Embedded video";
      const iframe = document.createElement("iframe");
      iframe.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id) + "?autoplay=1";
      iframe.title = title;
      iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      iframe.allowFullscreen = true;
      button.replaceChildren(iframe);
      button.classList.add("is-loaded");
    }, { once: true });
  });

  const searchRoot = document.querySelector("[data-search]");
  if (searchRoot) {
    const input = searchRoot.querySelector("input");
    const results = searchRoot.querySelector("[data-search-results]");
    const status = searchRoot.querySelector("[data-search-status]");
    let index = [];

    fetch(basePath + "/search-index.json")
      .then((response) => response.json())
      .then((items) => {
        index = items;
        renderResults("");
      })
      .catch(() => {
        status.textContent = "Search index could not be loaded.";
      });

    input.addEventListener("input", () => renderResults(input.value));

    function renderResults(query) {
      const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const matches = !terms.length
        ? index
        : index.filter((item) => terms.every((term) => item.search.includes(term)));

      status.textContent = matches.length === 1 ? "1 result" : matches.length + " results";
      results.replaceChildren(...matches.slice(0, 30).map(renderItem));
    }

    function renderItem(item) {
      const article = document.createElement("article");
      article.className = "post-card";

      const meta = document.createElement("div");
      meta.className = "post-meta";
      meta.textContent = item.dateLabel + " \u00b7 " + item.readingTime + " min read";

      const title = document.createElement("h3");
      const link = document.createElement("a");
      link.href = basePath + item.url;
      link.textContent = item.title;
      title.append(link);

      const summary = document.createElement("p");
      summary.textContent = item.summary;

      article.append(meta, title, summary);
      return article;
    }
  }
})();
