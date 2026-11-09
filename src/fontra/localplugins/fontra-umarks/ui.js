// Tiny DOM helpers. Fontra's own `html-utils` is inside the bundle and out of
// reach for a plug-in, so this is the small part of it we need. `shared.css`
// is linked into every panel's shadow root by SimpleElement, so `fontra-button`
// and the theme variables are already there for us.

export function element(tag, attributes = {}, children = []) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (name === "class") {
      node.className = value;
    } else if (name === "dataset") {
      Object.assign(node.dataset, value);
    } else if (name.startsWith("on") && typeof value === "function") {
      node.addEventListener(name.slice(2), value);
    } else if (name === "text") {
      node.textContent = value;
    } else {
      node.setAttribute(name, value);
    }
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) {
      node.append(child);
    }
  }
  return node;
}

export function button(label, onClick, { title, disabled, className } = {}) {
  const node = element("button", {
    class: `fontra-button ${className || ""}`.trim(),
    title,
    text: label,
    onclick: onClick,
  });
  node.disabled = !!disabled;
  return node;
}

export function select(options, value, onChange, { title } = {}) {
  const node = element("select", { title, onchange: (event) => onChange(event.target.value) });
  setOptions(node, options, value);
  return node;
}

/** Replace a select's options without losing the current value when it is still there. */
export function setOptions(node, options, value) {
  node.replaceChildren(
    ...options.map(({ value: optionValue, label }) =>
      element("option", { value: optionValue, text: label ?? optionValue })
    )
  );
  if (value !== undefined && options.some((option) => option.value === value)) {
    node.value = value;
  }
}

export function textInput(placeholder, onInput, { value = "" } = {}) {
  const node = element("input", {
    type: "search",
    placeholder,
    oninput: (event) => onInput(event.target.value),
  });
  node.value = value;
  return node;
}

export function checkbox(id, label, checked, onChange) {
  const input = element("input", {
    type: "checkbox",
    id,
    onchange: (event) => onChange(event.target.checked),
  });
  input.checked = checked;
  return {
    input,
    row: element("div", { class: "umarks-row umarks-row--checkbox" }, [
      input,
      element("label", { for: id, text: label }),
    ]),
  };
}

/**
 * `node.replaceChildren(null)` appends the string "null" — unlike `element`,
 * it does not drop the empty children. This one does.
 */
export function replaceChildren(node, ...children) {
  node.replaceChildren(
    ...children
      .flat()
      .filter((child) => child !== null && child !== undefined && child !== false)
  );
}

/**
 * Put `nodes` in `parent`, in this order, touching only what differs (6b § 0):
 * a node already in its place stays where it is — it is not taken out and put
 * back, which would take the focus from a field in it, and a node that is not
 * in `nodes` any more goes.
 */
export function reconcileChildren(parent, nodes) {
  const wanted = nodes.filter((node) => node !== null && node !== undefined && node !== false);
  const keep = new Set(wanted);
  for (const child of [...parent.childNodes]) {
    if (!keep.has(child)) {
      child.remove();
    }
  }
  wanted.forEach((node, index) => {
    if (parent.childNodes[index] !== node) {
      parent.insertBefore(node, parent.childNodes[index] ?? null);
    }
  });
}

/** The element that has the focus, looked for down through the shadow roots `node` is in. */
export function focusedIn(node) {
  const active = node.getRootNode?.()?.activeElement;
  return active && node.contains(active) ? active : null;
}

/**
 * A number field as Fontra's own (the fields of Selection info, ui-form.js):
 * a text field with no arrows of its own, ↑/↓ add or take 1, with ⇧ 10, and a
 * key held down keeps counting without leaving the field. Each step is an
 * `input` and a `change`, as if typed.
 */
export function numberField(attributes = {}) {
  const node = element("input", {
    type: "text",
    inputmode: "decimal",
    spellcheck: "false",
    autocomplete: "off",
    ...attributes,
    class: `umarks-number ${attributes.class || ""}`.trim(),
  });
  node.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    event.preventDefault();
    const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
    const current = Number(node.value.trim() || node.placeholder || 0);
    const value = (Number.isFinite(current) ? current : 0) + step;
    node.value = String(Math.round(value * 1000) / 1000);
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return node;
}

/**
 * Sections in Fontra's own `ui-accordion` (fontra-webcomponents/ui-accordion.js),
 * the element the editor's panels are built of. It is a custom element the
 * editor has already defined, so it is created by its tag, without importing
 * anything from Fontra. Its items live in its shadow root, where the panel's
 * stylesheet does not reach: `stylesheet` is imported in there too.
 *
 * `items`: [{id, label, content, open}]. Returns the element.
 */
export function accordion(items, { stylesheet } = {}) {
  if (!customElements.get("ui-accordion")) {
    // not in an editor (or a Fontra without it): the sections, open, one after the other
    return element(
      "div",
      { class: "umarks-sections" },
      items.map((item) =>
        element("div", { class: "umarks-section", id: item.id }, [
          element("div", { class: "umarks-section-title", text: item.label }),
          item.content,
        ])
      )
    );
  }
  const node = document.createElement("ui-accordion");
  if (stylesheet) {
    // appendStyle, not a <link>: the accordion empties its shadow root each
    // time it renders and puts back only the styles it was given this way
    node.appendStyle(`@import url("${stylesheet}");`);
  }
  node.items = items;
  return node;
}

/** Open or close one item of an accordion made by `accordion`. */
export function setAccordionItemOpen(node, itemId, open) {
  const item = (node.items || []).find((candidate) => candidate.id === itemId);
  if (item && item.open !== open && typeof node.openCloseAccordionItem === "function") {
    node.openCloseAccordionItem(item, open);
  }
}

/**
 * A menu of Fontra's own (fontra-webcomponents/menu-panel.js, the one its
 * panels open from their « menu » icon), reached by its tag like
 * `ui-accordion`: `showMenu` itself is in the bundle. `items`:
 * [{title, callback}]; `position`: {x, y} in the window. Returns the menu, or
 * null outside an editor.
 */
export function showFontraMenu(items, position) {
  const MenuPanel = customElements.get("menu-panel");
  if (!MenuPanel) {
    return null;
  }
  MenuPanel.closeMenuPanels?.({});
  // as menu-panel.js does: inside an open dialog, the dialog's box holds it
  const dialog = document.querySelector("modal-dialog");
  const container = (dialog?.isActive?.() && dialog.shadowRoot?.querySelector(".dialog-box")) || document.body;
  const { left, top } = container.getBoundingClientRect();
  const menu = new MenuPanel(items, { position: { x: position.x - left, y: position.y - top } });
  container.appendChild(menu);
  return menu;
}

/**
 * Fontra's icon button (`icon-button`, a tabler icon), or a plain button with
 * `fallback` written on it outside an editor.
 */
export function iconButton(icon, onClick, { title, fallback = "…", dataset = {} } = {}) {
  if (!customElements.get("icon-button")) {
    return element("button", { class: "fontra-button", title, text: fallback, dataset, onclick: onClick });
  }
  // as Fontra builds it (createDomElement): `src` and `onclick` are
  // properties of icon-button — its inner button stops the click, and the
  // `src` attribute alone draws nothing (and asks the server for « undefined »)
  const node = element("icon-button", { title, dataset });
  node.src = `/tabler-icons/${icon}.svg`;
  node.onclick = onClick;
  return node;
}
