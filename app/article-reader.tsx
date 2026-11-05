"use client";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, List } from "lucide-react";
type Section = { id: string; text: string; level: number; node: HTMLHeadingElement };
export default function ArticleReader({ children, revision }: { children: ReactNode; revision: string }) {
  const article = useRef<HTMLDivElement>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [active, setActive] = useState("");
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  useEffect(() => {
    const headings = Array.from(article.current?.querySelectorAll<HTMLHeadingElement>("h1,h2,h3,h4,h5,h6") || []);
    const next = headings.map((node, i) => {
      const id = "article-section-" + (i + 1);
      node.id = id;
      const label = node.cloneNode(true) as HTMLElement;
      label.querySelectorAll(".katex-mathml").forEach((math) => math.remove());
      return { id, text: label.textContent?.replace(/\s+/g, " ").trim() || "无标题章节", level: Number(node.tagName[1]), node };
    });
    setSections(next); setExpanded(false);
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = (document.querySelector(".header")?.getBoundingClientRect().bottom || 76) + 56;
      let current = next[0]?.id || "";
      for (const section of next) {
        if (section.node.getClientRects().length && section.node.getBoundingClientRect().top <= top) current = section.id;
      }
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [revision]);
  function jump(section: Section) {
    let parent = section.node.parentElement;
    while (parent && parent !== article.current) {
      if (parent instanceof HTMLDetailsElement) parent.open = true;
      parent = parent.parentElement;
    }
    section.node.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    section.node.tabIndex = -1;
    section.node.focus({ preventScroll: true });
    setActive(section.id);
  }
  const hasToc = sections.length > 1;
  const base = Math.min(...sections.map((section) => section.level));
  return <div className={"article-layout" + (hasToc ? " has-toc" : "")}>
    <div ref={article} className="article-main">{children}</div>
    {hasToc && <aside className={"article-toc" + (expanded ? " is-expanded" : "")} aria-label="文章目录">
      <h2>目录</h2>
      <button className="toc-mobile-toggle" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}><List size={16}/>文章目录<ChevronDown size={15}/></button>
      <nav id={listId} aria-label="文章标题导航">{sections.map((section) => <button key={section.id} title={section.text} aria-label={"跳转到：" + section.text} aria-current={active === section.id ? "location" : undefined} className={active === section.id ? "active" : ""} style={{ "--toc-depth": Math.min(section.level - base, 3) } as CSSProperties} onClick={() => jump(section)}><span aria-hidden="true"/><span>{section.text}</span></button>)}</nav>
    </aside>}
  </div>;
}
