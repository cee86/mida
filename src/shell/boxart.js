// Faint astral linework behind a box (the owner liked it on Guardian's Characters and Journey boxes, 3 Oct 2026, and
// asked for it and similar designs on other boxes): rings, dials, orbits and lattices drawn in the theme's text colour
// at a few percent, clipped in a frame of their own so the box's corner marks outside its edge stay visible.
//
//   withArt(box, "dial")   puts a drawing behind `box` and returns it, so it can wrap an el(...) call.
//
// Variants: "rings" (rings and ticks at the left, arcs and a lattice across, a small ring at the right), "dial" (one big
// dial with spokes at the right), "orbit" (ellipses swinging from a corner, with planets), "lattice" (a diamond lattice
// band with gems). Drawn on a wide 1200 × 300 canvas that covers the box (cropped, never stretched).

const NS = "http://www.w3.org/2000/svg";
const ring = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const ticks = (cx, cy, r1, r2, n) =>
  Array.from({ length: n }, (_, i) => {
    const a = (i * 2 * Math.PI) / n;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return `M${(cx + c * r1).toFixed(1)} ${(cy + s * r1).toFixed(1)}L${(cx + c * r2).toFixed(1)} ${(cy + s * r2).toFixed(1)}`;
  }).join("");
const spokes = (cx, cy, r1, r2, n) => ticks(cx, cy, r1, r2, n);
const gem = (x, y, s = 6) => `M${x} ${y - s * 2}l${s} ${s * 2}-${s} ${s * 2}-${s}-${s * 2}z`;
const FILL = { fill: "currentColor", stroke: "none" };

const VARIANTS = {
  rings: [
    [ring(150, 175, 120) + ring(150, 175, 96) + ring(150, 175, 160), {}],
    [ticks(150, 175, 160, 170, 72), {}],
    ["M150 15V335M-10 175H310M37 62L263 288M263 62L37 288", { "stroke-width": "0.7", "stroke-dasharray": "3 7" }],
    ["M300 300A420 420 0 0 1 1180 90M360 300A360 360 0 0 1 1180 150", {}],
    [Array.from({ length: 9 }, (_, i) => `M${560 + i * 70} 0L${700 + i * 70} 300M${700 + i * 70} 0L${560 + i * 70} 300`).join(""), { "stroke-width": "0.6", opacity: "0.6" }],
    [ring(1040, 120, 70) + ring(1040, 120, 50), {}],
    [gem(1040, 52) + gem(1040, 188), FILL],
  ],
  dial: [
    [ring(1000, 150, 230) + ring(1000, 150, 190) + ring(1000, 150, 120) + ring(1000, 150, 40), {}],
    [ticks(1000, 150, 230, 244, 120), {}],
    [ticks(1000, 150, 190, 206, 24), { "stroke-width": "1.4" }],
    [spokes(1000, 150, 40, 120, 12), { "stroke-width": "0.7", "stroke-dasharray": "2 6" }],
    ["M1000 -100V400M700 150H1300", { "stroke-width": "0.7" }],
    [gem(1000, 150 - 190, 7) + gem(1000 - 190, 150, 7), FILL],
    ["M0 260H620M0 272H560", { "stroke-width": "0.7", opacity: "0.7" }],
    [ring(80, 70, 30) + ring(80, 70, 18), {}],
  ],
  orbit: [
    ["M-200 340A820 260 -12 0 1 1300 -40M-200 300A760 220 -12 0 1 1300 -80M-120 380A880 300 -12 0 1 1360 20", {}],
    [ring(318, 196, 10) + ring(905, 52, 7) + ring(1120, 118, 14), {}],
    [ring(318, 196, 3) + ring(1120, 118, 5), FILL],
    [ring(1120, 118, 34), { "stroke-dasharray": "3 6" }],
    [Array.from({ length: 14 }, (_, i) => `M${80 + i * 80} 300v-${8 + (i % 3) * 6}`).join(""), { "stroke-width": "0.8" }],
    ["M40 30H260M40 42H200", { "stroke-width": "0.7", opacity: "0.7" }],
  ],
  lattice: [
    [Array.from({ length: 18 }, (_, i) => `M${-100 + i * 80} 300L${20 + i * 80} 0M${20 + i * 80} 300L${-100 + i * 80} 0`).join(""), { "stroke-width": "0.6", opacity: "0.7" }],
    ["M0 150H1200", { "stroke-width": "0.8" }],
    [Array.from({ length: 7 }, (_, i) => gem(120 + i * 160, 150, 5)).join(""), FILL],
    [ring(600, 150, 60) + ring(600, 150, 44), {}],
    [ticks(600, 150, 60, 68, 36), {}],
  ],
};

function drawing(variant) {
  const node = document.createElementNS(NS, "svg");
  node.setAttribute("viewBox", "0 0 1200 300");
  node.setAttribute("preserveAspectRatio", "xMidYMid slice");
  node.setAttribute("aria-hidden", "true");
  node.setAttribute("class", "box-art__lines");
  for (const [d, extra] of VARIANTS[variant] ?? VARIANTS.rings) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    for (const [k, v] of Object.entries(extra)) path.setAttribute(k, v);
    node.append(path);
  }
  return node;
}

export function withArt(box, variant = "rings") {
  if (!box) return box;
  const frame = document.createElement("div");
  frame.className = "box-art";
  frame.setAttribute("aria-hidden", "true");
  frame.append(drawing(variant));
  box.classList.add("has-art");
  box.prepend(frame);
  return box;
}
