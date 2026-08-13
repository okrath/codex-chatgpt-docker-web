/**
 * Bun text imports (`import text from "./file.md" with { type: "text" }`) resolve Markdown files
 * to their string contents at runtime; this declaration gives `bunx tsc --noEmit` the same view.
 */
declare module "*.md" {
  const text: string;
  export default text;
}
