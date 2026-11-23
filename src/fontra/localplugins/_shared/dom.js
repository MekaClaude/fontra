// Shared DOM helpers for the local plugins.
//
// Plugins are loaded via a native dynamic import and may only use relative
// imports inside their own folder, so this module is reached as
// `../_shared/dom.js` from a plugin's panel module. Keeping a single copy
// here prevents the silent drift that previously broke the triangle-guardian
// panel (its `el()` did not flatten array children).

const attrExceptions = {
  for: "htmlFor",
  class: "className",
  tabindex: "tabIndex",
  colspan: "colSpan",
  rowspan: "rowSpan",
  readonly: "readOnly",
  maxlength: "maxLength",
};

export function el(tagName, attributes, children) {
  const element = document.createElement(tagName);
  for (const [key, value] of Object.entries(attributes || {})) {
    if (key === undefined || value === undefined || value === null) {
      continue;
    }
    if (key.slice(0, 5) === "data-") {
      element.dataset[key.slice(5)] = value;
    } else {
      element[attrExceptions[key] || key] = value;
    }
  }
  // `children` is the rest-argument list of the helpers below, so a call
  // site usually passes ONE array of children: div(attrs, [a, b]).
  const childList = Array.isArray(children)
    ? children.flat()
    : children === undefined || children === null
      ? []
      : [children];
  for (const child of childList) {
    element.append(child);
  }
  return element;
}

export const div = (attrs, ...children) => el("div", attrs, children);
export const span = (attrs, ...children) => el("span", attrs, children);
export const label = (attrs, ...children) => el("label", attrs, children);
export const input = (attrs) => el("input", attrs);
export const button = (attrs, ...children) => el("button", attrs, children);
export const select = (attrs, ...children) => el("select", attrs, children);
export const option = (attrs, ...children) => el("option", attrs, children);
