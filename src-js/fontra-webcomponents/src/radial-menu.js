// Radial "Quick Menu" — a circular, pointer-local command menu.
//
// Inspired by the Affinity Quick Menu, Blender's pie menus and the
// Krita popup palette. The menu opens at the pointer position and is
// split into an inner ring of everyday essentials and an outer ring of
// context-dependent commands. Slots are wired to the action registry,
// so enabled state, titles and shortcuts are always up to date.

import {
  canPerformAction,
  doPerformAction,
  getActionTitle,
  getShortCutRepresentationFromActionIdentifier,
} from "@fontra/core/actions.js";
import * as html from "@fontra/core/html-utils.js";
import { SimpleElement } from "@fontra/core/html-utils.js";
import { InlineSVG } from "./inline-svg.js";
import { themeColorCSS } from "./theme-support.js";

const SIZE = 336;
const CENTER = SIZE / 2;
const ARC_STEPS = 16;
const DEG_TO_RAD = Math.PI / 180;

// Distance the pointer must travel before a press turns into a flick
// gesture (Blender-style pie selection): below this it stays a plain click.
const DRAG_THRESHOLD = 14;

const INNER_RING = { rIn: 36, rOut: 90, gap: 3.5 };
const OUTER_RING = { rIn: 94, rOut: 158, gap: 3.5 };

const colors = {
  "background-color": ["#f4f4f6", "#26262e"],
  "foreground-color": ["#24242a", "#f2f2f7"],
  "segment-color": ["#ffffff", "#31313c"],
  "segment-hover-color": ["var(--fontra-red-color)", "var(--fontra-red-color)"],
  "segment-hover-foreground-color": ["#ffffff", "#ffffff"],
  "center-color": ["#e9e9ed", "#1b1b21"],
  "border-color": ["#0000001f", "#ffffff1a"],
};

function sectorPolygon(rOut, rIn, a0, a1) {
  // Angles in degrees, 0 = top, clockwise. Returns a CSS polygon() for clip-path.
  const points = [];
  for (let i = 0; i <= ARC_STEPS; i++) {
    const a = ((a0 + ((a1 - a0) * i) / ARC_STEPS - 90) * Math.PI) / 180;
    points.push([CENTER + rOut * Math.cos(a), CENTER + rOut * Math.sin(a)]);
  }
  for (let i = ARC_STEPS; i >= 0; i--) {
    const a = ((a0 + ((a1 - a0) * i) / ARC_STEPS - 90) * Math.PI) / 180;
    points.push([CENTER + rIn * Math.cos(a), CENTER + rIn * Math.sin(a)]);
  }
  return `polygon(${points
    .map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`)
    .join(",")})`;
}

function sectorMidpoint(a0, a1, radius) {
  const a = (((a0 + a1) / 2 - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(a), y: CENTER + radius * Math.sin(a) };
}

export class RadialMenu extends SimpleElement {
  static openMenu = null;

  static colors = colors;

  static styles = `
    ${themeColorCSS(colors)}

    :host {
      position: fixed;
      z-index: 10000;
      left: 0;
      top: 0;
      color: var(--foreground-color);
      font-family: inherit;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
    }

    .radial-menu {
      position: relative;
      width: ${SIZE}px;
      height: ${SIZE}px;
      filter: drop-shadow(0 10px 30px rgba(0, 0, 0, 0.4));
    }

    .backdrop {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }

    .segment {
      position: absolute;
      inset: 0;
      margin: 0;
      padding: 0;
      border: none;
      outline: none;
      display: block;
      background: var(--segment-color);
      color: var(--foreground-color);
      cursor: pointer;
      transition:
        background-color 90ms ease,
        color 90ms ease;
    }

    .segment:hover,
    .segment:focus-visible {
      background: var(--segment-hover-color);
      color: var(--segment-hover-foreground-color);
      z-index: 2;
    }

    .segment.disabled {
      opacity: 0.3;
      cursor: default;
    }

    .segment.disabled:hover,
    .segment.disabled:focus-visible {
      background: var(--segment-color);
      color: var(--foreground-color);
    }

    /* Candidate highlighted by an in-progress flick gesture. Placed after
       the disabled rules so a disabled segment keeps its dimmed look. */
    .segment.gesture-target {
      background: var(--segment-hover-color);
      color: var(--segment-hover-foreground-color);
      z-index: 2;
    }

    .segment.disabled.gesture-target {
      background: var(--segment-color);
      color: var(--foreground-color);
    }

    .segment-content {
      position: absolute;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    .segment-icon {
      display: flex;
    }

    .segment-icon inline-svg {
      display: flex;
      width: 100%;
      height: 100%;
    }

    .segment-icon inline-svg svg {
      width: 100%;
      height: 100%;
      fill: currentColor;
    }

    .segment.inner .segment-icon {
      width: 30px;
      height: 30px;
    }

    .segment.outer .segment-icon {
      width: 23px;
      height: 23px;
    }

    .segment-label {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
      text-shadow: none;
    }

    .segment.inner .segment-label {
      display: none;
    }

    .center-circle {
      position: absolute;
      left: ${CENTER}px;
      top: ${CENTER}px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0;
      background: var(--center-color);
      border: 1px solid var(--border-color);
      cursor: pointer;
    }

    .center-circle:hover {
      filter: brightness(1.08);
    }

    .center-letter {
      font-size: 17px;
      font-weight: 800;
      line-height: 1;
      opacity: 0.85;
    }

    .center-letter.center-letter-title {
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.02em;
      text-align: center;
      padding: 0 4px;
    }

    .center-hint {
      font-size: 7px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      opacity: 0.45;
      margin-top: 2px;
    }
  `;

  constructor(menuModel, options = {}) {
    super();
    this.menuModel = menuModel;
    this.position = options.position ?? { x: 120, y: 120 };
    this.centerLabel = options.centerLabel ?? "";
    this.centerHint = options.centerHint ?? "esc";
    this.ariaLabel = options.ariaLabel ?? "";
    this.closeOnAction = options.closeOnAction ?? true;
    this.onClose = options.onClose;
    this._dismissed = false;
    this._previousFocus = null;
    this._gesture = null;
    this._gestureTargetEl = null;
    this._swallowNextClick = false;
    this._build();
  }

  connectedCallback() {
    this._previousFocus = document.activeElement;
    this.place();
    this._animateIn();
    window.addEventListener("pointerdown", this._outsidePointerDown, true);
    window.addEventListener("keydown", this._keyDown, true);
    window.addEventListener("blur", this._windowBlur);
    window.addEventListener("resize", this._windowResize);
    this.addEventListener("pointerdown", this._gesturePointerDown);
    // Move focus to the first available segment, so the menu is usable
    // with the keyboard right away (Tab / Enter) and is announced by
    // screen readers.
    this.shadowRoot.querySelector(".segment:not(.disabled)")?.focus();
  }

  disconnectedCallback() {
    window.removeEventListener("pointerdown", this._outsidePointerDown, true);
    window.removeEventListener("keydown", this._keyDown, true);
    window.removeEventListener("blur", this._windowBlur);
    window.removeEventListener("resize", this._windowResize);
    this.removeEventListener("pointerdown", this._gesturePointerDown);
    this._removeGestureListeners();
    this._gesture = null;
    this._setGestureTarget(null);
  }

  dismiss() {
    if (this._dismissed) {
      // Guard against a double dismiss (Escape + blur, an explicit call
      // plus a stale reference, …): onClose must fire at most once.
      return;
    }
    this._dismissed = true;
    if (RadialMenu.openMenu === this) {
      RadialMenu.openMenu = null;
    }
    this.parentElement?.removeChild(this);
    const previousFocus = this._previousFocus;
    this.onClose?.();
    if (previousFocus?.isConnected && typeof previousFocus.focus === "function") {
      previousFocus.focus();
    }
  }

  _windowBlur = () => {
    this.dismiss();
  };

  // The menu is clamped to the viewport when it opens; if the window is
  // resized while it is open, it has to be placed again, or part of it ends
  // up off screen.
  _windowResize = () => {
    this.place();
  };

  _outsidePointerDown = (event) => {
    if (event.composedPath?.().includes(this)) {
      return;
    }
    this.dismiss();
  };

  _keyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.dismiss();
      return;
    }
    if (this._navigate(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  // Keyboard navigation around the rings.
  //
  // A radial menu is navigated with the arrow keys, not with Tab: with
  // thirteen segments, Tab means thirteen presses to get back to where you
  // were. Left/Right walk the current ring, Up/Down move between the two
  // rings, and the centre disc names the segment that has the focus.
  _navigate(event) {
    const rings = this._rings;
    if (!rings) {
      return false;
    }
    const focused = this.shadowRoot.activeElement;
    let ringName = null;
    let index = -1;
    for (const [name, segments] of Object.entries(rings)) {
      const position = segments.indexOf(focused);
      if (position >= 0) {
        ringName = name;
        index = position;
        break;
      }
    }
    if (ringName === null) {
      return false;
    }
    const segments = rings[ringName];
    let target = null;
    switch (event.key) {
      case "ArrowRight":
        target = segments[(index + 1) % segments.length];
        break;
      case "ArrowLeft":
        target = segments[(index - 1 + segments.length) % segments.length];
        break;
      case "ArrowUp":
        target = this._segmentInRing("outer", ringName, index);
        break;
      case "ArrowDown":
        target = this._segmentInRing("inner", ringName, index);
        break;
      case "Home":
        target = segments[0];
        break;
      case "End":
        target = segments[segments.length - 1];
        break;
      default:
        return false;
    }
    if (!target) {
      return false;
    }
    target.focus();
    return true;
  }

  // The segment at the same position in another ring, clamped to that ring.
  _segmentInRing(ringName, fromRingName, index) {
    const segments = this._rings?.[ringName];
    if (!segments?.length) {
      return null;
    }
    if (ringName === fromRingName) {
      return segments[Math.min(index, segments.length - 1)];
    }
    return segments[Math.min(index, segments.length - 1)];
  }

  // --- Flick gesture (Blender-style pie selection) ----------------------
  //
  // Press inside the menu, drag across a segment and release: the segment
  // under the pointer is executed. A press that stays under DRAG_THRESHOLD
  // is a plain click and falls through to the button's own click handler.

  _gesturePointerDown = (event) => {
    if (event.button !== 0 || this._dismissed) {
      return;
    }
    this._gesture = {
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    };
    window.addEventListener("pointermove", this._gesturePointerMove);
    window.addEventListener("pointerup", this._gesturePointerUp);
    window.addEventListener("pointercancel", this._gesturePointerCancel);
    // Keep bubbling listeners on window from ever seeing menu presses
    // (the old per-segment handlers used to stop propagation here).
    event.stopPropagation();
  };

  _removeGestureListeners = () => {
    window.removeEventListener("pointermove", this._gesturePointerMove);
    window.removeEventListener("pointerup", this._gesturePointerUp);
    window.removeEventListener("pointercancel", this._gesturePointerCancel);
  };

  _gesturePointerMove = (event) => {
    const gesture = this._gesture;
    if (!gesture) {
      return;
    }
    if (!gesture.dragging) {
      const distance = Math.hypot(
        event.clientX - gesture.startX,
        event.clientY - gesture.startY
      );
      if (distance < DRAG_THRESHOLD) {
        return;
      }
      gesture.dragging = true;
    }
    this._setGestureTarget(this._hitTest(event.clientX, event.clientY));
  };

  _gesturePointerUp = (event) => {
    const gesture = this._gesture;
    this._removeGestureListeners();
    this._gesture = null;
    if (!gesture) {
      return;
    }
    if (!gesture.dragging) {
      // Plain press: the click on the segment (if any) takes it from here.
      return;
    }
    const hit = this._hitTest(event.clientX, event.clientY);
    this._setGestureTarget(null);
    if (!hit) {
      // Released in the center, in a ring gap or outside the menu.
      this.dismiss();
      return;
    }
    const slot = hit.slot;
    const canRun =
      slot.enabled !== false &&
      (!slot.actionIdentifier || canPerformAction(slot.actionIdentifier));
    if (canRun) {
      // If the press started on this very segment, the browser will fire a
      // click on it right after this handler: swallow that leftover click
      // so the action does not run twice.
      const downHit = this._hitTest(gesture.startX, gesture.startY);
      if (downHit && downHit.ring === hit.ring && downHit.index === hit.index) {
        this._swallowNextClick = true;
      }
      this._execute(slot);
    } else {
      // The gesture was deliberate, but the target is unavailable: close
      // instead of leaving the menu open on a no-op.
      this.dismiss();
    }
  };

  _gesturePointerCancel = () => {
    this._removeGestureListeners();
    this._gesture = null;
    this._setGestureTarget(null);
  };

  _setGestureTarget(hit) {
    const element = hit
      ? this.shadowRoot.querySelector(`.segment.${hit.ring}[data-index="${hit.index}"]`)
      : null;
    if (element === this._gestureTargetEl) {
      return;
    }
    this._gestureTargetEl?.classList.remove("gesture-target");
    element?.classList.add("gesture-target");
    this._gestureTargetEl = element;
  }

  _hitTest(clientX, clientY) {
    // Geometric hit-test in menu coordinates: ring by radius, slot by
    // angle (0 = top, clockwise — same convention as sectorPolygon()).
    // The placed position comes from style.left/top, not from a bounding
    // rect: the open animation briefly scales the host, which would skew
    // rect-based math for anyone flicking within the first 170ms.
    const x = clientX - (parseFloat(this.style.left) || 0) - CENTER;
    const y = clientY - (parseFloat(this.style.top) || 0) - CENTER;
    const radius = Math.hypot(x, y);
    let ringName = null;
    if (radius >= INNER_RING.rIn && radius <= INNER_RING.rOut) {
      ringName = "inner";
    } else if (radius >= OUTER_RING.rIn && radius <= OUTER_RING.rOut) {
      ringName = "outer";
    } else {
      return null;
    }
    const slots = this.menuModel?.[ringName];
    if (!slots?.length) {
      return null;
    }
    let angle = (Math.atan2(x, -y) * 180) / Math.PI;
    if (angle < 0) {
      angle += 360;
    }
    const slice = 360 / slots.length;
    const index = Math.min(slots.length - 1, Math.floor(angle / slice));
    return { ring: ringName, index, slot: slots[index] };
  }

  place() {
    // Center the menu on the pointer, clamped to the viewport. The max()
    // around the upper bound keeps the clamp sane for viewports smaller
    // than the menu itself.
    const x = Math.round(this.position.x - SIZE / 2);
    const y = Math.round(this.position.y - SIZE / 2);
    const maxX = Math.max(8, window.innerWidth - SIZE - 8);
    const maxY = Math.max(8, window.innerHeight - SIZE - 8);
    const clampedX = Math.min(Math.max(8, x), maxX);
    const clampedY = Math.min(Math.max(8, y), maxY);
    this.style.left = `${clampedX}px`;
    this.style.top = `${clampedY}px`;
  }

  _animateIn() {
    this.animate(
      [
        { transform: "scale(0.55)", opacity: 0 },
        { transform: "scale(1.06)", opacity: 1, offset: 0.72 },
        { transform: "scale(1)", opacity: 1 },
      ],
      { duration: 170, easing: "cubic-bezier(0.2, 1.3, 0.4, 1)", fill: "none" }
    );
  }

  _build() {
    const container = html.div({ class: "radial-menu" });
    container.setAttribute("role", "group");
    if (this.ariaLabel) {
      container.setAttribute("aria-label", this.ariaLabel);
    }

    // Backdrop: disc + ring separators, painted behind the segments.
    const backdrop = htmlToSVG(`
      <svg class="backdrop" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
        <circle cx="${CENTER}" cy="${CENTER}" r="${OUTER_RING.rOut + 2}" fill="var(--background-color)" stroke="var(--border-color)" stroke-width="1"/>
        <circle cx="${CENTER}" cy="${CENTER}" r="${(INNER_RING.rOut + OUTER_RING.rIn) / 2}" fill="none" stroke="var(--border-color)" stroke-width="1"/>
        <circle cx="${CENTER}" cy="${CENTER}" r="${INNER_RING.rIn - 2}" fill="none" stroke="var(--border-color)" stroke-width="1"/>
      </svg>
    `);
    container.appendChild(backdrop);

    const { inner, outer } = this.menuModel;
    // The segments of each ring, in the order they are drawn: the keyboard
    // navigation walks these.
    this._rings = { inner: [], outer: [] };
    this._addRing(container, inner, INNER_RING, "inner");
    this._addRing(container, outer, OUTER_RING, "outer");

    // Center disc: shows the trigger key as a subtle hint, and the name of
    // the segment that has the focus while the menu is navigated by keyboard.

    this._centerLetter = html.div({ class: "center-letter" }, [
      this.centerLabel || " ",
    ]);
    // The centre disc closes the menu: it is the one part of the menu that
    // is not a command, so it is the natural "cancel" affordance.
    const centerCircle = html.div({ class: "center-circle" }, [
      this._centerLetter,
      html.div({ class: "center-hint" }, [this.centerHint]),
    ]);
    centerCircle.addEventListener("click", (event) => {
      event.stopPropagation();
      this.dismiss();
    });
    container.appendChild(centerCircle);

    container.addEventListener("focusout", (event) => {
      // Only when the focus leaves the menu entirely, not when it moves from
      // one segment to the next.
      if (!event.currentTarget.contains(event.relatedTarget)) {
        this._restoreCenterLabel();
      }
    });

    this.shadowRoot.appendChild(container);
  }

  _addRing(container, slots, ring, ringName) {
    if (!slots?.length) {
      return;
    }
    const { rIn, rOut, gap } = ring;
    const slice = 360 / slots.length;
    for (const [index, slot] of slots.entries()) {
      const a0 = index * slice + gap / 2;
      const a1 = (index + 1) * slice - gap / 2;
      const enabled = slot.enabled !== false;
      const title = this._titleFor(slot);
      const mid = sectorMidpoint(a0, a1, (rIn + rOut) / 2);

      const content = html.span(
        { class: "segment-content", style: `left: ${mid.x}px; top: ${mid.y}px` },
        [
          slot.icon
            ? html.span({ class: "segment-icon" }, [new InlineSVG(slot.icon)])
            : null,
          html.span({ class: "segment-label" }, [slot.shortTitle ?? ""]),
        ]
      );

      const button = html.createDomElement(
        "button",
        {
          "class": `segment ${ringName}${enabled ? "" : " disabled"}`,
          "style": `clip-path: ${sectorPolygon(rOut, rIn, a0, a1)}`,
          title,
          "data-index": String(index),
          "onclick": (event) => {
            event.stopImmediatePropagation();
            event.preventDefault();
            if (this._swallowNextClick) {
              // Leftover click generated by a flick that started and ended
              // on this same segment: the action already ran on pointerup.
              this._swallowNextClick = false;
              return;
            }
            this._execute(slot);
          },
        },
        [content]
      );
      button.setAttribute("aria-label", title);
      // The inner ring has no visible labels, so the centre disc names the
      // segment that has the focus.
      button.addEventListener("focus", () => this._showCenterTitle(title));
      if (!enabled) {
        // Keep the native `disabled` attribute off, so the tooltip (title)
        // still shows on unavailable segments; the click path is guarded in
        // _execute() anyway.
        button.setAttribute("aria-disabled", "true");
      }
      container.appendChild(button);
      this._rings[ringName].push(button);
    }
  }

  // The centre disc names the segment that has the focus, so that the inner
  // ring — which has no visible labels — is still readable by keyboard.
  _showCenterTitle(title) {
    if (!this._centerLetter) {
      return;
    }
    const text = (title || "").split("  (")[0];
    this._centerLetter.textContent = text.length > 12 ? `${text.slice(0, 11)}…` : text;
    this._centerLetter.classList.add("center-letter-title");
  }

  _restoreCenterLabel() {
    if (!this._centerLetter) {
      return;
    }
    this._centerLetter.textContent = this.centerLabel || " ";
    this._centerLetter.classList.remove("center-letter-title");
  }

  _titleFor(slot) {
    if (slot.actionIdentifier) {
      const title = getActionTitle(slot.actionIdentifier);
      const shortcut = getShortCutRepresentationFromActionIdentifier(
        slot.actionIdentifier
      );
      return shortcut ? `${title}  (${shortcut})` : title;
    }
    return slot.shortTitle ?? "";
  }

  _execute(slot) {
    if (this._dismissed) {
      // The menu may already be gone (flick on pointerup, then the click
      // the browser synthesizes for the same segment): never run twice.
      return;
    }
    if (slot.enabled === false) {
      return;
    }
    if (slot.actionIdentifier) {
      if (!canPerformAction(slot.actionIdentifier)) {
        return;
      }
      doPerformAction(slot.actionIdentifier);
    } else {
      slot.callback?.();
    }
    if (this.closeOnAction) {
      this.dismiss();
    }
  }
}

function htmlToSVG(svgText) {
  const template = document.createElement("template");
  template.innerHTML = svgText.trim();
  return template.content.firstChild;
}

export function showRadialMenu(menuModel, position, options) {
  if (RadialMenu.openMenu) {
    RadialMenu.openMenu.dismiss();
  }
  const menu = new RadialMenu(menuModel, { ...options, position });
  RadialMenu.openMenu = menu;
  document.body.appendChild(menu);
  return menu;
}

customElements.define("radial-menu", RadialMenu);
