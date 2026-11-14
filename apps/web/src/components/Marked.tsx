import { splitSnippet } from '../lib/search.ts'

/** Text from the server with matched words between the snippet markers, shown as <mark>s. */
export function Marked({ text }: { text: string }) {
  return splitSnippet(text).map((part, i) =>
    part.hit ? (
      <mark key={i} className="rounded-xs bg-primary-container px-0.5 text-on-primary-container">
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  )
}
