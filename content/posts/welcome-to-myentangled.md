---
title: "A Research Blog Built for Entangled Notes"
summary: "The first note: why this site is structured around Markdown, LaTeX, citations, and cross-references."
date: "2026-05-31"
tags: [meta, quantum-information]
math: true
---

The goal of this blog is to keep research notes light enough to write often and structured enough to become useful later. A quantum-computing note usually needs prose, equations, a few diagrams or photos, citations, and links to nearby questions. That should not require a database or a fragile publishing stack.

Here is the kind of equation that should feel ordinary in a post:

$$
\ket{\Phi^+} = \frac{\ket{00} + \ket{11}}{\sqrt{2}}, \qquad
\rho_A = \operatorname{Tr}_B \left(\ket{\Phi^+}\bra{\Phi^+}\right) = \frac{I}{2}.
$$

The reduced state $\rho_A$ is maximally mixed even though the joint state is pure. That tiny example already points toward the theme of the site: local descriptions can be incomplete, and the interesting structure often lives in the relation.

![Abstract lattice of entangled qubit paths](/media/quantum-lattice.png "A generated placeholder image for the blog homepage and media pipeline.")

## Internal Links

Internal links use wiki-style references. For example, the next seed note is [[error-correction-thresholds]], and section links can point to [[error-correction-thresholds#threshold-scaling|threshold scaling]] once the anchor exists.

The build turns these into ordinary links and records backlinks, so related notes can find each other without a manual index.

## External Sources

Book and paper references live in `data/references.json`. This sentence cites a textbook baseline [@nielsen2010] and a modern NISQ-era perspective [@preskill2018]. The bibliography at the bottom of the page is generated only from sources actually cited here.

## A Useful Writing Constraint

Every post should try to answer one question cleanly. If a second question starts growing, it should become another note and link back here. That keeps the graph of notes navigable instead of heroic.
