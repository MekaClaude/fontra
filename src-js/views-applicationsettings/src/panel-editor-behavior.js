import { applicationSettingsController } from "@fontra/core/application-settings.js";
import * as html from "@fontra/core/html-utils.js";
import { addStyleSheet } from "@fontra/core/html-utils.js";
import { MultiPanelBasePanel } from "@fontra/core/multi-panel.js";
import { labeledCheckbox, labeledPopupSelect } from "@fontra/core/ui-utils.js";

addStyleSheet(`
  .fontra-ui-editor-behavior-panel-card {
    background-color: var(--ui-element-background-color);
    border-radius: 0.5em;
    padding: 1em;
  }
  `);

export class EditorBehaviorPanel extends MultiPanelBasePanel {
  static title = "application-settings.editor-behavior.title";
  static id = "editor-behavior-panel";

  async setupUI() {
    this.panelElement.innerHTML = "";
    const container = html.createDomElement("div", {
      class: "fontra-ui-editor-behavior-panel-card",
    });

    container.appendChild(
      labeledCheckbox(
        "Rect-select live modifier keys",
        applicationSettingsController,
        "rectSelectLiveModifierKeys",
        {}
      )
    );

    const menuPositionItems = [
      { label: "Top", value: "top" },
      { label: "Bottom", value: "bottom" },
    ];

    const menuPositionRow = labeledPopupSelect(
      "Tools menu position",
      applicationSettingsController,
      "toolsMenuPosition",
      menuPositionItems,
      {}
    );
    menuPositionRow.forEach((element) => container.appendChild(element));
    container.lastElementChild.style.marginTop = "1em";

    this.panelElement.appendChild(container);
  }
}
