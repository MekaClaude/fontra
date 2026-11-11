import { doPerformAction } from "@fontra/core/actions.js";
import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { rectSize } from "@fontra/core/rectangle.ts";
import { Transform } from "@fontra/core/transform.js";
import { Form } from "@fontra/web-components/ui-form.js";
import Panel from "./panel.js";
import {
  transformSelection,
  transformationParameters,
} from "./selection-transformations.js";

export default class TransformationPanel extends Panel {
  identifier = "selection-transformation";
  inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M136,112H48a8,8,0,0,0-8,8v88a8,8,0,0,0,8,8h88a8,8,0,0,0,8-8V120A8,8,0,0,0,136,112Zm-8,88H56V128h72Zm88-16v16a16,16,0,0,1-16,16H176a8,8,0,0,1,0-16h24V184a8,8,0,0,1,16,0Zm0-72v32a8,8,0,0,1-16,0V112a8,8,0,0,1,16,0Zm0-56V72a8,8,0,0,1-16,0V56H184a8,8,0,0,1,0-16h16A16,16,0,0,1,216,56Zm-64-8a8,8,0,0,1-8,8H112a8,8,0,0,1,0-16h32A8,8,0,0,1,152,48ZM40,80V56A16,16,0,0,1,56,40H72a8,8,0,0,1,0,16H56V80a8,8,0,0,1-16,0Z"/></svg>`;

  static stylesForm = `
  .ui-form-label {
    overflow-x: unset;
    display: grid;
    align-items: center;
    justify-content: end;
    height: 1.6em;
  }

  .origin-radio-buttons {
    display: grid;
    grid-template-columns: auto auto auto;
  }

  .origin-radio-buttons > input[type="radio"] {
    appearance: none;
    background-color: var(--editor-mini-console-background-color-light);
    margin: 2px;
    color: var(--editor-mini-console-background-color-light);
    width: 0.9em;
    height: 0.9em;
    border: 0.15em solid var(--editor-mini-console-background-color-light);
    border-radius: 50%;
    cursor: pointer;
  }

  .origin-radio-buttons > input[type="radio"]:hover {
    background-color: var(--text-input-background-color-dark);
    border: 0.15em solid var(--text-input-background-color-dark);
  }

  .origin-radio-buttons > input[type="radio"]:checked {
    background-color: var(--text-input-background-color-dark);
    border: 0.15em solid var(--text-input-background-color-dark);
  }
`;

  constructor(editorController) {
    super(editorController);
    this.infoForm = new Form();
    this.infoForm.appendStyle(TransformationPanel.stylesForm);
    this.contentElement.appendChild(
      html.div(
        { class: "panel-section panel-section--flex panel-section--scrollable" },
        [this.infoForm]
      )
    );
    this.fontController = this.editorController.fontController;
    this.sceneController = this.editorController.sceneController;

    this.sceneController.sceneSettingsController.addKeyListener(
      [
        "selectedGlyph",
        "selectedGlyphName",
        "selection",
        "fontLocationSourceMapped",
        "glyphLocation",
      ],
      (event) => this.updateDimensions()
    );
    this.sceneController.addCurrentGlyphChangeListener((event) => {
      this.updateDimensions();
    });
  }

  getContentElement() {
    return html.div(
      {
        class: "panel",
      },
      []
    );
  }

  async update(senderInfo) {
    if (!this.infoForm.contentElement.offsetParent) {
      // If the info form is not visible, do nothing
      return;
    }

    await this.fontController.ensureInitialized;

    const formContents = [];

    formContents.push({
      type: "header",
      label: translate("sidebar.selection-transformation.title"),
    });

    let radioButtonOrigin = html.createDomElement("div", {
      class: "origin-radio-buttons ui-form-center",
    });

    for (const keyY of ["top", "middle", "bottom"]) {
      for (const keyX of ["left", "center", "right"]) {
        const key = `${keyX}-${keyY}`;
        let radioButton = html.createDomElement("input", {
          "type": "radio",
          "value": key,
          "name": "origin",
          "v-model": "role",
          "class": "ui-form-radio-button",
          "checked":
            keyX === transformationParameters.originX &&
            keyY === transformationParameters.originY
              ? "checked"
              : "",
          "onclick": (event) => this._changeOrigin(keyX, keyY),
          "title": translate(`sidebar.selection-transformation.origin.${keyY}.${keyX}`),
        });
        radioButtonOrigin.appendChild(radioButton);
      }
    }

    formContents.push({
      type: "single-icon",
      element: radioButtonOrigin,
    });

    formContents.push({ type: "divider" });

    formContents.push({
      type: "edit-number-x-y",
      label: translate("sidebar.selection-transformation.origin"),
      fieldX: {
        key: "originXButton",
        value: transformationParameters.originXButton,
      },
      fieldY: {
        key: "originYButton",
        value: transformationParameters.originYButton,
      },
    });

    formContents.push({ type: "divider" });

    const buttonMove = html.createDomElement("icon-button", {
      src: "/tabler-icons/arrow-move-right.svg",
      onclick: (event) =>
        this.doTransformSelection(
          () =>
            new Transform().translate(
              transformationParameters.moveX,
              transformationParameters.moveY
            ),
          "move"
        ),
      class: "ui-form-icon ui-form-icon-button",
      title: translate("sidebar.selection-transformation.move"),
    });

    formContents.push({
      type: "edit-number-x-y",
      label: buttonMove,
      fieldX: {
        key: "moveX",
        value: transformationParameters.moveX,
      },
      fieldY: {
        key: "moveY",
        value: transformationParameters.moveY,
      },
      onEnterKey: (event) => {
        buttonMove.click();
      },
    });

    const buttonScale = html.createDomElement("icon-button", {
      src: "/tabler-icons/resize.svg",
      onclick: (event) =>
        this.doTransformSelection(
          () =>
            new Transform().scale(
              transformationParameters.scaleX / 100,
              (transformationParameters.scaleY
                ? transformationParameters.scaleY
                : transformationParameters.scaleX) / 100
            ),
          "scale"
        ),
      class: "ui-form-icon ui-form-icon-button",
      title: translate("sidebar.selection-transformation.scale"),
    });

    formContents.push({
      type: "edit-number-x-y",
      label: buttonScale,
      fieldX: {
        key: "scaleX",
        id: "selection-transformation-scaleX",
        value: transformationParameters.scaleX,
      },
      fieldY: {
        key: "scaleY",
        id: "selection-transformation-scaleY",
        value: transformationParameters.scaleY,
      },
      onEnterKey: (event) => {
        buttonScale.click();
      },
    });

    const buttonRotate = html.createDomElement("icon-button", {
      src: "/tabler-icons/rotate.svg",
      onclick: (event) =>
        this.doTransformSelection(
          () =>
            new Transform().rotate((transformationParameters.rotation * Math.PI) / 180),
          "rotate"
        ),
      class: "ui-form-icon ui-form-icon-button",
      title: translate("sidebar.selection-transformation.rotate"),
    });

    formContents.push({
      type: "edit-number",
      key: "rotation",
      label: buttonRotate,
      value: transformationParameters.rotation,
      onEnterKey: (event) => {
        buttonRotate.click();
      },
    });

    const buttonSkew = html.createDomElement("icon-button", {
      src: "/images/skew.svg",
      onclick: (event) =>
        this.doTransformSelection(
          () =>
            new Transform().skew(
              (transformationParameters.skewX * Math.PI) / 180,
              (transformationParameters.skewY * Math.PI) / 180
            ),
          "skew"
        ),
      class: "ui-form-icon ui-form-icon-button",
      title: translate("sidebar.selection-transformation.skew"),
    });

    formContents.push({
      type: "edit-number-x-y",
      key: '["selectionTransformationSkew"]',
      label: buttonSkew,
      fieldX: {
        key: "skewX",
        id: "selection-transformation-skewX",
        value: transformationParameters.skewX,
      },
      fieldY: {
        key: "skewY",
        id: "selection-transformation-skewY",
        value: transformationParameters.skewY,
      },
      onEnterKey: (event) => {
        buttonSkew.click();
      },
    });

    formContents.push({ type: "divider" });

    const buttonDimensions = html.createDomElement("icon-button", {
      src: "/tabler-icons/dimensions.svg",
      onclick: async (event) => {
        const glyph =
          await this.sceneController.sceneModel.getSelectedStaticGlyphController();
        const bounds = glyph?.getSelectionBounds(
          this.sceneController.selection,
          this.fontController.getBackgroundImageBoundsFunc
        );
        if (!bounds) {
          return;
        }
        const { width, height } = rectSize(bounds);
        const doScaleX = transformationParameters.dimensionWidth != width;
        const doScaleY = transformationParameters.dimensionHeight != height;

        if (doScaleX || doScaleY) {
          this.doTransformSelection((selectionBounds) => {
            const { width, height } = rectSize(selectionBounds);
            const newWidth = transformationParameters.dimensionWidth || width;
            const newHeight = transformationParameters.dimensionHeight || height;
            const scaleX = doScaleX ? newWidth / width : 1;
            const scaleY = doScaleY ? newHeight / height : 1;

            return new Transform().scale(scaleX, scaleY);
          }, "set dimensions");
        }
      },
      class: "ui-form-icon ui-form-icon-button",
      title: translate("sidebar.selection-info.dimensions"),
    });

    formContents.push({
      type: "edit-number-x-y",
      key: '["selectionTransformationDimensions"]',
      label: buttonDimensions,
      fieldX: {
        key: "dimensionWidth",
        id: "selection-transformation-dimension-width",
        numDigits: 1,
        value: null,
      },
      fieldY: {
        key: "dimensionHeight",
        id: "selection-transformation-dimension-height",
        numDigits: 1,
        value: null,
      },
      onEnterKey: (event) => {
        buttonDimensions.click();
      },
    });

    formContents.push({ type: "divider" });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "text",
        key: "LabelFlip",
        value: translate("sidebar.selection-transformation.flip"),
      },
      field2: {
        type: "auxiliaryElement",
        key: "FlipVertically",
        auxiliaryElement: html.createDomElement("icon-button", {
          class: "ui-form-icon",
          src: "/tabler-icons/flip-vertical.svg",
          title: translate("sidebar.selection-transformation.flip.vertically"),
          onclick: (event) =>
            this.doTransformSelection(
              () => new Transform().scale(-1, 1),
              "flip vertically"
            ),
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "FlipHorizontally",
        auxiliaryElement: html.createDomElement("icon-button", {
          class: "ui-form-icon",
          src: "/tabler-icons/flip-horizontal.svg",
          title: translate("sidebar.selection-transformation.flip.horizontally"),
          onclick: (event) =>
            this.doTransformSelection(
              () => new Transform().scale(1, -1),
              "flip horizontally"
            ),
        }),
      },
    });

    formContents.push({ type: "spacer" });
    formContents.push({
      type: "header",
      label: translate("sidebar.selection-transformation.align"),
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "AlignLeft",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/vertical-align-left.svg",
          onclick: (event) => this.doMoveObjects("align.left"),
          class: "ui-form-icon ui-form-icon-button",
          title: translate("sidebar.selection-transformation.align.left"),
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "AlignCenter",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/vertical-align-center.svg",
          onclick: (event) => this.doMoveObjects("align.center"),
          title: translate("sidebar.selection-transformation.align.center"),
          class: "ui-form-icon",
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "AlignRight",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/vertical-align-right.svg",
          onclick: (event) => this.doMoveObjects("align.right"),
          title: translate("sidebar.selection-transformation.align.right"),
          class: "ui-form-icon",
        }),
      },
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "AlignTop",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/horizontal-align-top.svg",
          onclick: (event) => this.doMoveObjects("align.top"),
          title: translate("sidebar.selection-transformation.align.top"),
          class: "ui-form-icon ui-form-icon-button",
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "AlignMiddle",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/horizontal-align-center.svg",
          onclick: (event) => this.doMoveObjects("align.middle"),
          title: translate("sidebar.selection-transformation.align.middle"),
          class: "ui-form-icon",
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "AlignMiddle",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/horizontal-align-bottom.svg",
          onclick: (event) => this.doMoveObjects("align.bottom"),
          title: translate("sidebar.selection-transformation.align.bottom"),
          class: "ui-form-icon",
        }),
      },
    });

    formContents.push({ type: "spacer" });
    formContents.push({
      type: "header",
      label: translate("sidebar.selection-transformation.distribute"),
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "distributeHorizontally",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/layout-distribute-vertical.svg",
          onclick: (event) => this.doMoveObjects("distribute.horizontally"),
          title: translate("sidebar.selection-transformation.distribute.horizontally"),
          class: "ui-form-icon ui-form-icon-button",
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "distributeVertically",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/layout-distribute-horizontal.svg",
          onclick: (event) => this.doMoveObjects("distribute.vertically"),
          title: translate("sidebar.selection-transformation.distribute.vertically"),
          class: "ui-form-icon",
        }),
      },
      field3: {
        type: "edit-number",
        key: "customDistributionSpacing",
        value: transformationParameters.customDistributionSpacing,
        allowEmptyField: true,
        tooltip: translate(
          "sidebar.selection-transformation.distribute.distance-in-units"
        ),
      },
    });

    formContents.push({ type: "spacer" });

    const labelKeyPathOperations = "sidebar.selection-transformation.path-operations";

    formContents.push({
      type: "header",
      label: translate(labelKeyPathOperations),
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "removeOverlaps",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/layers-union.svg",
          onclick: (event) => this.doPathOperation("union"),
          title: translate(`${labelKeyPathOperations}.union`),
          class: "ui-form-icon ui-form-icon-button",
        }),
      },
      field2: {
        type: "auxiliaryElement",
        key: "subtractContours",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/layers-subtract.svg",
          onclick: (event) => this.doPathOperation("subtract"),
          title: translate(`${labelKeyPathOperations}.subtract`),
          class: "ui-form-icon",
        }),
      },
      field3: {
        type: "auxiliaryElement",
        key: "intersectContours",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/layers-intersect-2.svg",
          onclick: (event) => this.doPathOperation("intersect"),
          title: translate(`${labelKeyPathOperations}.intersect`),
          class: "ui-form-icon",
        }),
      },
    });

    formContents.push({
      type: "universal-row",
      field1: {
        type: "auxiliaryElement",
        key: "excludeContours",
        auxiliaryElement: html.createDomElement("icon-button", {
          src: "/tabler-icons/layers-difference.svg",
          onclick: (event) => this.doPathOperation("exclude"),
          title: translate(`${labelKeyPathOperations}.exclude`),
          class: "ui-form-icon ui-form-icon-button",
        }),
      },
      field2: {},
      field3: {},
    });

    this.infoForm.setFieldDescriptions(formContents);

    this.infoForm.onFieldChange = async (fieldItem, value, valueStream) => {
      transformationParameters[fieldItem.key] = value;
      if (fieldItem.key === "originXButton" || fieldItem.key === "originYButton") {
        transformationParameters[fieldItem.key.replace("Button", "")] = value;

        const iconRadioButtons = this.infoForm.shadowRoot.querySelectorAll(
          ".ui-form-radio-button"
        );
        for (const radioButton of iconRadioButtons) {
          radioButton.checked = false;
        }
      }
    };

    this.updateDimensions();
  }

  async updateDimensions() {
    const glyph =
      await this.sceneController.sceneModel.getSelectedStaticGlyphController();

    const settings = this.sceneController.sceneSettings;
    const bounds =
      glyph &&
      settings.selectedGlyph?.isEditing &&
      settings.selectedGlyphName &&
      settings.selection?.size
        ? glyph.getSelectionBounds(
            this.sceneController.selection,
            this.fontController.getBackgroundImageBoundsFunc
          )
        : null;

    const { width, height } = bounds ? rectSize(bounds) : { width: null, height: null };
    this.infoForm.setValue("dimensionWidth", width);
    this.infoForm.setValue("dimensionHeight", height);
    transformationParameters.dimensionWidth = width;
    transformationParameters.dimensionHeight = height;
  }

  doMoveObjects(keyPart) {
    return doPerformAction(`action.selection-transformation.${keyPart}`);
  }

  doPathOperation(keyPart) {
    return doPerformAction(
      `action.selection-transformation.path-operations.${keyPart}`
    );
  }

  doTransformSelection(transformationForLayer, undoLabel) {
    return transformSelection(
      this.sceneController,
      this.fontController,
      transformationForLayer,
      undoLabel
    );
  }

  _changeOrigin(keyX, keyY) {
    transformationParameters.originX = keyX;
    transformationParameters.originY = keyY;
    transformationParameters.originXButton = undefined;
    transformationParameters.originYButton = undefined;
    this.infoForm.setValue("originXButton", null);
    this.infoForm.setValue("originYButton", null);
  }

  async toggle(on, focus) {
    if (on) {
      this.update();
    }
  }
}

customElements.define("panel-transformation", TransformationPanel);
