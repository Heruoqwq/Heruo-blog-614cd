export const palettes = [
  { id: "violet", name: "紫藤", light: "#6d50b5", dark: "#baa6ef" },
  { id: "blue", name: "晴空", light: "#315fc3", dark: "#91b5f9" },
  { id: "jade", name: "青竹", light: "#18725d", dark: "#8ed3b2" },
  { id: "amber", name: "暖橙", light: "#a85220", dark: "#e6b678" },
  { id: "rose", name: "樱粉", light: "#aa3b6c", dark: "#eca0c1" },
  { id: "graphite", name: "石墨", light: "#4c596b", dark: "#b5c3d2" },
] as const;
export type Palette = typeof palettes[number]["id"];
export type Mode = "light" | "dark" | "system";
export type Appearance = { palette: Palette; mode: Mode };
export const appearanceKey = "heruo-appearance";
export const defaultAppearance: Appearance = { palette: "violet", mode: "system" };
export function normalizeAppearance(value: unknown): Appearance {
  const v = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    palette: palettes.some((p) => p.id === v.palette) ? v.palette as Palette : defaultAppearance.palette,
    mode: ["light", "dark", "system"].includes(String(v.mode)) ? v.mode as Mode : defaultAppearance.mode,
  };
}
export function readAppearance(): Appearance {
  try {
    const saved = localStorage.getItem(appearanceKey);
    if (saved) return normalizeAppearance(JSON.parse(saved));
    const legacy = localStorage.getItem("tony-theme");
    if (legacy === "dark" || legacy === "light") return { palette: "violet", mode: legacy };
  } catch {}
  return { ...defaultAppearance };
}
export function resolvedTheme(mode: Mode, prefersDark: boolean) {
  return mode === "system" ? prefersDark ? "dark" : "light" : mode;
}
export function applyAppearance(value: Appearance, prefersDark = false) {
  const theme = resolvedTheme(value.mode, prefersDark);
  document.documentElement.dataset.palette = value.palette;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  return theme;
}
export function saveAppearance(value: Appearance) {
  try { localStorage.setItem(appearanceKey, JSON.stringify(value)); } catch {}
}
// Both entrypoints use this same whitelist and run it before the first paint.
export const themeBootstrap = `(()=>{let a=${JSON.stringify(defaultAppearance)};try{const s=localStorage.getItem(${JSON.stringify(appearanceKey)});if(s){const v=JSON.parse(s);if(v&&typeof v==="object"){if(${JSON.stringify(palettes.map((p) => p.id))}.includes(v.palette))a.palette=v.palette;if(["light","dark","system"].includes(v.mode))a.mode=v.mode;}}else{const old=localStorage.getItem("tony-theme");if(old==="light"||old==="dark")a.mode=old;}}catch{}const d=document.documentElement;const t=a.mode==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):a.mode;d.dataset.palette=a.palette;d.dataset.theme=t;d.style.colorScheme=t;})();`;
