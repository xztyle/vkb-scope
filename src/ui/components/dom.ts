/** Tiny DOM helpers — keeps the component code readable without a framework. */

import type { Severity } from "../../domain/diagnostics.js";

type Child = Node | string;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Pick<HTMLElementTagNameMap[K], "className" | "id" | "title">> = {},
  children: Child[] | Child = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

const SEVERITY_TEXT: Record<Severity, string> = {
  ok: "ok",
  warn: "check",
  bad: "fault",
};

/** Set a badge element to reflect a severity, reusing the same node. */
export function severityBadge(node: HTMLElement, severity: Severity): void {
  node.className = `badge badge--${severity}`;
  node.textContent = SEVERITY_TEXT[severity];
}

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
