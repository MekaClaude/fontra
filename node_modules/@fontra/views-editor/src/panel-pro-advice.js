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
    inlineSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M176,68a12,12,0,1,1-12-12A12,12,0,0,1,176,68Zm64,12a8,8,0,0,1-3.56,6.66L216,100.28V120A104.11,104.11,0,0,1,112,224H24a16,16,0,0,1-12.49-26l.1-.12L96,96.63V76.89C96,43.47,122.79,16.16,155.71,16H156a60,60,0,0,1,57.21,41.86l23.23,15.48A8,8,0,0,1,240,80Zm-22.42,0L201.9,69.54a8,8,0,0,1-3.31-4.64A44,44,0,0,0,156,32h-.22C131.64,32.12,112,52.25,112,76.89V99.52a8,8,0,0,1-1.85,5.13L24,208h26.9l70.94-85.12a8,8,0,1,1,12.29,10.24L71.75,208H112a88.1,88.1,0,0,0,88-88V96a8,8,0,0,1,3.56-6.66Z"/></svg>`;

    static styles = `
    .pro-advice-container {
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.75em;
      overflow-y: auto;
      font-size: 0.88em;
      line-height: 1.45;
    }

    .pro-advice-header {
      font-weight: bold;
      font-size: 1em;
      padding-bottom: 0.25em;
      border-bottom: 1px solid var(--horizontal-rule-color, #ccc);
    }

    .pro-advice-section {
      background: var(--ui-element-background-color, #f5f5f5);
      border-radius: 6px;
      padding: 0.6em 0.75em;
    }

    .pro-advice-section-title {
      font-weight: 600;
      font-size: 0.92em;
      margin-bottom: 0.35em;
      color: var(--fontra-ui-on-surface-color, #333);
    }

    .pro-advice-tip {
      margin: 0.25em 0;
      padding-left: 0.9em;
      position: relative;
    }

    .pro-advice-tip::before {
      content: "•";
      position: absolute;
      left: 0;
      color: var(--fontra-ui-accent-color, #09f);
    }

    .pro-advice-warning {
      margin: 0.25em 0;
      padding-left: 0.9em;
      position: relative;
      color: var(--fontra-ui-warning-color, #cc6600);
    }

    .pro-advice-warning::before {
      content: "⚠";
      position: absolute;
      left: 0;
    }

    .pro-advice-related {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35em;
    }

    .pro-advice-glyph-tag {
      background: var(--fontra-ui-accent-color, #09f);
      color: white;
      padding: 0.15em 0.5em;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: 500;
      cursor: default;
    }

    .pro-advice-glyph-tag.informed-by {
      background: var(--fontra-ui-secondary-color, #6c757d);
    }

    .pro-advice-phase-badge {
      display: inline-block;
      background: var(--fontra-ui-accent-color, #09f);
      color: white;
      padding: 0.1em 0.5em;
      border-radius: 10px;
      font-size: 0.82em;
      font-weight: 600;
    }

    .pro-advice-correction-name {
      font-weight: 600;
      color: var(--fontra-ui-accent-color, #09f);
    }

    .pro-advice-empty {
      color: #999;
      padding-top: 1em;
      font-style: italic;
    }

    .pro-advice-term {
      color: var(--fontra-ui-accent-color, #09f);
      border-bottom: 1px dotted var(--fontra-ui-accent-color, #09f);
      cursor: help;
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
                            html.div({ class: "pro-advice-header" }, ["Pro Advice"]),
                            html.div({ class: "pro-advice-empty" }, [
                                "Select a glyph to see design advice",
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
                html.div({ class: "pro-advice-header" }, ["Pro Advice"])
            );
            container.appendChild(
                html.div({ class: "pro-advice-empty" }, [
                    "Select a glyph to see design advice",
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
            html.div({ class: "pro-advice-header" }, [`Pro Advice: "${glyphName}"`])
        );

        if (!glyphData) {
            container.appendChild(
                html.div({ class: "pro-advice-section" }, [
                    html.div({ class: "pro-advice-tip" }, [
                        `No specific tips found for "${glyphName}". General spacing and design principles still apply.`,
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
                    html.div({ class: "pro-advice-section-title" }, ["Design Phase"]),
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
                html.div({ class: "pro-advice-section-title" }, ["Construction Tips"]),
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
                html.div({ class: "pro-advice-section-title" }, ["Common Mistakes"]),
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
                html.div({ class: "pro-advice-section-title" }, ["Letter Relationships"]),
            ]);

            if (allInforms.length) {
                relSection.appendChild(
                    html.div({}, [`This letter informs the design of:`])
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
                    html.div({ style: "margin-top: 0.4em" }, [`Informed by:`])
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
                html.div({ class: "pro-advice-section-title" }, ["Reusable Components"]),
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
                html.div({ class: "pro-advice-section-title" }, ["Optical Corrections"]),
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
            html.div({ class: "pro-advice-section-title" }, ["Spacing Fundamentals"]),
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
