// Icons redrawn after the Companion app's (the owner's screenshots, 3 Oct 2026), for the Guardian and Director sections:
// collections, Director sections, commendations and the Ops crests. Drawn here as shapes on a 48 grid, not copied art.
//
// Each icon is a list of parts: ["s", d] a line ("t" a thin one), ["f", d] a filled shape, ["e", d] a filled shape whose inner pieces
// cut holes (even-odd), which is how the crests' dark motifs are made without needing a background colour.

const NS = "http://www.w3.org/2000/svg";
const r1 = (n) => Math.round(n * 100) / 100;

const circle = (cx, cy, r) => `M${r1(cx - r)} ${cy}a${r} ${r} 0 1 0 ${r1(2 * r)} 0a${r} ${r} 0 1 0 ${r1(-2 * r)} 0Z`;
const tri = (cx, top, w, h) => `M${cx} ${top}L${r1(cx + w / 2)} ${top + h}H${r1(cx - w / 2)}Z`;
const rect = (x, y, w, h) => `M${x} ${y}h${w}v${h}h${-w}Z`;
function star(cx, cy, R, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const d = i % 2 ? r : R;
    pts.push(`${r1(cx + d * Math.cos(a))} ${r1(cy + d * Math.sin(a))}`);
  }
  return `M${pts.join("L")}Z`;
}
// Diagonal hatching inside a circle (the stat trackers' disc).
function hatch(cx, cy, r, gap) {
  let d = "";
  for (let t = -r + gap / 2; t < r; t += gap) {
    const h = Math.sqrt(r * r - t * t);
    const [nx, ny] = [Math.SQRT1_2 * t, -Math.SQRT1_2 * t];
    d += `M${r1(cx + nx - Math.SQRT1_2 * h)} ${r1(cy + ny - Math.SQRT1_2 * h)}L${r1(cx + nx + Math.SQRT1_2 * h)} ${r1(cy + ny + Math.SQRT1_2 * h)}`;
  }
  return d;
}
// Thin rays around a point, as holes (the lore book's sun).
function rays(cx, cy, from, to, count, width) {
  let d = "";
  for (let i = 0; i < count; i++) {
    const a = (i * 2 * Math.PI) / count + Math.PI / count;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    const [px, py] = [-s * width, c * width];
    d += `M${r1(cx + c * from + px)} ${r1(cy + s * from + py)}L${r1(cx + c * to)} ${r1(cy + s * to)}L${r1(cx + c * from - px)} ${r1(cy + s * from - py)}Z`;
  }
  return d;
}

// The Ops crests: a framed shield, its motif cut out of the inner fill.
const SHIELD = "M8 4.5H40V30Q40 37.5 24 44Q8 37.5 8 30Z";
const SHIELD_IN = "M11 7.5H37V29.5Q37 35.5 24 40.8Q11 35.5 11 29.5Z";
const crest = (motif) => [["s", SHIELD], ["e", SHIELD_IN + motif]];

const GLYPHS = {
  items: [["f", [7, 19, 31].flatMap((x) => [rect(x, 12, 10, 10.5), rect(x, 24.5, 10, 10.5)]).join("")]],
  shaping: [["f", "M8 8H22C19 13 18 18 18 23H8ZM26 8H40V23H30C30 18 29 13 26 8ZM8 25H18C18 30 19 35 22 40H8ZM30 25H40V40H26C29 35 30 30 30 25Z"]],
  lore: [["e", "M4 12Q14 9.5 24 12.5Q34 9.5 44 12V36Q34 33.5 24 37Q14 33.5 4 36Z" + circle(24, 24, 6.4) + "M24 19.8L28.2 24L24 28.2L19.8 24Z" + circle(24, 24, 1.2) + rays(24, 24, 7.8, 11, 12, 0.7)]],
  metrics: [["s", "M13 8.5H35V29Q35 35.5 24 40.5Q13 35.5 13 29Z"], ["s", circle(24, 22.5, 7.5)], ["t", hatch(24, 22.5, 7.5, 2.4)]],
  medals: [["s", "M13 10Q24 6 35 10V33L24 40.5L13 33Z"], ["s", "M13 14.5Q24 10.5 35 14.5"], ["s", "M17.5 18L30.5 30.5M30.5 18L17.5 30.5M17 27l4 4M31 27l-4 4"], ["s", "M17 33.5L24 37L31 33.5"]],
  catalysts: [["s", "M13.5 13V31L24 40.5L34.5 31V13"], ["e", rect(16, 5, 16, 8.5) + rect(21, 6.5, 1.2, 5.5) + rect(25.8, 6.5, 1.2, 5.5)], ["s", "M24 13.5V43.5M13.5 31H11M34.5 31H37"]],
  seasonal: [["f", "M21 9.81A14.5 14.5 0 0 0 21 38.19C27.5 31 27.5 17 21 9.81Z"], ["s", "M26.5 9.72A14.5 14.5 0 0 1 26.5 38.28"]],
  friends: [["f", circle(30.5, 16, 5.2) + "M21 35Q21 24.5 30.5 24.5Q40 24.5 40 35Z" + circle(16.5, 18.5, 4.3) + "M8 35Q8 26.5 16.5 26.5Q19.5 26.5 21 28Q19.2 31 19.2 35Z"]],
  vendors: [["s", circle(24, 24, 15)], ["e", "M10.4 30.2Q12 23.6 19.5 22.8L21.5 19.5H30.5L32.5 22.8Q37.2 23.8 38.6 28.6A15 15 0 0 1 10.4 30.2Z" + rect(14, 25.6, 22, 1.1)]],
  quests: [["s", "M14 8H34V40L24 33L14 40Z"], ["f", "M18 24L18.6 16.5L22 20L24 15.5L26 20L29.4 16.5L30 24Z" + rect(18, 25.8, 12, 1.8)]],
  commend: [["s", star(24, 25.5, 18, 7.6)], ["s", "M10.5 33C19 27 28 23 39 21.5"]],
  arena: crest(
    [tri(24, 12.5, 5, 5), tri(21.3, 18.2, 5, 5), tri(26.7, 18.2, 5, 5), tri(18.6, 23.9, 5, 5), tri(24, 23.9, 5, 5), tri(29.4, 23.9, 5, 5)].join("") +
      [18.6, 24, 29.4].map((x) => rect(x - 0.4, 29.5, 0.8, 6.5)).join("") +
      [13.5, 15.5, 31.5, 33.5].map((x) => rect(x, 10.5, 1, 1)).join(""),
  ),
  fireteam: crest(tri(24, 11.5, 9, 8) + tri(18.6, 20.5, 5.4, 5.2) + tri(24, 20.5, 5.4, 5.2) + tri(29.4, 20.5, 5.4, 5.2) + circle(24, 31.5, 2.4) + circle(24, 31.5, 0.9) + rect(23.6, 26.5, 0.8, 2.4) + [14, 33].map((x) => rect(x, 11, 1, 1)).join("")),
  solo: crest("M15.5 12.5L20 18H28L32.5 12.5L33 22L29.2 29L26.2 35H21.8L18.8 29L15 22Z" + "M18.8 21.8L22.6 23.6L21.4 25.4ZM29.2 21.8L25.4 23.6L26.6 25.4Z" + rect(23.5, 10.5, 1, 15.5)),
  pinnacle: crest(circle(24, 17, 6.4) + circle(24, 17, 3.6) + rect(23.6, 9.5, 0.8, 15) + rect(16.5, 16.6, 15, 0.8) + "M24 25.5Q28.2 29.5 24 35.5Q19.8 29.5 24 25.5Z" + "M15.4 28.2Q21 28.2 22.2 34Q16.6 34 15.4 28.2Z" + "M32.6 28.2Q27 28.2 25.8 34Q31.4 34 32.6 28.2Z"),
  crucible: crest("M24 11.5L31.5 21L24 30.5L16.5 21Z" + "M24 15.8L28 21L24 26.2L20 21Z" + "M17.5 30.5L24 34.6L30.5 30.5V32.8L24 36.9L17.5 32.8Z"),
};

export function glyph(name) {
  const node = document.createElementNS(NS, "svg");
  node.setAttribute("viewBox", "0 0 48 48");
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("class", "glyph");
  for (const [kind, d] of GLYPHS[name] ?? []) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    if (kind === "s" || kind === "t") {
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "currentColor");
      path.setAttribute("stroke-width", kind === "t" ? "1" : "2.2");
    } else {
      path.setAttribute("fill", "currentColor");
      path.setAttribute("stroke", "none");
      if (kind === "e") path.setAttribute("fill-rule", "evenodd");
    }
    node.append(path);
  }
  return node;
}
