// panel.js — the "Type Design School" panel, in the editor's right sidebar.
//
// A course, not a reference: the panel shows one thing at a time (a lesson),
// remembers where the learner got to, and ticks off the checklist items that
// make a lesson finished. The teaching material lives in data/course.json;
// this file only draws it.
//
// The panel also borrows from the type design knowledge base that already
// ships with Fontra (/data/type-design-knowledge.json), so a lesson can point
// at the glyph the learner is working on and show what the Glyph Advisor
// says about it.

import { el as domEl, div, span, button } from "../_shared/dom.js";
import {
  PANEL_ID,
  allLessons,
  checkProgress,
  courseProgress,
  emptyProgress,
  findLesson,
  glossaryEntries,
  isCheckDone,
  isLessonDone,
  loadProgress,
  nextLesson,
  phaseProgress,
  previousLesson,
  resumeLesson,
  saveProgress,
  validateCourse,
  withCheck,
  withLessonDone,
} from "./course.js";

const STYLE = `
:host {
  display: block; height: 100%; overflow: auto; box-sizing: border-box;
  font-family: fontra-ui-regular, -apple-system, sans-serif;
  color: var(--ui-element-foreground-color, inherit);
}
.wrap { padding: 1em; }
h2 { font-size: 1.05em; margin: 0 0 .3em; }
h3 { font-size: .95em; margin: 1em 0 .35em; }
p { margin: 0 0 .6em; line-height: 1.4; }
p.intro { opacity: .75; font-size: .9em; }
.eyebrow { font-size: .78em; text-transform: uppercase; letter-spacing: .08em;
  opacity: .6; margin: 0 0 .2em; }
.bar { height: 5px; border-radius: 3px; background: var(--horizontal-rule-color, #aaa4);
  overflow: hidden; margin: .3em 0 .2em; }
.bar > i { display: block; height: 100%; background: #f11759; }
.progress-line { font-size: .82em; opacity: .7; }
.row { display: flex; flex-wrap: wrap; gap: .5em 1em; align-items: center;
  font-size: .88em; }
.row button { background: none; border: 0; padding: 0; color: inherit; font: inherit;
  cursor: pointer; opacity: .85; text-decoration: none; }
.row button:hover { opacity: 1; text-decoration: underline; }
button.item { display: flex; gap: .55em; align-items: flex-start; width: 100%;
  text-align: left; padding: .5em .55em; margin: 0 0 .3em;
  border: 1px solid var(--horizontal-rule-color, #aaa4); border-radius: 6px;
  background: transparent; color: inherit; font: inherit; cursor: pointer; }
button.item:hover, button.item:focus-visible { border-color: #f11759; outline: none; }
.item .mark { width: 1.1em; flex: none; text-align: center; color: #f11759; font-weight: bold; }
.item .text { flex: 1; min-width: 0; line-height: 1.3; }
.item .text b { display: block; font-weight: 600; }
.item .text small { display: block; opacity: .7; font-size: .86em; }
hr { border: none; border-top: 1px solid var(--horizontal-rule-color, #aaa4); margin: .9em 0; }
.principle { margin: 0 0 .7em; }
.principle b { display: block; margin-bottom: .12em; }
.principle p { margin: 0; opacity: .92; }
ul { margin: .2em 0 .7em; padding-left: 1.1em; }
li { margin: .15em 0; line-height: 1.35; }
.check { display: flex; gap: .5em; align-items: flex-start; margin: .25em 0;
  line-height: 1.35; cursor: pointer; }
.check input { margin-top: .25em; flex: none; }
.check.checked span { opacity: .55; text-decoration: line-through; }
.pitfall { margin: .25em 0; padding-left: .9em; position: relative; line-height: 1.35; }
.pitfall::before { content: "\\26A0"; position: absolute; left: 0; font-size: .85em; }
.coach { background: var(--ui-element-background-color, #f5f5f5);
  border-radius: 6px; padding: .55em .65em; margin: .2em 0 .7em; font-size: .88em; }
.coach b { display: block; margin-bottom: .15em; }
.coach p { margin: 0 0 .3em; line-height: 1.35; }
.coach .meta { opacity: .65; font-size: .84em; }
.empty { opacity: .6; font-style: italic; }
.search { width: 100%; box-sizing: border-box; padding: .35em .45em; margin: .3em 0 .6em;
  font: inherit; font-size: .9em; }
.glossary dt { font-weight: 600; margin-top: .5em; }
.glossary dd { margin: 0 0 .1em; opacity: .9; line-height: 1.35; }
.glossary .also { opacity: .6; font-size: .85em; }
`;

// The knowledge base that already ships with Fontra. It is fetched lazily:
// the course must work even if it is not there.
let knowledgeBase = null;
let knowledgeBasePromise = null;

async function loadKnowledgeBase() {
  if (knowledgeBasePromise) {
    return knowledgeBasePromise;
  }
  knowledgeBasePromise = (async () => {
    try {
      const response = await fetch("/data/type-design-knowledge.json");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      knowledgeBase = await response.json();
    } catch (e) {
      console.warn(
        "Type Design School: could not load the type design knowledge base.",
        e
      );
      knowledgeBase = null;
    }
    return knowledgeBase;
  })();
  return knowledgeBasePromise;
}

// A render method returns a list of nodes, and a conditional child is
// written as `cond ? el(...) : null`. replaceChildren() would turn a null
// into the *text* "null", so they are dropped here.
const nodes = (list) => list.filter((node) => node !== null && node !== undefined);

// The shared el() takes a single children argument; the panel writes the
// variadic form, el(tag, attributes, ...children), so it is wrapped here.
function el(tagName, attributes, ...children) {
  return domEl(tagName, attributes, children);
}

export class TypeDesignCoursePanel extends HTMLElement {
  constructor(editorController, pluginPath) {
    super();
    this.identifier = PANEL_ID;
    this.editorController = editorController;
    this.pluginPath = pluginPath;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.append(
      el("style", {}, STYLE),
      (this.wrap = el("div", { class: "wrap" }))
    );

    this.course = null;
    this.courseError = null;
    this.progress = emptyProgress();
    this.view = { kind: "overview" };
    this.selectedGlyphName = null;

    this.storage = this._storage();
    this.progress = loadProgress(this.storage);

    this.render();

    // The course document is fetched after the panel is on screen: the
    // panel is useful (it shows where the learner is) even before the
    // document has arrived.
    this._loadCourse();

    // The knowledge base that ships with Fontra, for the per-glyph cards.
    // It is optional: the course works without it.
    loadKnowledgeBase().then(() => {
      if (this.view.kind === "lesson") {
        this.render();
      }
    });

    const sceneController = editorController?.sceneController;
    sceneController?.sceneSettingsController?.addKeyListener?.(
      "selectedGlyphName",
      (event) => {
        this.selectedGlyphName = event.newValue || null;
        if (this.view.kind === "lesson") {
          this.render();
        }
      }
    );
  }

  _storage() {
    try {
      return globalThis.localStorage || null;
    } catch (e) {
      return null;
    }
  }

  async _loadCourse() {
    try {
      const response = await fetch(`${this.pluginPath}/data/course.json`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      this.course = await response.json();
      const { ok, errors } = validateCourse(this.course);
      if (!ok) {
        this.courseError = errors.join(" ");
        console.error("Type Design School: the course document is not usable.", errors);
        this.course = null;
      }
    } catch (e) {
      this.courseError = e.message || String(e);
      console.error("Type Design School: could not load the course document.", e);
    }
    this.render();
  }

  // Called by Fontra when the panel is shown or hidden.
  toggle(on) {
    if (on) {
      this.render();
    }
  }

  _save() {
    saveProgress(this.storage, this.progress);
  }

  _setView(view) {
    this.view = view;
    this.render();
    this.shadowRoot.querySelector(".wrap")?.scrollTo?.(0, 0);
  }

  // --- rendering ---------------------------------------------------------

  render() {
    if (this.courseError) {
      this.wrap.replaceChildren(
        el("h2", {}, "Type Design School"),
        el("p", { class: "intro" }, "The course could not be loaded."),
        el("p", { class: "empty" }, this.courseError)
      );
      return;
    }
    if (!this.course) {
      this.wrap.replaceChildren(
        el("h2", {}, "Type Design School"),
        el("p", { class: "intro" }, "Loading the course…")
      );
      return;
    }

    switch (this.view.kind) {
      case "phase":
        this.wrap.replaceChildren(...nodes(this._renderPhase()));
        break;
      case "lesson":
        this.wrap.replaceChildren(...nodes(this._renderLesson()));
        break;
      case "glossary":
        this.wrap.replaceChildren(...nodes(this._renderGlossary()));
        break;
      case "letters":
        this.wrap.replaceChildren(...nodes(this._renderLetterAudit()));
        break;
      default:
        this.wrap.replaceChildren(...nodes(this._renderOverview()));
    }
  }

  _renderOverview() {
    const meta = this.course.meta || {};
    const progress = courseProgress(this.progress, this.course);
    const resume = resumeLesson(this.progress, this.course);

    const phaseRows = (this.course.phases || []).map((phase) => {
      const { done, total } = phaseProgress(this.progress, phase);
      const mark = done === total && total ? "✓" : done ? "●" : "";
      return el(
        "button",
        {
          type: "button",
          class: "item",
          onclick: () => this._setView({ kind: "phase", phaseId: phase.id }),
        },
        el("span", { class: "mark" }, mark),
        el(
          "span",
          { class: "text" },
          el("b", {}, `${phase.number}. ${phase.title}`),
          el("small", {}, phase.goal)
        ),
        el("span", { class: "length" }, `${done}/${total}`)
      );
    });

    return [
      el("p", { class: "eyebrow" }, "A course in type design"),
      el("h2", {}, meta.title || "Type Design School"),
      el("p", { class: "intro" }, meta.tagline || ""),
      el("div", { class: "bar" }, el("i", { style: `width:${progress.percent}%` })),
      el(
        "p",
        { class: "progress-line" },
        `${progress.done} of ${progress.total} lessons done`
      ),
      resume
        ? el(
            "div",
            { class: "row" },
            el(
              "button",
              {
                type: "button",
                onclick: () =>
                  this._setView({
                    kind: "lesson",
                    phaseId: resume.phase.id,
                    lessonId: resume.lesson.id,
                  }),
              },
              progress.done ? "Continue →" : "Start the course →"
            )
          )
        : null,
      el("hr"),
      ...phaseRows,
      el("hr"),
      el(
        "div",
        { class: "row" },
        el(
          "button",
          {
            type: "button",
            onclick: () => this._setView({ kind: "glossary" }),
          },
          "Glossary"
        ),
        el(
          "button",
          {
            type: "button",
            onclick: () => this._setView({ kind: "letters" }),
          },
          "Letter audit"
        ),
        el(
          "button",
          {
            type: "button",
            title: "Forget every tick: the course starts from the beginning again",
            onclick: () => {
              this.progress = emptyProgress();
              this._save();
              this.render();
            },
          },
          "Start over"
        )
      ),
    ];
  }

  _renderPhase() {
    const phase = (this.course.phases || []).find(
      (candidate) => candidate.id === this.view.phaseId
    );
    if (!phase) {
      return this._renderOverview();
    }
    const { done, total } = phaseProgress(this.progress, phase);

    const lessonRows = (phase.lessons || []).map((lesson) => {
      const mark = isLessonDone(this.progress, lesson.id) ? "✓" : "";
      return el(
        "button",
        {
          type: "button",
          class: "item",
          onclick: () =>
            this._setView({ kind: "lesson", phaseId: phase.id, lessonId: lesson.id }),
        },
        el("span", { class: "mark" }, mark),
        el(
          "span",
          { class: "text" },
          el("b", {}, lesson.title),
          el("small", {}, lesson.objective)
        )
      );
    });

    return [
      el("p", { class: "eyebrow" }, `Phase ${phase.number} · ${done}/${total} done`),
      el("h2", {}, phase.title),
      el("p", { class: "intro" }, phase.goal),
      phase.why ? el("p", {}, phase.why) : null,
      el("hr"),
      ...lessonRows,
      phase.milestone
        ? el(
            "div",
            { class: "coach" },
            el("b", {}, "You are done with this phase when…"),
            el("p", {}, phase.milestone)
          )
        : null,
      el(
        "div",
        { class: "row" },
        el(
          "button",
          { type: "button", onclick: () => this._setView({ kind: "overview" }) },
          "← All phases"
        )
      ),
    ];
  }

  _renderLesson() {
    const entry = findLesson(this.course, this.view.lessonId);
    if (!entry) {
      return this._renderOverview();
    }
    const { phase, lesson } = entry;
    const done = isLessonDone(this.progress, lesson.id);
    const checks = checkProgress(this.progress, lesson);
    const successor = nextLesson(this.course, lesson.id);
    const predecessor = previousLesson(this.course, lesson.id);

    const principleBlocks = (lesson.principles || []).map((principle) =>
      el(
        "div",
        { class: "principle" },
        el("b", {}, principle.title),
        el("p", {}, principle.body)
      )
    );

    const practiceList = lesson.practice?.length
      ? el(
          "div",
          {},
          el("h3", {}, "Do this"),
          el("ul", {}, ...lesson.practice.map((step) => el("li", {}, step)))
        )
      : null;

    const checkList = lesson.checklist?.length
      ? el(
          "div",
          {},
          el("h3", {}, "Before you move on"),
          ...lesson.checklist.map((item, index) => {
            const checkId = `${lesson.id}:${index}`;
            const checked = isCheckDone(this.progress, checkId);
            const box = el("input", { type: "checkbox", checked });
            const text = el("span", {}, item);
            const row = el(
              "label",
              { class: `check${checked ? " checked" : ""}` },
              box,
              text
            );
            box.addEventListener("change", () => {
              this.progress = withCheck(this.progress, checkId, box.checked);
              this._save();
              this.render();
            });
            return row;
          })
        )
      : null;

    const pitfallList = lesson.pitfalls?.length
      ? el(
          "div",
          {},
          el("h3", {}, "Watch out for"),
          ...lesson.pitfalls.map((trap) => el("div", { class: "pitfall" }, trap))
        )
      : null;

    const fontraList = lesson.fontra?.length
      ? el(
          "div",
          {},
          el("h3", {}, "In Fontra"),
          el("ul", {}, ...lesson.fontra.map((pointer) => el("li", {}, pointer)))
        )
      : null;

    const glyphCards = (lesson.glyphs || [])
      .map((glyphName) => this._renderCoachCard(glyphName))
      .filter(Boolean);

    return [
      el("p", { class: "eyebrow" }, `Phase ${phase.number} · ${phase.title}`),
      el("h2", {}, lesson.title),
      el("p", { class: "intro" }, lesson.objective),
      el("hr"),
      ...principleBlocks,
      practiceList,
      checkList,
      pitfallList,
      fontraList,
      glyphCards.length ? el("h3", {}, "The glyph you are on") : null,
      ...glyphCards,
      el("hr"),
      el(
        "div",
        { class: "row" },
        el(
          "button",
          {
            type: "button",
            onclick: () => {
              this.progress = withLessonDone(this.progress, lesson.id, !done);
              this._save();
              this.render();
            },
          },
          done ? "Mark as not done" : "Mark this lesson done ✓"
        ),
        successor
          ? el(
              "button",
              {
                type: "button",
                onclick: () =>
                  this._setView({
                    kind: "lesson",
                    phaseId: successor.phase.id,
                    lessonId: successor.lesson.id,
                  }),
              },
              "Next lesson →"
            )
          : null,
        predecessor
          ? el(
              "button",
              {
                type: "button",
                onclick: () =>
                  this._setView({
                    kind: "lesson",
                    phaseId: predecessor.phase.id,
                    lessonId: predecessor.lesson.id,
                  }),
              },
              "← Previous"
            )
          : null
      ),
      checks.total
        ? el(
            "p",
            { class: "progress-line" },
            `${checks.done} of ${checks.total} checklist items ticked`
          )
        : null,
      el(
        "div",
        { class: "row" },
        el(
          "button",
          {
            type: "button",
            onclick: () => this._setView({ kind: "phase", phaseId: phase.id }),
          },
          "Back to the phase"
        )
      ),
    ];
  }

  // A short card about one glyph, taken from the knowledge base that ships
  // with Fontra. The full story is in the Glyph Advisor panel.
  _renderCoachCard(glyphName) {
    const entry = knowledgeBase?.glyphs?.[glyphName];
    if (!entry) {
      return null;
    }
    const tip = (entry.tips || [])[0];
    const mistake = (entry.commonMistakes || [])[0];
    return el(
      "div",
      { class: "coach" },
      el("b", {}, entry.name || glyphName),
      el(
        "p",
        { class: "meta" },
        `Phase ${entry.phase || "?"} · ${entry.dna_role || "glyph"}`
      ),
      tip ? el("p", {}, tip) : null,
      mistake ? el("p", { class: "meta" }, `Common mistake: ${mistake}`) : null,
      el(
        "div",
        { class: "row" },
        el(
          "button",
          {
            type: "button",
            title: "Open the Glyph Advisor panel",
            onclick: () => {
              try {
                this.editorController?.actionExecutor?.doPerformAction?.(
                  "action.sidebars.toggle.pro-advice"
                );
              } catch (e) {
                console.warn(
                  "Type Design School: could not open the Glyph Advisor panel.",
                  e
                );
              }
            },
          },
          "Glyph Advisor →"
        )
      )
    );
  }

  // The letter audit: a short list of relational checks for each capital.
  // The method is to compare a letter with a reference letter rather than to
  // measure it, so every check is a comparison, not a number.
  _renderLetterAudit() {
    const entries = this.course.letterChecks || [];
    const letter = this.view.letter;

    if (letter) {
      const entry = entries.find((item) => item.letter === letter);
      if (!entry) {
        return this._renderLetterAudit();
      }
      const checkId = `letter:${entry.letter}`;
      const checked = isCheckDone(this.progress, checkId);
      const box = el("input", { type: "checkbox", checked });
      box.addEventListener("change", () => {
        this.progress = withCheck(this.progress, checkId, box.checked);
        this._save();
        this.render();
      });
      return [
        el("p", { class: "eyebrow" }, "Letter audit"),
        el("h2", {}, entry.letter),
        el(
          "p",
          { class: "intro" },
          "Check your capital against these, one at a time. A check you cannot answer is a thing to go and look at."
        ),
        el("ul", {}, ...entry.checks.map((text) => el("li", {}, text))),
        el(
          "label",
          { class: `check${checked ? " checked" : ""}` },
          box,
          el("span", {}, "I have checked this letter")
        ),
        el("hr"),
        el(
          "div",
          { class: "row" },
          el(
            "button",
            {
              type: "button",
              onclick: () => this._setView({ kind: "letters" }),
            },
            "← All letters"
          ),
          el(
            "button",
            {
              type: "button",
              title: "Open the Glyph Advisor panel",
              onclick: () => {
                try {
                  this.editorController?.actionExecutor?.doPerformAction?.(
                    "action.sidebars.toggle.pro-advice"
                  );
                } catch (e) {
                  console.warn(
                    "Type Design School: could not open the Glyph Advisor panel.",
                    e
                  );
                }
              },
            },
            "Glyph Advisor →"
          )
        ),
      ];
    }

    const rows = entries.map((entry) => {
      const checked = isCheckDone(this.progress, `letter:${entry.letter}`);
      return el(
        "button",
        {
          type: "button",
          class: "item",
          onclick: () => this._setView({ kind: "letters", letter: entry.letter }),
        },
        el("span", { class: "mark" }, checked ? "✓" : ""),
        el(
          "span",
          { class: "text" },
          el("b", {}, entry.letter),
          el("small", {}, entry.checks[0] || "")
        ),
        el("span", { class: "length" }, `${entry.checks.length}`)
      );
    });

    return [
      el("p", { class: "eyebrow" }, "Reference"),
      el("h2", {}, "Letter audit"),
      el(
        "p",
        { class: "intro" },
        "Twenty-six capitals, each with a handful of checks. They are comparisons rather than measurements: the bar of the H is compared with the centre of the letter, the leg of the L with the arm of the E."
      ),
      ...rows,
      el("hr"),
      el(
        "div",
        { class: "row" },
        el(
          "button",
          { type: "button", onclick: () => this._setView({ kind: "overview" }) },
          "← Back to the course"
        )
      ),
    ];
  }

  _renderGlossary() {
    const entries = glossaryEntries(this.course);
    const search = el("input", {
      class: "search",
      type: "search",
      placeholder: "search the glossary",
    });
    const list = el("dl", { class: "glossary" });

    const draw = () => {
      const query = (search.value || "").trim().toLowerCase();
      const matching = entries.filter((entry) => {
        if (!query) {
          return true;
        }
        const haystack = [entry.term, entry.definition, ...(entry.also || [])]
          .join(" ")
          .toLowerCase();
        return haystack.includes(query);
      });
      list.replaceChildren(
        ...matching.flatMap((entry) => [
          el("dt", {}, entry.term),
          el(
            "dd",
            {},
            entry.definition,
            entry.also?.length
              ? el("span", { class: "also" }, ` (also: ${entry.also.join(", ")})`)
              : null
          ),
        ])
      );
      if (!matching.length) {
        list.replaceChildren(el("dd", { class: "empty" }, "Nothing matches that."));
      }
    };

    search.addEventListener("input", draw);
    draw();

    return [
      el("p", { class: "eyebrow" }, "Reference"),
      el("h2", {}, "Glossary"),
      search,
      list,
      el("hr"),
      el(
        "div",
        { class: "row" },
        el(
          "button",
          { type: "button", onclick: () => this._setView({ kind: "overview" }) },
          "← Back to the course"
        )
      ),
    ];
  }
}

export function registerPanelClass() {
  if (!customElements.get("type-design-course-panel")) {
    customElements.define("type-design-course-panel", TypeDesignCoursePanel);
  }
}
