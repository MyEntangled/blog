# MyEntangled Blog

A zero-backend academic blog for quantum computing research notes. It is built from Markdown with a small Node script and publishes static HTML to GitHub Pages.

## Quick Start

1. Edit `data/site.json` with your GitHub username, repository URL, and optional `basePath`.
2. Write posts in `content/posts/*.md`.
3. Add images and lightweight videos to `public/media/`.
4. Run `npm run build` to generate `dist/`.
5. Run `npm run serve` and open `http://127.0.0.1:4173`.

If `npm` is not available, run the scripts directly:

```sh
node scripts/build.mjs
node scripts/serve.mjs
```

No npm packages are required.

## Writing Posts

Each post starts with frontmatter:

```md
---
title: "Surface-Code Threshold Notes"
summary: "A compact derivation and reading map."
date: "2026-05-31"
tags: [quantum-error-correction, surface-code]
math: true
---
```

Supported Markdown includes headings, lists, block quotes, callouts, tables, fenced code, footnotes, images, LaTeX math, citations, and wiki-style internal references.

Use inline math like `$H = -\sum_i Z_i Z_{i+1}$` and display math like:

```tex
$$
\ket{\Phi^+} = \frac{\ket{00} + \ket{11}}{\sqrt{2}}.
$$
```

## Cross-References

Internal references use wiki links:

```md
See [[error-correction-thresholds]] for the threshold discussion.
See [[error-correction-thresholds#threshold-scaling|threshold scaling]] for a section link.
```

The build checks these links and generates backlinks automatically.

External scholarly sources live in `data/references.json` and are cited with:

```md
The surface-code literature is a good baseline [@fowler2012].
```

Only cited references appear in the page bibliography.

## Media

Use root-relative paths for local media:

```md
![Dilution refrigerator wiring](/media/fridge-wiring.jpg "A lab photo caption.")
```

For local videos, use:

```md
{{ video src="/media/rabi-oscillation.webm" poster="/media/rabi-poster.jpg" caption="Rabi oscillation simulation." }}
```

For external video, use the click-to-load YouTube directive:

```md
{{ youtube id="VIDEO_ID" title="Lecture title" }}
```

The generated pages lazy-load images, preload only video metadata, and avoid third-party video iframes until the reader clicks.

## Publishing on GitHub Pages

The workflow in `.github/workflows/pages.yml` builds `dist/` and deploys it to GitHub Pages.

In this repository, the public site URL is:

```text
https://myentangled.github.io/MyEntangled_blog/
```

In your repository settings, set Pages to use **GitHub Actions**. This is a project site, so `basePath` in `data/site.json` is set to `"/MyEntangled_blog"`.

## Local Structure

- `content/posts/`: dated research posts.
- `content/pages/`: stable pages such as About.
- `data/references.json`: bibliography records.
- `public/media/`: images, posters, and videos copied directly to the site.
- `src/styles/site.css`: layout and typography.
- `src/scripts/site.js`: theme toggle, search, and lightweight video embeds.
- `scripts/build.mjs`: static site generator.
- `scripts/serve.mjs`: local preview server.
