import { applicationSettingsController } from "@fontra/core/application-settings.js";
import { themeController } from "@fontra/core/theme-settings.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import Panel from "./panel.js";

export default class SettingsPanel extends Panel {
  identifier = "settings";
  inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"/><circle cx="128" cy="128" r="40" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/><path d="M41.43,178.09A99.14,99.14,0,0,1,31.36,153.8l16.78-21a81.59,81.59,0,0,1,0-9.64l-16.77-21a99.43,99.43,0,0,1,10.05-24.3l26.71-3a81,81,0,0,1,6.81-6.81l3-26.7A99.14,99.14,0,0,1,102.2,31.36l21,16.78a81.59,81.59,0,0,1,9.64,0l21-16.77a99.43,99.43,0,0,1,24.3,10.05l3,26.71a81,81,0,0,1,6.81,6.81l26.7,3a99.14,99.14,0,0,1,10.07,24.29l-16.78,21a81.59,81.59,0,0,1,0,9.64l16.77,21a99.43,99.43,0,0,1-10,24.3l-26.71,3a81,81,0,0,1-6.81,6.81l-3,26.7a99.14,99.14,0,0,1-24.29,10.07l-21-16.78a81.59,81.59,0,0,1-9.64,0l-21,16.77a99.43,99.43,0,0,1-24.3-10l-3-26.71a81,81,0,0,1-6.81-6.81Z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"/></svg>`;

  _visible = false;

  constructor(editorController) {
    super(editorController);
  }

  getContentElement() {
    this._container = html.div({
      class: "panel-section panel-section--scrollable",
      style: "height: 100%; box-sizing: border-box;",
    });
    return html.div({ class: "panel" }, [this._container]);
  }

  async toggle(on, focus) {
    this._visible = on;
    if (on) {
      this._render();
    }
  }

  _render() {
    this._container.innerHTML = "";

    const t = (key, fallback) => {
      const res = translate(key);
      return res === key ? fallback : res;
    };

    // ── Section: Theme ──────────────────────────────────────────────────
    this._container.appendChild(this._makeHeader(t("sidebar.settings.theme", "Theme")));
    this._container.appendChild(
      this._makeCheckbox(
        "setting-theme-dark",
        t("sidebar.settings.dark-mode", "Dark Mode"),
        themeController.model.theme === "dark",
        (checked) => {
          themeController.model.theme = checked ? "dark" : "light";
        }
      )
    );

    // ── Section: Toolbar ────────────────────────────────────────────────
    this._container.appendChild(
      this._makeHeader(t("sidebar.settings.toolbar", "Toolbar"))
    );
    this._container.appendChild(
      this._makeCheckbox(
        "setting-toolbar-bottom",
        t("sidebar.settings.toolbar-bottom", "Toolbar at Bottom"),
        applicationSettingsController.model.toolsMenuPosition === "bottom",
        (checked) => {
          applicationSettingsController.model.toolsMenuPosition = checked
            ? "bottom"
            : "top";
        }
      )
    );

    // ── Section: Editor Appearance (Visualization Layers) ───────────────
    this._container.appendChild(
      this._makeHeader(
        t("action-topics.glyph-editor-appearance", "Editor Appearance")
      )
    );
    const layerDefs = this.editorController.visualizationLayers.definitions.filter(
      (layer) => layer.userSwitchable
    );
    for (const layerDef of layerDefs) {
      this._container.appendChild(
        this._makeCheckbox(
          `setting-layer-${layerDef.identifier}`,
          t(layerDef.name, layerDef.name),
          !!this.editorController.visualizationLayersSettings.model[layerDef.identifier],
          (checked) => {
            this.editorController.visualizationLayersSettings.model[
              layerDef.identifier
            ] = checked;
          }
        )
      );
    }

    // ── Section: Application Settings ───────────────────────────────────
    this._container.appendChild(
      this._makeHeader(t("sidebar.settings.application", "Application Settings"))
    );

    const boolSettings = [
      {
        key: "rectSelectLiveModifierKeys",
        label: t(
          "sidebar.settings.rectSelectLiveModifierKeys",
          "Live Modifier Keys for Rect Select"
        ),
      },
      {
        key: "alwaysShowGlobalAxesInComponentLocation",
        label: t(
          "sidebar.settings.alwaysShowGlobalAxesInComponentLocation",
          "Always Show Global Axes in Component Location"
        ),
      },
      {
        key: "sortComponentLocationGlyphAxes",
        label: t(
          "sidebar.settings.sortComponentLocationGlyphAxes",
          "Sort Component Location Glyph Axes"
        ),
      },
      {
        key: "disableAdHocMarks",
        label: t("sidebar.settings.disableAdHocMarks", "Disable Ad-Hoc Marks"),
      },
      {
        key: "shapingDebuggerShowIneffectiveItems",
        label: t(
          "sidebar.settings.shapingDebuggerShowIneffectiveItems",
          "Show Ineffective Items in Shaping Debugger"
        ),
      },
    ];

    for (const { key, label } of boolSettings) {
      this._container.appendChild(
        this._makeCheckbox(
          `setting-app-${key}`,
          label,
          !!applicationSettingsController.model[key],
          (checked) => {
            applicationSettingsController.model[key] = checked;
          }
        )
      );
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  _makeHeader(title) {
    return html.div(
      {
        style:
          "font-weight: 600; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.6; margin-top: 1.2em; margin-bottom: 0.4em;",
      },
      [title]
    );
  }

  _makeCheckbox(id, label, checked, onChange) {
    const checkbox = html.input({
      type: "checkbox",
      id,
      onchange: (e) => onChange(e.target.checked),
    });
    checkbox.checked = checked;

    const lbl = html.label({ for: id, style: "cursor: pointer;" }, [label]);

    return html.div(
      { class: "panel-section--checkbox", style: "margin-bottom: 0.35em;" },
      [checkbox, lbl]
    );
  }
}

customElements.define("panel-settings", SettingsPanel);
