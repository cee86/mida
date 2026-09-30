// Themes and colorways, shared by the app's screen and the floating site controls.
// The app sends its saved preferences (checked on its side); this turns them into the
// data-* attributes and colour variables the CSS reads.
"use strict";

// Colorway presets: an accent colour and a background gradient (dark themes; the light theme
// uses a soft tint of the same colours; Foundry has fixed colours, see foundry.css).
const COLORWAYS = {
  sunrise: { name: "Sunrise", accent: "#f19a3f", colors: ["#0d1624", "#12161d", "#2a1a12"], angle: 170 },
  arc: { name: "Arc", accent: "#6cc8ff", colors: ["#07131f", "#0b1d2e", "#10314a"], angle: 160 },
  void: { name: "Void", accent: "#b48cff", colors: ["#0f0b1a", "#171027", "#2a1745"], angle: 160 },
  solar: { name: "Solar", accent: "#ffb347", colors: ["#140c08", "#23130b", "#3a1d0c"], angle: 160 },
  strand: { name: "Strand", accent: "#5fe0a0", colors: ["#07140f", "#0b2019", "#0f3326"], angle: 160 },
  stasis: { name: "Stasis", accent: "#8fb4ff", colors: ["#0a1020", "#101a33", "#1b2a4d"], angle: 160 },
  crimson: { name: "Crimson", accent: "#ff6b6b", colors: ["#150709", "#200b0f", "#3a1016"], angle: 160 },
};

// Foundry (a theme, not a colorway) always uses its own teal: dark enough to read on white.
const FOUNDRY = { name: "Foundry", accent: "#0f9488", colors: ["#f1f3f3", "#e3e7e8", "#d7dcde"], angle: 172 };

function colorwayOf(prefs) {
  if (prefs.theme === "foundry") return FOUNDRY;
  if (prefs.colorway === "custom") {
    const colors = prefs.customColors?.length >= 2 ? prefs.customColors : COLORWAYS.sunrise.colors;
    return { accent: prefs.customAccent || COLORWAYS.sunrise.accent, colors, angle: prefs.customAngle ?? 160 };
  }
  return COLORWAYS[prefs.colorway] ?? COLORWAYS.sunrise;
}

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

function gradientCss(way) {
  const stops = way.colors.length === 2 ? [way.colors[0], way.colors[1]] : way.colors;
  return `linear-gradient(${way.angle}deg, ${stops.join(", ")})`;
}

function applyTheme(prefs) {
  if (!prefs) return;
  const root = document.documentElement;
  const way = colorwayOf(prefs);
  root.dataset.theme = prefs.theme;
  root.dataset.contrast = prefs.highContrast ? "high" : "normal";
  const systemReduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.dataset.motion = prefs.reduceMotion === "on" || (prefs.reduceMotion === "system" && systemReduce) ? "reduce" : "full";
  root.style.setProperty("--accent", way.accent);
  root.style.setProperty("--accent-rgb", hexToRgb(way.accent));
  const [a, b, c = b] = way.colors;
  root.style.setProperty("--bg-1", a);
  root.style.setProperty("--bg-2", b);
  root.style.setProperty("--bg-3", c);
  root.style.setProperty("--bg-angle", `${way.angle}deg`);
}
