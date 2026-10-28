import { memo, useMemo } from "react";
import { Marked } from "marked";
import DOMPurify from "dompurify";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const marked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? "").split(/\s/)[0];
      return `<div class="code-block"><div class="code-head"><span>${escapeHtml(language || "code")}</span><button type="button" class="copy-code" aria-label="Copy code">Copy</button></div><pre><code>${escapeHtml(text)}</code></pre></div>`;
    },
    link({ href, text }) {
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
}

/** Handles "Copy" buttons inside rendered code blocks via event delegation. */
function onClick(e: React.MouseEvent<HTMLDivElement>) {
  const btn = (e.target as HTMLElement).closest(".copy-code") as HTMLButtonElement | null;
  if (!btn) return;
  const code = btn.closest(".code-block")?.querySelector("code")?.textContent ?? "";
  navigator.clipboard?.writeText(code).then(
    () => {
      btn.textContent = "Copied";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    },
    () => (btn.textContent = "Copy failed"),
  );
}

export const Markdown = memo(function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  // Close an unterminated code fence while streaming so it renders cleanly.
  const source = streaming && (text.match(/```/g)?.length ?? 0) % 2 === 1 ? text + "\n```" : text;
  const html = useMemo(() => renderMarkdown(source), [source]);
  return <div className="markdown" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />;
});
