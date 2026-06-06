import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contentDir = path.join(root, "content");
const dataDir = path.join(root, "data");
const publicDir = path.join(root, "public");
const srcDir = path.join(root, "src");
const distDir = path.join(root, "dist");

const warnings = [];
const errors = [];

async function main() {
  const site = normalizeSite(await readJson(path.join(dataDir, "site.json"), {}));
  const references = await readJson(path.join(dataDir, "references.json"), {});

  await cleanDist();
  await copyPublicAssets();
  await copySourceAssets();

  const posts = (await readContent(path.join(contentDir, "posts"), "post"))
    .filter((item) => !item.draft)
    .sort((a, b) => b.dateValue - a.dateValue);
  const pages = (await readContent(path.join(contentDir, "pages"), "page"))
    .filter((item) => !item.draft)
    .sort((a, b) => a.title.localeCompare(b.title));

  const items = [...posts, ...pages];
  const bySlug = buildSlugIndex(items);

  for (const item of items) {
    renderContentItem(item, { site, references, bySlug });
  }

  validateInternalAnchors(items, bySlug);
  addBacklinks(items, bySlug);

  await writeHomePage({ site, posts });
  await writePostIndex({ site, posts });
  await writeSearchPage({ site });
  await writeContentPages({ site, items });
  await writeFeeds({ site, posts, pages });
  await writeNotFound({ site });

  if (warnings.length) {
    console.warn(warnings.map((warning) => `Warning: ${warning}`).join("\n"));
  }

  if (errors.length) {
    throw new Error(`Build failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
  }

  console.log(`Built ${items.length} content pages into ${relative(distDir)}.`);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

function normalizeSite(site) {
  const basePath = normalizeBasePath(site.basePath || "");
  return {
    title: site.title || "Academic Blog",
    description: site.description || "Research notes.",
    author: site.author || "Author",
    language: site.language || "en",
    url: String(site.url || "").replace(/\/$/, ""),
    basePath,
    repo: site.repo || "",
    nav: Array.isArray(site.nav) ? site.nav : []
  };
}

function normalizeBasePath(basePath) {
  if (!basePath || basePath === "/") return "";
  return `/${String(basePath).replace(/^\/+|\/+$/g, "")}`;
}

async function cleanDist() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await writeFile(path.join(distDir, ".nojekyll"), "");
}

async function copyPublicAssets() {
  if (existsSync(publicDir)) {
    await copyDir(publicDir, distDir);
  }
}

async function copySourceAssets() {
  await copyDir(path.join(srcDir, "styles"), path.join(distDir, "styles"));
  await copyDir(path.join(srcDir, "scripts"), path.join(distDir, "scripts"));
}

async function copyDir(from, to) {
  if (!existsSync(from)) return;
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyDir(source, target);
    } else if (entry.isFile()) {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(source, target);
    }
  }
}

async function readContent(dir, type) {
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith(".md")).sort();
  const items = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const raw = await readFile(filePath, "utf8");
    const parsed = parseFrontmatter(raw);
    const slug = parsed.data.slug || slugify(path.basename(file, ".md"));
    const date = parsed.data.date || new Date((await stat(filePath)).mtimeMs).toISOString().slice(0, 10);

    items.push({
      type,
      filePath,
      sourcePath: relative(filePath),
      slug,
      title: parsed.data.title || titleFromSlug(slug),
      summary: parsed.data.summary || "",
      date,
      dateValue: new Date(`${date}T00:00:00Z`).getTime(),
      updated: parsed.data.updated || "",
      tags: arrayValue(parsed.data.tags),
      draft: Boolean(parsed.data.draft),
      math: Boolean(parsed.data.math),
      body: parsed.body.trim(),
      url: type === "post" ? `/posts/${slug}/` : `/${slug}/`
    });
  }

  return items;
}

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { data: {}, body: raw };

  const head = raw.slice(4, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const data = {};
  const lines = head.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2];
    if (value === "") {
      const values = [];
      while (lines[index + 1] && /^\s*-\s+/.test(lines[index + 1])) {
        index += 1;
        values.push(parseScalar(lines[index].replace(/^\s*-\s+/, "")));
      }
      data[key] = values;
    } else {
      data[key] = parseScalar(value);
    }
  }

  return { data, body };
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (/^\[.*\]$/.test(trimmed)) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((part) => parseScalar(part.trim()));
  }
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function buildSlugIndex(items) {
  const bySlug = new Map();
  for (const item of items) {
    if (bySlug.has(item.slug)) {
      errors.push(`Duplicate slug "${item.slug}" in ${item.sourcePath} and ${bySlug.get(item.slug).sourcePath}.`);
    }
    bySlug.set(item.slug, item);
  }
  return bySlug;
}

function renderContentItem(item, context) {
  const ctx = {
    ...context,
    item,
    footnotes: new Map(),
    footnoteOrder: [],
    citations: [],
    citationIndex: new Map(),
    headings: [],
    headingIds: new Map(),
    internalLinks: [],
    hasMath: item.math
  };

  const body = extractFootnotes(item.body, ctx);
  const html = renderBlocks(body, ctx);
  const footnotesHtml = renderFootnotes(ctx);
  const referencesHtml = renderReferences(ctx);

  item.html = `${html}${footnotesHtml}${referencesHtml}`;
  item.toc = ctx.headings.filter((heading) => heading.level >= 2 && heading.level <= 3);
  item.headingIdSet = new Set(ctx.headings.map((heading) => heading.id));
  item.internalLinks = ctx.internalLinks;
  item.hasMath = ctx.hasMath || /\$\$|\\\(|\\\[|(^|[^\\])\$[^$\n]+(^|[^\\])\$/m.test(item.body);
  item.readingTime = readingTime(item.body);
  item.text = plainText(item.body);
}

function extractFootnotes(markdown, ctx) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\[\^([^\]]+)]:\s*(.*)$/);
    if (!match) {
      output.push(lines[index]);
      continue;
    }

    const id = slugify(match[1]);
    const parts = [match[2]];
    while (lines[index + 1] && /^( {2,}|\t)/.test(lines[index + 1])) {
      index += 1;
      parts.push(lines[index].trim());
    }
    ctx.footnotes.set(id, parts.join(" "));
  }

  return output.join("\n");
}

function renderBlocks(markdown, ctx) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const fence = trimmed.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      const languageClass = fence ? ` class="language-${escapeAttr(slugify(fence))}"` : "";
      output.push(`<pre class="code-block"><code${languageClass}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (trimmed.startsWith("$$")) {
      const math = [trimmed];
      const sameLineClosed = trimmed.length > 2 && trimmed.endsWith("$$");
      index += 1;
      if (!sameLineClosed) {
        while (index < lines.length) {
          math.push(lines[index]);
          if (lines[index].trim().endsWith("$$")) {
            index += 1;
            break;
          }
          index += 1;
        }
      }
      ctx.hasMath = true;
      output.push(`<div class="math-display">${escapeHtml(math.join("\n"))}</div>`);
      continue;
    }

    const directive = parseDirective(trimmed);
    if (directive) {
      output.push(renderDirective(directive, ctx));
      index += 1;
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/\s+#*$/, "");
      const id = uniqueHeadingId(text, ctx);
      ctx.headings.push({ level, id, text: plainText(text) });
      output.push(`<h${level} id="${escapeAttr(id)}">${renderInline(text, ctx)}<a class="heading-anchor" href="#${escapeAttr(id)}" aria-label="Link to this section">#</a></h${level}>`);
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      output.push("<hr>");
      index += 1;
      continue;
    }

    const image = parseMarkdownImage(trimmed);
    if (image) {
      output.push(renderImageFigure(image, ctx));
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableLines.push(lines[index]);
        index += 1;
      }
      output.push(renderTable(tableLines, ctx));
      continue;
    }

    if (/^\s*([-*+])\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (index < lines.length) {
        const itemMatch = lines[index].match(ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/);
        if (!itemMatch) break;
        items.push(itemMatch[1]);
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      output.push(`<${tag}>${items.map((itemText) => `<li>${renderInline(itemText, ctx)}</li>`).join("")}</${tag}>`);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      output.push(renderQuote(quoteLines, ctx));
      continue;
    }

    const paragraph = [trimmed];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    output.push(`<p>${renderInline(paragraph.join(" "), ctx)}</p>`);
  }

  return output.join("\n");
}

function isBlockStart(lines, index) {
  const line = lines[index] || "";
  const trimmed = line.trim();
  return (
    trimmed.startsWith("```") ||
    trimmed.startsWith("$$") ||
    parseDirective(trimmed) ||
    /^(#{1,6})\s+/.test(trimmed) ||
    /^(-{3,}|\*{3,}|_{3,})$/.test(trimmed) ||
    parseMarkdownImage(trimmed) ||
    isTableStart(lines, index) ||
    /^\s*([-*+])\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^\s*>/.test(line)
  );
}

function renderInline(text, ctx) {
  const stash = [];
  const hold = (html) => {
    const token = `\uE000${stash.length}\uE001`;
    stash.push(html);
    return token;
  };

  let value = String(text);

  value = value.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));

  value = value.replace(/\\\((.+?)\\\)/g, (_, math) => {
    ctx.hasMath = true;
    return hold(`<span class="math-inline">\\(${escapeHtml(math)}\\)</span>`);
  });

  value = value.replace(/(^|[^\w\\])\$([^$\n]+?)\$/g, (match, prefix, math) => {
    ctx.hasMath = true;
    return `${prefix}${hold(`<span class="math-inline">\\(${escapeHtml(math)}\\)</span>`)}`;
  });

  value = value.replace(/\[((?:@[A-Za-z0-9:_-]+)(?:\s*;\s*@[A-Za-z0-9:_-]+)*)\]/g, (_, rawKeys) => {
    const keys = rawKeys.split(";").map((key) => key.trim().replace(/^@/, ""));
    return hold(renderCitationGroup(keys, ctx));
  });

  value = value.replace(/\[\^([^\]]+)\]/g, (_, rawId) => hold(renderFootnoteRef(rawId, ctx)));

  value = value.replace(/\[\[([^\]]+)\]\]/g, (_, raw) => hold(renderWikiLink(raw, ctx)));

  value = value.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, src, title) => {
    return hold(renderInlineImage({ alt, src, title }, ctx));
  });

  value = value.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, href, title) => {
    return hold(renderMarkdownLink(label, href, title, ctx));
  });

  value = escapeHtml(value);
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/(^|[^\*])\*([^*\s][^*]*?)\*/g, "$1<em>$2</em>");
  value = value.replace(/\uE000(\d+)\uE001/g, (_, id) => stash[Number(id)] || "");

  return value;
}

function renderCitationGroup(keys, ctx) {
  const links = keys.map((key) => {
    if (!ctx.references[key]) {
      errors.push(`Missing citation "${key}" in ${ctx.item.sourcePath}.`);
      return `<span class="missing-ref">[@${escapeHtml(key)}]</span>`;
    }
    if (!ctx.citationIndex.has(key)) {
      ctx.citationIndex.set(key, ctx.citations.length + 1);
      ctx.citations.push(key);
    }
    const number = ctx.citationIndex.get(key);
    return `<a class="citation" href="#ref-${escapeAttr(key)}" id="cite-${escapeAttr(key)}">[${number}]</a>`;
  });
  return links.join(" ");
}

function renderFootnoteRef(rawId, ctx) {
  const id = slugify(rawId);
  if (!ctx.footnotes.has(id)) {
    errors.push(`Missing footnote "${rawId}" in ${ctx.item.sourcePath}.`);
  }
  if (!ctx.footnoteOrder.includes(id)) ctx.footnoteOrder.push(id);
  const index = ctx.footnoteOrder.indexOf(id) + 1;
  const refId = `fnref-${ctx.item.slug}-${id}`;
  const noteId = `fn-${ctx.item.slug}-${id}`;
  return `<sup class="footnote-ref" id="${escapeAttr(refId)}"><a href="#${escapeAttr(noteId)}">${index}</a></sup>`;
}

function renderWikiLink(raw, ctx) {
  const [targetPart, labelPart] = raw.split("|");
  const target = targetPart.trim();
  const label = labelPart ? labelPart.trim() : "";
  const hashIndex = target.indexOf("#");
  const slugPart = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const anchor = hashIndex >= 0 ? slugify(target.slice(hashIndex + 1)) : "";

  if (!slugPart) {
    const href = anchor ? `#${anchor}` : "#";
    return `<a class="xref" href="${escapeAttr(href)}">${escapeHtml(label || titleFromSlug(anchor))}</a>`;
  }

  const slug = slugify(slugPart);
  const item = ctx.bySlug.get(slug);
  if (!item) {
    errors.push(`Broken internal reference "[[${raw}]]" in ${ctx.item.sourcePath}.`);
    return `<span class="broken-link">[[${escapeHtml(raw)}]]</span>`;
  }

  ctx.internalLinks.push({ from: ctx.item.slug, to: item.slug, anchor, raw });
  const href = withBase(item.url + (anchor ? `#${anchor}` : ""), ctx.site);
  return `<a class="xref" href="${escapeAttr(href)}">${escapeHtml(label || item.title)}</a>`;
}

function renderMarkdownLink(label, href, title, ctx) {
  const isExternal = /^(https?:)?\/\//.test(href) || href.startsWith("mailto:");
  const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : "";
  const className = isExternal ? ' class="external"' : "";
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
  const url = href.startsWith("/") ? withBase(href, ctx.site) : href;
  return `<a${className} href="${escapeAttr(url)}"${titleAttr}${target}>${escapeHtml(label)}</a>`;
}

function renderInlineImage(image, ctx) {
  const title = image.title ? ` title="${escapeAttr(image.title)}"` : "";
  const src = image.src.startsWith("/") ? withBase(image.src, ctx.site) : image.src;
  return `<img src="${escapeAttr(src)}" alt="${escapeAttr(image.alt)}"${title} loading="lazy" decoding="async">`;
}

function renderImageFigure(image, ctx) {
  const src = image.src.startsWith("/") ? withBase(image.src, ctx.site) : image.src;
  const caption = image.title ? `<figcaption>${renderInline(image.title, ctx)}</figcaption>` : "";
  return `<figure class="media-block"><img src="${escapeAttr(src)}" alt="${escapeAttr(image.alt)}" loading="lazy" decoding="async">${caption}</figure>`;
}

function parseMarkdownImage(text) {
  const match = text.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/);
  if (!match) return null;
  return { alt: match[1], src: match[2], title: match[3] || "" };
}

function renderQuote(lines, ctx) {
  const callout = lines[0]?.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*$/i);
  if (!callout) {
    return `<blockquote>${renderBlocks(lines.join("\n"), ctx)}</blockquote>`;
  }

  const label = callout[1].toUpperCase();
  const body = lines.slice(1).join("\n").trim();
  return `<aside class="callout callout-${label.toLowerCase()}"><div class="callout-title">${label}</div>${renderBlocks(body, ctx)}</aside>`;
}

function isTableStart(lines, index) {
  const current = lines[index] || "";
  const next = lines[index + 1] || "";
  return current.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(next);
}

function renderTable(lines, ctx) {
  const headers = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow);
  return [
    '<div class="table-wrap"><table>',
    `<thead><tr>${headers.map((cell) => `<th>${renderInline(cell, ctx)}</th>`).join("")}</tr></thead>`,
    `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell, ctx)}</td>`).join("")}</tr>`).join("")}</tbody>`,
    "</table></div>"
  ].join("");
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function parseDirective(line) {
  const match = line.match(/^\{\{\s*([A-Za-z0-9_-]+)(.*?)\s*\}\}$/);
  if (!match) return null;

  const attrs = {};
  const rawAttrs = match[2];
  const attrPattern = /([A-Za-z0-9_-]+)=("([^"]*)"|'([^']*)'|([^\s]+))/g;
  let attrMatch;
  while ((attrMatch = attrPattern.exec(rawAttrs))) {
    attrs[attrMatch[1]] = attrMatch[3] ?? attrMatch[4] ?? attrMatch[5] ?? "";
  }

  return { name: match[1].toLowerCase(), attrs };
}

function renderDirective(directive, ctx) {
  if (directive.name === "video") {
    const src = directive.attrs.src || "";
    if (!src) {
      errors.push(`Video directive missing src in ${ctx.item.sourcePath}.`);
      return "";
    }
    const poster = directive.attrs.poster ? ` poster="${escapeAttr(assetUrl(directive.attrs.poster, ctx.site))}"` : "";
    const caption = directive.attrs.caption ? `<figcaption>${renderInline(directive.attrs.caption, ctx)}</figcaption>` : "";
    return `<figure class="media-block"><video controls playsinline preload="metadata"${poster}><source src="${escapeAttr(assetUrl(src, ctx.site))}">Your browser does not support embedded video.</video>${caption}</figure>`;
  }

  if (directive.name === "youtube") {
    const id = directive.attrs.id || "";
    const title = directive.attrs.title || "Embedded video";
    if (!id) {
      errors.push(`YouTube directive missing id in ${ctx.item.sourcePath}.`);
      return "";
    }
    const thumbnail = `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
    const caption = directive.attrs.caption ? `<figcaption>${renderInline(directive.attrs.caption, ctx)}</figcaption>` : "";
    return `<figure class="media-block"><button class="lite-video" type="button" data-youtube="${escapeAttr(id)}" data-title="${escapeAttr(title)}"><img src="${escapeAttr(thumbnail)}" alt="" loading="lazy" decoding="async"><span class="play-badge">Play video</span></button>${caption}</figure>`;
  }

  if (directive.name === "cv-profile") {
    const image = assetUrl(directive.attrs.image || "/media/profile.svg", ctx.site);
    const name = directive.attrs.name || ctx.item.title;
    const title = directive.attrs.title || "";
    const affiliation = directive.attrs.affiliation || "";
    const location = directive.attrs.location || "";
    const links = parseCvLinks(directive.attrs.links || "");
    return `<section class="cv-profile">
      <div class="cv-photo-wrap"><img class="cv-photo" src="${escapeAttr(image)}" alt="${escapeAttr(name)} profile picture" loading="eager" decoding="async"></div>
      <div class="cv-profile-body">
        <h1>${escapeHtml(name)}</h1>
        ${title ? `<p class="cv-role">${escapeHtml(title)}</p>` : ""}
        ${affiliation || location ? `<p class="cv-affiliation">${[affiliation, location].filter(Boolean).map(escapeHtml).join(" &middot; ")}</p>` : ""}
        ${links.length ? `<div class="cv-link-grid">${links.map((link) => renderCvLink(link)).join("")}</div>` : ""}
      </div>
    </section>`;
  }

  if (directive.name === "cv-download") {
    const href = assetUrl(directive.attrs.href || "/media/erio-trong-duong-cv.md", ctx.site);
    const label = directive.attrs.label || "Download CV";
    return `<p class="cv-actions"><a class="button primary" href="${escapeAttr(href)}" download>${escapeHtml(label)}</a></p>`;
  }

  if (directive.name === "cv-education") {
    const degree = directive.attrs.degree || "Degree";
    const school = directive.attrs.school || "School";
    const metaParts = parseEducationMeta(directive.attrs.meta || "");
    const location = directive.attrs.location || metaParts.location;
    const time = directive.attrs.time || metaParts.time;
    const details = parseEducationDetails(directive.attrs.details || directive.attrs.detail || "");
    return `<article class="cv-education-card">
      ${location || time ? `<div class="cv-card-meta">${location ? `<span>${renderInline(location, ctx)}</span>` : "<span></span>"}${time ? `<span>${renderInline(time, ctx)}</span>` : ""}</div>` : ""}
      <h3>${renderInline(degree, ctx)}</h3>
      <p class="cv-school">${renderInline(school, ctx)}</p>
      ${details.length ? `<div class="cv-education-details">${details.map((detail) => `<p>${renderInline(detail, ctx)}</p>`).join("")}</div>` : ""}
    </article>`;
  }

  if (directive.name === "cv-chips") {
    const chips = String(directive.attrs.items || "").split(";").map((item) => item.trim()).filter(Boolean);
    return `<div class="cv-chip-list">${chips.map((chip) => `<span class="cv-chip">${escapeHtml(chip)}</span>`).join("")}</div>`;
  }

  warnings.push(`Unknown directive "{{ ${directive.name} }}" in ${ctx.item.sourcePath}.`);
  return "";
}

function parseCvLinks(raw) {
  return String(raw)
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [label, href] = entry.split("|").map((part) => part.trim());
      return { label: label || href, href: href || label };
    })
    .filter((link) => link.href);
}

function parseEducationMeta(raw) {
  const [location = "", time = ""] = String(raw).split("|").map((part) => part.trim());
  return { location, time };
}

function parseEducationDetails(raw) {
  return String(raw)
    .split(";")
    .map((detail) => detail.trim())
    .filter(Boolean);
}

function renderCvLink(link) {
  const initial = (link.label || "L").trim().charAt(0).toUpperCase();
  if (link.href.startsWith("email:")) {
    const addressParts = link.href.slice("email:".length).split(",").map((part) => part.trim()).filter(Boolean);
    const user = addressParts.shift() || "";
    const domain = addressParts.join(".");
    const encoded = encodeEmailAddress(user && domain ? `${user}@${domain}` : "");
    return `<a class="cv-link" href="#email" data-initial="${escapeAttr(initial)}" data-email-link data-email-encoded="${escapeAttr(encoded)}"><span>${escapeHtml(link.label)}</span></a>`;
  }
  const isExternal = /^(https?:)?\/\//.test(link.href);
  const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : "";
  return `<a class="cv-link" href="${escapeAttr(link.href)}" data-initial="${escapeAttr(initial)}"${target}><span>${escapeHtml(link.label)}</span></a>`;
}

function encodeEmailAddress(address) {
  return Array.from(address).map((char) => char.charCodeAt(0).toString(36)).join("-");
}

function renderFootnotes(ctx) {
  if (!ctx.footnoteOrder.length) return "";
  const notes = ctx.footnoteOrder.map((id) => {
    const index = ctx.footnoteOrder.indexOf(id) + 1;
    const noteId = `fn-${ctx.item.slug}-${id}`;
    const refId = `fnref-${ctx.item.slug}-${id}`;
    const text = ctx.footnotes.get(id) || "";
    return `<li id="${escapeAttr(noteId)}">${renderInline(text, ctx)} <a href="#${escapeAttr(refId)}" aria-label="Back to footnote reference">&#8617;</a></li>`;
  }).join("");
  return `<section class="footnotes" aria-labelledby="footnotes-heading"><h2 id="footnotes-heading">Footnotes</h2><ol>${notes}</ol></section>`;
}

function renderReferences(ctx) {
  if (!ctx.citations.length) return "";
  const refs = ctx.citations.map((key) => {
    const ref = ctx.references[key];
    const doi = ref.doi ? ` <span class="muted">doi:</span> <a href="${escapeAttr(ref.url || `https://doi.org/${ref.doi}`)}">${escapeHtml(ref.doi)}</a>` : "";
    const title = ref.url ? `<a href="${escapeAttr(ref.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ref.title)}</a>` : escapeHtml(ref.title);
    return `<li id="ref-${escapeAttr(key)}">${escapeHtml(ref.authors)} (${escapeHtml(ref.year)}). ${title}. <em>${escapeHtml(ref.venue || "")}</em>.${doi}</li>`;
  }).join("");
  return `<section class="references" aria-labelledby="references-heading"><h2 id="references-heading">References</h2><ol>${refs}</ol></section>`;
}

function validateInternalAnchors(items, bySlug) {
  for (const item of items) {
    for (const link of item.internalLinks || []) {
      if (!link.anchor) continue;
      const target = bySlug.get(link.to);
      if (target && !target.headingIdSet.has(link.anchor)) {
        errors.push(`Broken section reference "[[${link.raw}]]" in ${item.sourcePath}; "${target.title}" has no "#${link.anchor}" heading.`);
      }
    }
  }
}

function addBacklinks(items, bySlug) {
  const backlinks = new Map(items.map((item) => [item.slug, []]));
  for (const item of items) {
    for (const link of item.internalLinks || []) {
      const target = bySlug.get(link.to);
      if (!target || target.slug === item.slug) continue;
      const current = backlinks.get(target.slug);
      if (!current.some((entry) => entry.slug === item.slug)) {
        current.push({ slug: item.slug, title: item.title, url: item.url, summary: item.summary });
      }
    }
  }

  for (const item of items) {
    item.backlinks = backlinks.get(item.slug) || [];
  }
}

async function writeHomePage({ site, posts }) {
  const latest = posts.slice(0, 4);
  const content = `
    <main id="main">
      <section class="hero wrap">
        <div class="hero-copy">
          <p class="eyebrow">Quantum computing research notebook</p>
          <h1>${escapeHtml(site.title)}</h1>
          <p>${escapeHtml(site.description)}</p>
          <div class="hero-actions">
            <a class="button primary" href="${withBase("/posts/", site)}">Read posts</a>
            <a class="button secondary" href="${withBase("/search/", site)}">Search notes</a>
          </div>
        </div>
        <div class="hero-media">
          <img src="${withBase("/media/nina.png", site)}" alt="Nina, the MyEntangled raccoon" loading="eager" decoding="async">
        </div>
      </section>
      <section class="section">
        <div class="wrap">
          <div class="section-header">
            <h2>Latest Notes</h2>
            <a href="${withBase("/posts/", site)}">All posts</a>
          </div>
          <div class="post-grid">
            ${latest.map((post) => renderPostCard(post, site)).join("")}
          </div>
        </div>
      </section>
    </main>`;

  await writePage("/", layout({ site, title: site.title, description: site.description, url: "/", active: "/", content }));
}

async function writePostIndex({ site, posts }) {
  const content = `
    <main id="main" class="listing">
      <header class="listing-header">
        <h1 class="listing-title">Posts</h1>
        <p class="muted">Research notes, derivations, paper trails, and implementation sketches.</p>
      </header>
      <div class="post-list">
        ${posts.map((post) => renderPostCard(post, site)).join("")}
      </div>
    </main>`;
  await writePage("/posts/", layout({ site, title: `Posts | ${site.title}`, description: "All posts.", url: "/posts/", active: "/posts/", content }));
}

async function writeSearchPage({ site }) {
  const content = `
    <main id="main" class="listing" data-search>
      <header class="listing-header">
        <h1 class="listing-title">Search</h1>
        <p class="muted">Search titles, summaries, tags, and note text.</p>
      </header>
      <section class="search-box">
        <label id="search-label" for="search-input">Search query</label>
        <input id="search-input" type="search" autocomplete="off" placeholder="Try: threshold, entanglement, decoder">
        <p class="muted" data-search-status>Loading search index...</p>
      </section>
      <div class="post-list" data-search-results></div>
    </main>`;
  await writePage("/search/", layout({ site, title: `Search | ${site.title}`, description: "Search the research notebook.", url: "/search/", active: "/search/", content }));
}

async function writeContentPages({ site, items }) {
  for (const item of items) {
    const isPost = item.type === "post";
    const header = `
      <header class="article-header">
        <div class="post-meta">
          ${isPost ? `<time datetime="${escapeAttr(item.date)}">${escapeHtml(formatDate(item.date))}</time><span>&middot;</span>` : ""}
          <span>${item.readingTime} min read</span>
        </div>
        <h1 class="page-title">${escapeHtml(item.title)}</h1>
        ${item.summary ? `<p class="summary">${escapeHtml(item.summary)}</p>` : ""}
        ${isPost ? renderTags(item, site) : ""}
      </header>`;

    const content = `
      <main id="main" class="article-shell page-${escapeAttr(item.slug)}">
        <article class="article">
          ${header}
          <div class="prose">${item.html}${renderBacklinks(item, site)}</div>
        </article>
        ${renderSidePanel(item, site)}
      </main>`;

    await writePage(item.url, layout({
      site,
      title: `${item.title} | ${site.title}`,
      description: item.summary || site.description,
      url: item.url,
      active: isPost ? "/posts/" : item.url,
      content,
      hasMath: item.hasMath
    }));
  }
}

async function writeFeeds({ site, posts, pages }) {
  const now = new Date().toISOString();
  const allUrls = [
    "/",
    "/posts/",
    "/search/",
    ...posts.map((post) => post.url),
    ...pages.map((page) => page.url)
  ];

  const rss = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(site.title)}</title>
    <link>${escapeXml(absoluteUrl("/", site))}</link>
    <description>${escapeXml(site.description)}</description>
    <language>${escapeXml(site.language)}</language>
    <lastBuildDate>${new Date(now).toUTCString()}</lastBuildDate>
    ${posts.slice(0, 20).map((post) => `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(absoluteUrl(post.url, site))}</link>
      <guid>${escapeXml(absoluteUrl(post.url, site))}</guid>
      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeXml(post.summary)}</description>
    </item>`).join("")}
  </channel>
</rss>`;

  const sitemap = `<?xml version="1.0" encoding="UTF-8" ?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map((url) => `  <url><loc>${escapeXml(absoluteUrl(url, site))}</loc></url>`).join("\n")}
</urlset>`;

  const searchIndex = [...posts, ...pages].map((item) => ({
    title: item.title,
    summary: item.summary,
    url: item.url,
    date: item.date,
    dateLabel: item.type === "post" ? formatDate(item.date) : "Page",
    readingTime: item.readingTime,
    tags: item.tags,
    search: `${item.title} ${item.summary} ${item.tags.join(" ")} ${item.text}`.toLowerCase()
  }));

  await writeFile(path.join(distDir, "rss.xml"), rss.trim());
  await writeFile(path.join(distDir, "sitemap.xml"), sitemap.trim());
  await writeFile(path.join(distDir, "search-index.json"), JSON.stringify(searchIndex, null, 2));
  await writeFile(path.join(distDir, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${absoluteUrl("/sitemap.xml", site)}\n`);
}

async function writeNotFound({ site }) {
  const content = `
    <main id="main" class="listing">
      <header class="listing-header">
        <h1 class="listing-title">Page Not Found</h1>
        <p class="muted">That note does not exist yet, or the link has moved.</p>
      </header>
      <p><a class="button primary" href="${withBase("/", site)}">Go home</a></p>
    </main>`;
  await writeFile(path.join(distDir, "404.html"), layout({ site, title: `404 | ${site.title}`, description: "Page not found.", url: "/404.html", active: "", content }));
}

function layout({ site, title, description, url, active, content, hasMath = false }) {
  const canonical = absoluteUrl(url, site);
  const mathScripts = hasMath ? `
    <script>
      window.MathJax = {
        tex: {
          inlineMath: [["\\\\(", "\\\\)"], ["$", "$"]],
          displayMath: [["$$", "$$"], ["\\\\[", "\\\\]"]],
          tags: "ams"
        },
        options: {
          skipHtmlTags: ["script", "noscript", "style", "textarea", "pre", "code"]
        }
      };
    </script>
    <script defer src="https://cdn.jsdelivr.net/npm/mathjax@3.2.2/es5/tex-chtml.js"></script>` : "";

  return `<!doctype html>
<html lang="${escapeAttr(site.language)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttr(description)}">
  <meta name="theme-color" content="#f9faf9">
  <link rel="canonical" href="${escapeAttr(canonical)}">
  <meta property="og:title" content="${escapeAttr(title)}">
  <meta property="og:description" content="${escapeAttr(description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapeAttr(canonical)}">
  <meta property="og:image" content="${escapeAttr(absoluteUrl("/favicon.svg", site))}">
  <link rel="icon" href="${withBase("/favicon.svg", site)}" type="image/svg+xml">
  <link rel="alternate icon" href="${withBase("/favicon_transparent.svg", site)}" type="image/svg+xml">
  <link rel="apple-touch-icon" href="${withBase("/favicon.svg", site)}">
  <link rel="alternate" href="${withBase("/rss.xml", site)}" type="application/rss+xml" title="${escapeAttr(site.title)}">
  <link rel="stylesheet" href="${withBase("/styles/site.css", site)}">
  <script>window.__BLOG_BASE_PATH__ = ${JSON.stringify(site.basePath)};</script>
  <script defer src="${withBase("/scripts/site.js", site)}"></script>
  ${mathScripts}
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  ${renderHeader(site, active)}
  ${content}
  ${renderFooter(site)}
</body>
</html>`;
}

function renderHeader(site, active) {
  const nav = site.nav.map((item) => {
    return `<a href="${withBase(item.href, site)}">${escapeHtml(item.label)}</a>`;
  }).join("");

  return `<header class="site-header">
    <div class="header-inner">
      <a class="brand" href="${withBase("/", site)}" aria-label="${escapeAttr(site.title)} home">
        <span>${escapeHtml(site.title)}</span>
      </a>
      <nav class="nav" aria-label="Primary navigation">
        ${nav}
        <button class="theme-toggle" type="button" data-theme-toggle aria-label="Toggle color theme">&#9680;</button>
      </nav>
    </div>
  </header>`;
}

function renderFooter(site) {
  return `<footer class="site-footer">
    <div class="footer-inner">
      <span>&copy; ${new Date().getUTCFullYear()} ${escapeHtml(site.author)}</span>
      <span><a href="${withBase("/rss.xml", site)}">RSS</a>${site.repo ? ` &middot; <a href="${escapeAttr(site.repo)}">Source</a>` : ""}</span>
    </div>
  </footer>`;
}

function renderPostCard(post, site) {
  return `<article class="post-card">
    <div class="post-meta"><time datetime="${escapeAttr(post.date)}">${escapeHtml(formatDate(post.date))}</time><span>&middot;</span><span>${post.readingTime} min read</span></div>
    <h3><a href="${withBase(post.url, site)}">${escapeHtml(post.title)}</a></h3>
    ${post.summary ? `<p>${escapeHtml(post.summary)}</p>` : ""}
    ${renderTags(post, site)}
  </article>`;
}

function renderTags(item, site) {
  if (!item.tags.length) return "";
  return `<div class="tag-list">${item.tags.map((tag) => `<span class="tag">${escapeHtml(titleFromSlug(tag))}</span>`).join("")}</div>`;
}

function renderSidePanel(item, site) {
  const toc = item.toc.length ? `<nav class="toc" aria-labelledby="toc-heading"><h2 id="toc-heading">On This Page</h2><ol>${item.toc.map((heading) => `<li><a href="#${escapeAttr(heading.id)}">${escapeHtml(heading.text)}</a></li>`).join("")}</ol></nav>` : "";
  const related = item.backlinks.length ? `<section class="aside-box" aria-labelledby="related-heading"><h2 id="related-heading">Linked Here</h2><ul>${item.backlinks.map((backlink) => `<li><a href="${withBase(backlink.url, site)}">${escapeHtml(backlink.title)}</a></li>`).join("")}</ul></section>` : "";
  return `<aside class="side-panel">${toc}${related}</aside>`;
}

function renderBacklinks(item, site) {
  if (!item.backlinks.length) return "";
  return `<section class="backlinks" aria-labelledby="backlinks-heading"><h2 id="backlinks-heading">Backlinks</h2><ul>${item.backlinks.map((backlink) => `<li><a href="${withBase(backlink.url, site)}">${escapeHtml(backlink.title)}</a>${backlink.summary ? ` <span class="muted">&mdash; ${escapeHtml(backlink.summary)}</span>` : ""}</li>`).join("")}</ul></section>`;
}

async function writePage(url, html) {
  const file = url === "/" ? path.join(distDir, "index.html") : path.join(distDir, url.replace(/^\/|\/$/g, ""), "index.html");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
}

function uniqueHeadingId(text, ctx) {
  const base = slugify(plainText(text)) || "section";
  const count = ctx.headingIds.get(base) || 0;
  ctx.headingIds.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

function withBase(url, site) {
  if (/^(https?:)?\/\//.test(url) || url.startsWith("mailto:")) return url;
  const pathPart = url.startsWith("/") ? url : `/${url}`;
  return `${site.basePath}${pathPart}`;
}

function absoluteUrl(url, site) {
  const base = site.url || "";
  return `${base}${withBase(url, site)}`;
}

function assetUrl(url, site) {
  return url.startsWith("/") ? withBase(url, site) : url;
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map((entry) => slugify(entry)).filter(Boolean);
  if (!value) return [];
  return String(value).split(",").map((entry) => slugify(entry)).filter(Boolean);
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleFromSlug(slug) {
  return String(slug || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(new Date(`${date}T00:00:00Z`));
}

function readingTime(markdown) {
  const words = plainText(markdown).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

function plainText(markdown) {
  return String(markdown || "")
    .replace(/^---[\s\S]*?---/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$2 $1")
    .replace(/\[@[^\]]+\]/g, " ")
    .replace(/[#>*_`$~|:-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relative(filePath) {
  return path.relative(root, filePath);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function escapeXml(value) {
  return escapeHtml(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}


await main();
