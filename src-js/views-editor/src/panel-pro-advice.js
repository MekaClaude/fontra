import * as html from "@fontra/core/html-utils.js";
import { translate } from "@fontra/core/localization.js";
import { fetchJSON, throttleCalls } from "@fontra/core/utils.js";
import Panel from "./panel.js";

let _knowledgeBase = null;

async function loadKnowledgeBase() {
    if (!_knowledgeBase) {
        try {
            _knowledgeBase = await fetchJSON("/data/type-design-knowledge.json");
        } catch (e) {
            console.warn("Could not load type design knowledge base:", e);
            _knowledgeBase = {};
        }
    }
    return _knowledgeBase;
}

export default class ProAdvicePanel extends Panel {
    identifier = "pro-advice";
    iconPath = "/tabler-icons/bulb.svg";

    static styles = `
    .pro-advice-container {
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 1em;
      overflow-y: auto;
      font-size: 0.95em;
      line-height: 1.5;
      padding: 0.5em;
    }

    .pro-advice-header {
      font-weight: 700;
      font-size: 1.15em;
      padding: 0.5em 0.75em;
      background: var(--fontra-ui-accent-color, #0078d4);
      color: white;
      border-radius: 6px;
      margin-bottom: 0.25em;
    }

    .pro-advice-section {
      background: var(--ui-element-background-color, #f0f4f8);
      border: 1px solid var(--ui-element-border-color, #d0d7de);
      border-radius: 8px;
      padding: 0.8em 1em;
    }

    .pro-advice-section-title {
      font-weight: 700;
      font-size: 1em;
      margin-bottom: 0.5em;
      color: var(--fontra-ui-on-surface-color, #1a1a1a);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 2px solid var(--fontra-ui-accent-color, #0078d4);
      padding-bottom: 0.3em;
    }

    .pro-advice-tip {
      margin: 0.4em 0;
      padding-left: 1.2em;
      position: relative;
      color: var(--fontra-ui-on-surface-color, #24292f);
    }

    .pro-advice-tip::before {
      content: "▸";
      position: absolute;
      left: 0;
      color: var(--fontra-ui-accent-color, #0078d4);
      font-weight: bold;
    }

    .pro-advice-warning {
      margin: 0.4em 0;
      padding-left: 1.2em;
      position: relative;
      color: #c41a20;
      font-weight: 500;
      background: #fff5f5;
      padding: 0.5em 0.75em;
      border-radius: 4px;
      border-left: 3px solid #c41a20;
    }

    .pro-advice-warning::before {
      content: "⚠";
      position: absolute;
      left: 0.25em;
    }

    .pro-advice-related {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5em;
    }

    .pro-advice-glyph-tag {
      background: var(--fontra-ui-accent-color, #0078d4);
      color: white;
      padding: 0.25em 0.75em;
      border-radius: 4px;
      font-size: 0.9em;
      font-weight: 600;
      cursor: default;
      border: 1px solid var(--fontra-ui-accent-color, #005a9e);
    }

    .pro-advice-glyph-tag.informed-by {
      background: #5a6268;
      border-color: #454a4e;
    }

    .pro-advice-phase-badge {
      display: inline-block;
      background: #28a745;
      color: white;
      padding: 0.25em 0.75em;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 700;
      border: 1px solid #1e7e34;
    }

    .pro-advice-correction-name {
      font-weight: 700;
      color: #d32f2f;
      background: #ffebee;
      padding: 0.1em 0.4em;
      border-radius: 3px;
    }

    .pro-advice-empty {
      color: #666;
      padding: 1.5em;
      font-style: italic;
      text-align: center;
      background: #f8f9fa;
      border-radius: 8px;
      border: 1px dashed #dee2e6;
    }

    .pro-advice-term {
      color: var(--fontra-ui-accent-color, #0078d4);
      border-bottom: 1px dotted var(--fontra-ui-accent-color, #0078d4);
      cursor: help;
      font-weight: 500;
    }

    .pro-advice-glyph-title {
      font-size: 1.4em;
      font-weight: 800;
      color: #1a1a1a;
      padding: 0.25em 0;
      margin-bottom: 0.25em;
    }
  `;

    constructor(editorController) {
        super(editorController);
        this.throttledUpdate = throttleCalls(() => this.update(), 200);
        this.sceneController = this.editorController.sceneController;
        this.knowledgeBase = null;

        this.sceneController.sceneSettingsController.addKeyListener(
            ["selectedGlyphName"],
            () => this.throttledUpdate()
        );
    }

    getContentElement() {
        return html.div(
            { class: "panel" },
            [
                html.div(
                    { class: "panel-section panel-section--flex panel-section--scrollable" },
                    [
                        html.div({ class: "pro-advice-container", id: "pro-advice-content" }, [
                            html.div({ class: "pro-advice-header" }, [translate("sidebar.pro-advice")]),
                            html.div({ class: "pro-advice-empty" }, [
                                translate("sidebar.pro-advice.select-glyph"),
                            ]),
                        ]),
                    ]
                ),
            ]
        );
    }

    async update() {
        const container = this.contentElement.querySelector("#pro-advice-content");
        if (!container) return;

        const glyphName = this.sceneController.sceneSettings.selectedGlyphName;

        if (!glyphName) {
            container.innerHTML = "";
            container.appendChild(
                html.div({ class: "pro-advice-header" }, ["Glyph Advisor"])
            );
            container.appendChild(
                html.div({ class: "pro-advice-empty" }, [
                    "Select a glyph in the editor to see design advice",
                ])
            );
            return;
        }

        const kb = await loadKnowledgeBase();
        const glyphData = kb.glyphs?.[glyphName];
        const corrections = kb.opticalCorrections || {};
        const phases = kb.designOrder?.phases || [];
        const terms = kb.commonTerms || {};

        container.innerHTML = "";
        container.appendChild(
            html.div({ class: "pro-advice-glyph-title" }, [`${glyphName}`])
        );
        container.appendChild(
            html.div({ class: "pro-advice-header" }, ["Glyph Advisor"])
        );

        if (!glyphData) {
            container.appendChild(
                html.div({ class: "pro-advice-section" }, [
                    html.div({ class: "pro-advice-tip" }, [
                        translate("sidebar.pro-advice.no-specific-tips"),
                    ]),
                ])
            );
            this._addSpacingSection(container, kb);
            return;
        }

        // Phase & Category
        const phase = phases.find((p) => p.phase === glyphData.phase);
        if (phase) {
            container.appendChild(
                html.div({ class: "pro-advice-section" }, [
                    html.div({ class: "pro-advice-section-title" }, [translate("sidebar.pro-advice.design-phase")]),
                    html.div({}, [
                        html.span({ class: "pro-advice-phase-badge" }, [
                            `Phase ${phase.phase}`,
                        ]),
                        ` ${phase.name} — ${phase.description}`,
                    ]),
                ])
            );
        }

        // Construction Tips
        if (glyphData.tips?.length) {
            const tipsSection = html.div({ class: "pro-advice-section" }, [
                html.div({ class: "pro-advice-section-title" }, [translate("sidebar.pro-advice.construction-tips")]),
            ]);
            for (const tip of glyphData.tips) {
                tipsSection.appendChild(
                    html.div({ class: "pro-advice-tip" }, [tip])
                );
            }
            container.appendChild(tipsSection);
        }

        // Common Mistakes
        if (glyphData.commonMistakes?.length) {
            const mistakesSection = html.div({ class: "pro-advice-section" }, [
                html.div({ class: "pro-advice-section-title" }, [translate("sidebar.pro-advice.common-mistakes")]),
            ]);
            for (const mistake of glyphData.commonMistakes) {
                mistakesSection.appendChild(
                    html.div({ class: "pro-advice-warning" }, [mistake])
                );
            }
            container.appendChild(mistakesSection);
        }

        // Related Glyphs
        const informsOf = glyphData.informsDesignOf || [];
        const informsCapitals = glyphData.informsDesignOfCapitals || [];
        const informedBy = glyphData.informedBy || [];
        const allInforms = [...informsOf, ...informsCapitals];

        if (allInforms.length || informedBy.length) {
            const relSection = html.div({ class: "pro-advice-section" }, [
                html.div({ class: "pro-advice-section-title" }, [translate("sidebar.pro-advice.letter-relationships")]),
            ]);

            if (allInforms.length) {
                relSection.appendChild(
                    html.div({}, [translate("sidebar.pro-advice.this-letter-informs")])
                );
                const tagsDiv = html.div({ class: "pro-advice-related" });
                for (const g of allInforms) {
                    tagsDiv.appendChild(
                        html.span({ class: "pro-advice-glyph-tag" }, [g])
                    );
                }
                relSection.appendChild(tagsDiv);
            }

            if (informedBy.length) {
                relSection.appendChild(
                    html.div({ style: "margin-top: 0.4em" }, [translate("sidebar.pro-advice.informed-by")])
                );
                const tagsDiv = html.div({ class: "pro-advice-related" });
                for (const g of informedBy) {
                    tagsDiv.appendChild(
                        html.span({ class: "pro-advice-glyph-tag informed-by" }, [g])
                    );
                }
                relSection.appendChild(tagsDiv);
            }

            container.appendChild(relSection);
        }

        // Reusable Components
        if (glyphData.reusableComponents?.length) {
            const compSection = html.div({ class: "pro-advice-section" }, [
                html.div({ class: "pro-advice-section-title" }, [translate("sidebar.pro-advice.reusable-components")]),
            ]);
            for (const comp of glyphData.reusableComponents) {
                const definition = terms[comp] || "";
                const tipText = definition ? `${comp}: ${definition}` : comp;
                compSection.appendChild(
                    html.div({ class: "pro-advice-tip" }, [tipText])
                );
            }
            container.appendChild(compSection);
        }

        // Optical Corrections
        const correctionIds = glyphData.opticalCorrections || [];
        if (correctionIds.length) {
            const corrSection = html.div({ class: "pro-advice-section" }, [
                html.div({ class: "pro-advice-section-title" }, [translate("sidebar.pro-advice.optical-corrections")]),
            ]);
            for (const corrId of correctionIds) {
                const corr = corrections[corrId];
                if (corr) {
                    corrSection.appendChild(
                        html.div({ class: "pro-advice-tip" }, [
                            html.span({ class: "pro-advice-correction-name" }, [corr.name]),
                            `: ${corr.description}`,
                        ])
                    );
                    if (corr.rule) {
                        corrSection.appendChild(
                            html.div(
                                { class: "pro-advice-tip", style: "font-style: italic; opacity: 0.85" },
                                [`↳ ${corr.rule}`]
                            )
                        );
                    }
                }
            }
            container.appendChild(corrSection);
        }
    }

    _addSpacingSection(container, kb) {
        const spacing = kb.spacingPrinciples;
        if (!spacing) return;

        const section = html.div({ class: "pro-advice-section" }, [
            html.div({ class: "pro-advice-section-title" }, [translate("sidebar.pro-advice.spacing-fundamentals")]),
        ]);
        for (const principle of (spacing.fundamentals || []).slice(0, 3)) {
            section.appendChild(
                html.div({ class: "pro-advice-tip" }, [principle])
            );
        }
        container.appendChild(section);
    }

    async toggle(on, focus) {
        if (on) {
            this.update();
        }
    }
}

customElements.define("panel-pro-advice", ProAdvicePanel);
