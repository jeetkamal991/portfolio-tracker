"use client";

import ReactMarkdown from "react-markdown";
import { SAFE_MARKDOWN } from "@/lib/view/markdown";

/** The assistant's reply as formatted text; tables scroll sideways instead of widening the page. */
export function Answer({ text }: { text: string }) {
  return (
    <div className="text-sm leading-relaxed text-[var(--text)] [&_a]:text-[var(--up)] [&_a]:underline [&_code]:rounded [&_code]:bg-[var(--panel-2)] [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-2 [&_ul]:list-disc">
      <ReactMarkdown
        {...SAFE_MARKDOWN}
        components={{
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse font-mono text-xs tabular-nums">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="whitespace-nowrap border-b border-[var(--border)] px-2 py-1 text-left font-medium text-[var(--muted)]">{children}</th>,
          td: ({ children }) => <td className="whitespace-nowrap border-b border-[var(--border)] px-2 py-1">{children}</td>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
