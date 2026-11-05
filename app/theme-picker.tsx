"use client";
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Monitor, Moon, Palette as PaletteIcon, RotateCcw, Sun, X } from "lucide-react";
import { appearanceKey, applyAppearance, defaultAppearance, palettes, readAppearance, saveAppearance, type Appearance, type Mode, type Palette } from "./theme";
const modes = [{ id: "light", name: "浅色", Icon: Sun }, { id: "dark", name: "深色", Icon: Moon }, { id: "system", name: "跟随系统", Icon: Monitor }] as const;
export default function ThemePicker() {
  const [appearance, setAppearance] = useState<Appearance>(defaultAppearance);
  const [resolved, setResolved] = useState("light");
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const current = useRef<Appearance>(defaultAppearance);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const colorButtons = useRef<Partial<Record<Palette, HTMLButtonElement | null>>>({});
  const modeButtons = useRef<Partial<Record<Mode, HTMLButtonElement | null>>>({});
  const panelId = useId();
  function apply(next: Appearance) {
    current.current = next;
    setAppearance(next);
    setResolved(applyAppearance(next, window.matchMedia?.("(prefers-color-scheme: dark)").matches || false));
  }
  function choose(patch: Partial<Appearance>) {
    const next = { ...current.current, ...patch };
    apply(next); saveAppearance(next);
  }
  useEffect(() => {
    setMounted(true); apply(readAppearance());
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const system = () => { if (current.current.mode === "system") apply(current.current); };
    const storage = (event: StorageEvent) => { if (event.key === appearanceKey || event.key === "tony-theme" || event.key === null) apply(readAppearance()); };
    media?.addEventListener("change", system);
    window.addEventListener("storage", storage);
    return () => { media?.removeEventListener("change", system); window.removeEventListener("storage", storage); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => colorButtons.current[current.current.palette]?.focus());
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  function colorKey(event: KeyboardEvent, index: number) {
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 }[event.key];
    if (step === undefined && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = palettes[event.key === "Home" ? 0 : event.key === "End" ? palettes.length - 1 : (index + step! + palettes.length) % palettes.length];
    choose({ palette: next.id }); colorButtons.current[next.id]?.focus();
  }
  function modeKey(event: KeyboardEvent, index: number) {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const next = modes[event.key === "Home" ? 0 : event.key === "End" ? modes.length - 1 : (index + step + modes.length) % modes.length];
    choose({ mode: next.id }); modeButtons.current[next.id]?.focus();
  }
  const selected = palettes.find((p) => p.id === appearance.palette)!;
  return <>
    <button ref={button} className={"theme-trigger " + (open ? "is-open" : "")} aria-label="选择主题" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} title={selected.name + " · " + modes.find((m) => m.id === appearance.mode)!.name} onClick={() => setOpen(!open)}><PaletteIcon size={18}/><span>主题</span><ChevronDown size={13} className="theme-chevron"/></button>
    {mounted && open && createPortal(<div ref={panel} id={panelId} className="theme-panel" role="dialog" aria-label="外观设置">
      <div className="theme-panel-heading"><div className="theme-heading-icon"><PaletteIcon size={19}/></div><h2>外观设置</h2><button className="icon-button" aria-label="关闭主题设置" onClick={() => { setOpen(false); button.current?.focus(); }}><X size={17}/></button></div>
      <div className="theme-section-label">配色主题<span>6 款配色</span></div>
      <div className="theme-palette-grid" role="radiogroup" aria-label="配色主题">{palettes.map((p, i) => <button type="button" role="radio" aria-checked={appearance.palette === p.id} aria-label={p.name} key={p.id} tabIndex={appearance.palette === p.id ? 0 : -1} ref={(node) => { colorButtons.current[p.id] = node; }} className={"theme-palette " + (appearance.palette === p.id ? "selected" : "")} onClick={() => choose({ palette: p.id })} onKeyDown={(event) => colorKey(event, i)}>
        <span className="theme-preview" aria-hidden="true" style={{ "--sample-accent": resolved === "dark" ? p.dark : p.light } as CSSProperties}><i className="theme-preview-sidebar"><b/><b/><b/></i><i className="theme-preview-content"><b/><b/><em/><em/></i></span>
        <span className="theme-option-caption"><span>{p.name}</span>{appearance.palette === p.id ? <Check size={14}/> : <i style={{ background: resolved === "dark" ? p.dark : p.light }}/>}</span>
      </button>)}</div>
      <div className="theme-section-label">外观模式</div><div className="theme-modes" role="radiogroup" aria-label="外观模式">{modes.map(({ id, name, Icon }, i) => <button key={id} role="radio" aria-checked={appearance.mode === id} tabIndex={appearance.mode === id ? 0 : -1} ref={(node) => { modeButtons.current[id] = node; }} onClick={() => choose({ mode: id })} onKeyDown={(event) => modeKey(event, i)} className={appearance.mode === id ? "selected" : ""}><Icon size={16}/>{name}</button>)}</div>
      <div className="theme-panel-footer"><span>自动保存你的选择</span><button type="button" onClick={() => choose(defaultAppearance)}><RotateCcw size={12}/>重置</button></div>
    </div>, document.body)}
  </>;
}
