import remarkGfm from "remark-gfm";

/** Images are dropped: an <img> makes the browser fetch its URL with no click, a channel for leaking data out of any mode. */
export const SAFE_MARKDOWN = { remarkPlugins: [remarkGfm], disallowedElements: ["img"] };
