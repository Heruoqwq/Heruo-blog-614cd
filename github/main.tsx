import { createRoot } from "react-dom/client";
import BlogApp from "../app/blog-app";
import "../app/globals.css";
import "../app/community.css";
import "katex/dist/katex.min.css";
createRoot(document.getElementById("root")!).render(<BlogApp apiBase="https://tony-journal-heruo.prime-gleam-7947.chatgpt.site" />);
