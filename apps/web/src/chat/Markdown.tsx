import { memo } from 'react'
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
  pre: ({ node: _, ...props }) => (
    <pre
      className="my-3 overflow-x-auto rounded-md bg-surface-2 p-3.5 font-mono text-small leading-relaxed [&_code]:bg-transparent [&_code]:p-0"
      {...props}
    />
  ),
  code: ({ node: _, ...props }) => (
    <code className="rounded-xs bg-surface-2 px-1.5 py-0.5 font-mono text-[0.875em]" {...props} />
  ),
  table: ({ node: _, ...props }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-small" {...props} />
    </div>
  ),
  th: ({ node: _, ...props }) => (
    <th className="border-b border-line px-2.5 py-1.5 text-left font-semibold" {...props} />
  ),
  td: ({ node: _, ...props }) => (
    <td className="border-b border-line px-2.5 py-1.5 align-top" {...props} />
  ),
}

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
