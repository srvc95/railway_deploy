// Tiny DOM helpers. Every text goes through textContent / createTextNode: no innerHTML anywhere in the app.

/** @typedef {string | number | boolean | null | undefined | Node | HTMLElement | Array<unknown>} Child */

/**
 * Create an element. attrs: class, on (event map), any other key becomes an attribute (false/null/undefined skip it).
 * @param {string} tag
 * @param {Record<string, any> | null} [attrs]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  add(el, children);
  return el;
}

/** @param {HTMLElement} el @param {unknown[]} children */
function add(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) add(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

/** Replace the children of `el`. @param {HTMLElement} el @param {...any} children */
export function setChildren(el, ...children) {
  el.replaceChildren();
  add(el, children);
  return el;
}

/** @param {string} sel @param {ParentNode} [root] @returns {HTMLElement | null} */
export const $ = (sel, root = document) => /** @type {HTMLElement | null} */ (root.querySelector(sel));

/** @param {string} sel @param {ParentNode} [root] @returns {HTMLElement[]} */
export const $$ = (sel, root = document) => /** @type {HTMLElement[]} */ (Array.from(root.querySelectorAll(sel)));

/** SVG element helper. @param {string} tag @param {Record<string, string | number>} [attrs] @param {...any} children */
export function svg(tag, attrs, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children.flat()) if (c != null && c !== false) el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
