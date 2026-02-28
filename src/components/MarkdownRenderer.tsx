"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-6 border-b border-border pb-3 text-2xl font-bold text-foreground">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-10 border-b border-border/50 pb-2 text-xl font-bold text-foreground">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-6 text-lg font-semibold text-foreground">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-2 mt-4 text-base font-semibold text-foreground">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="mb-3 text-sm leading-relaxed text-muted">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-primary underline decoration-primary/30 hover:decoration-primary"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-muted">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-3 list-decimal space-y-1 pl-5 text-sm text-muted">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  hr: () => <hr className="my-8 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-primary/50 pl-4 text-sm italic text-muted">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-border bg-card text-left text-xs font-semibold text-foreground">
      {children}
    </thead>
  ),
  tbody: ({ children }) => <tbody className="text-muted">{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-border/30">{children}</tr>
  ),
  th: ({ children }) => <th className="px-3 py-2">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2">{children}</td>,
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-surface p-4 text-xs leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return <code className="font-mono text-foreground">{children}</code>;
    }
    return (
      <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-accent">
        {children}
      </code>
    );
  },
};

interface Props {
  content: string;
}

export function MarkdownRenderer({ content }: Props) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
