import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

const components: Components = {
  a: ({ href, children, title }) =>
    href ? (
      <a href={href} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // A model-provided image URL must not trigger a third-party request.
  img: ({ alt }) => (
    <span className="as-markdown-image-alt">{alt || "图片"}</span>
  ),
  table: ({ children }) => (
    <div
      className="as-markdown-table"
      role="region"
      aria-label="表格"
      tabIndex={0}
    >
      <table>{children}</table>
    </div>
  ),
};

export function AssistantMarkdown({ children }: { children: string }) {
  return (
    <div className="as-markdown">
      <Markdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={components}
        skipHtml
      >
        {children}
      </Markdown>
    </div>
  );
}
