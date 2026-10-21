import { Check, Copy } from 'lucide-react'
import { isValidElement, memo, type ReactNode, useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Element styles for model replies. react-markdown renders no raw HTML (there is no rehype-raw), so
 * a reply can't inject markup; links always open in a new tab without a referrer.
 */
const components: Components = {
  p: ({ node: _, ...props }) => <p className="my-0 [&:not(:first-child)]:mt-3" {...props} />,
  a: ({ node: _, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-accent-ink underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
    />
  ),
  ul: ({ node: _, ...props }) => (
    <ul className="my-3 flex list-disc flex-col gap-1 pl-5 marker:text-text-3" {...props} />
  ),
  ol: ({ node: _, ...props }) => (
    <ol className="my-3 flex list-decimal flex-col gap-1 pl-5 marker:text-text-2" {...props} />
  ),
  h1: ({ node: _, ...props }) => <h3 className="mt-5 mb-2 text-heading" {...props} />,
  h2: ({ node: _, ...props }) => <h3 className="mt-5 mb-2 text-heading" {...props} />,
  h3: ({ node: _, ...props }) => <h4 className="mt-4 mb-1.5 font-semibold" {...props} />,
  h4: ({ node: _, ...props }) => <h5 className="mt-4 mb-1.5 font-semibold" {...props} />,
  blockquote: ({ node: _, ...props }) => (
    <blockquote className="my-3 border-l-2 border-line pl-3.5 text-text-2" {...props} />
  ),
  hr: () => <hr className="my-5 border-line" />,
  pre: ({ node: _, children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ node: _, ...props }) => (
    <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-[0.875em]" {...props} />
  ),
  table: ({ node: _, ...props }) => (
    <div className="my-4 overflow-x-auto rounded-card bg-surface shadow-[0_0_0_1px_var(--line)]">
      <table className="w-full border-collapse text-small" {...props} />
    </div>
  ),
  th: ({ node: _, ...props }) => (
    <th
      className="border-b border-line bg-surface-2 px-4 py-2.5 text-left font-semibold"
      {...props}
    />
  ),
  td: ({ node: _, ...props }) => (
    <td
      className="border-b border-line px-4 py-2.5 align-top [tr:last-child>&]:border-b-0"
      {...props}
    />
  ),
}

/** `language-ts` on the inner `<code>` → "ts". */
function languageOf(children: ReactNode): string | undefined {
  if (!isValidElement<{ className?: unknown }>(children)) return undefined
  const cls = children.props.className
  return typeof cls === 'string' ? /language-([\w+#-]+)/.exec(cls)?.[1] : undefined
}

/** A fenced code block: a round card with the language and a copy button. */
function CodeBlock({ children }: { children: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])
  const language = languageOf(children)
  const copy = () => {
    const text = pre.current?.textContent ?? ''
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(true),
      () => {},
    )
  }
  return (
    <div className="my-4 overflow-hidden rounded-card bg-surface shadow-[0_0_0_1px_var(--line)]">
      <div className="flex h-10 items-center justify-between gap-2 pr-1.5 pl-4">
        <span className="font-mono text-micro text-text-2">{language ?? 'code'}</span>
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy code'}
          className="flex h-8 items-center gap-1.5 rounded-pill px-2.5 text-micro text-text-2 transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-text active:scale-[.97] pointer-coarse:h-11"
        >
          {copied ? (
            <Check className="size-3.5" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          <span aria-hidden="true">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre
        ref={pre}
        className="overflow-x-auto px-4 pt-0.5 pb-4 font-mono text-small leading-relaxed [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[1em]"
      >
        {children}
      </pre>
    </div>
  )
}

const COPIED_MS = 1600

const plugins = [remarkGfm]

/** A model reply rendered as GitHub-flavoured markdown. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words">
      <ReactMarkdown remarkPlugins={plugins} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
})
