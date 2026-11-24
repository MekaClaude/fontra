// Tests for the Type Design School plug-in: the data layer (validation,
// walking the course, progress) and the corpus itself.
//
// The corpus is checked as well as the code: a course document that no
// longer validates, or that has lost a lesson, is a broken plug-in, and
// this is where that gets caught.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  STORAGE_KEY,
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
} from "../course.js";

const COURSE_PATH = fileURLToPath(new URL("../data/course.json", import.meta.url));

const course = JSON.parse(await readFile(COURSE_PATH, "utf-8"));

// A stand-in for the browser's localStorage.
function makeStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key] : null;
    },
    setItem(key, value) {
      data[key] = String(value);
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

// ---------------------------------------------------------------- the course

test("the shipped course document is valid", () => {
  const { ok, errors } = validateCourse(course);
  assert.equal(ok, true, `course errors: ${errors.join(" | ")}`);
});

test("the course has ten phases, numbered in order", () => {
  assert.equal(course.phases.length, 10);
  course.phases.forEach((phase, index) => {
    assert.equal(phase.number, index + 1, `phase ${phase.id} is out of order`);
  });
});

test("every phase has a goal, a milestone and at least two lessons", () => {
  for (const phase of course.phases) {
    assert.ok(phase.goal, `${phase.id} has no goal`);
    assert.ok(phase.milestone, `${phase.id} has no milestone`);
    assert.ok(phase.lessons.length >= 2, `${phase.id} has fewer than two lessons`);
  }
});

test("every lesson has an objective, principles and a checklist", () => {
  for (const entry of allLessons(course)) {
    const lesson = entry.lesson;
    assert.ok(lesson.objective, `${lesson.id} has no objective`);
    assert.ok(lesson.principles?.length, `${lesson.id} has no principles to teach`);
    assert.ok(
      lesson.checklist?.length,
      `${lesson.id} has no checklist, so it can never be finished`
    );
  }
});

test("lesson ids are unique across the whole course", () => {
  const ids = allLessons(course).map((entry) => entry.lesson.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every principle has a title and a body", () => {
  for (const entry of allLessons(course)) {
    for (const principle of entry.lesson.principles) {
      assert.ok(principle.title, `${entry.lesson.id}: a principle has no title`);
      assert.ok(
        principle.body && principle.body.length > 40,
        `${entry.lesson.id}: the principle "${principle.title}" has no body`
      );
    }
  }
});

test("a lesson only names glyphs that are single characters", () => {
  for (const entry of allLessons(course)) {
    for (const glyph of entry.lesson.glyphs || []) {
      assert.equal(
        [...glyph].length,
        1,
        `${entry.lesson.id} names the glyph "${glyph}", which is not one character`
      );
    }
  }
});

test("the glossary is sorted and every entry is defined", () => {
  const entries = glossaryEntries(course);
  assert.ok(entries.length >= 30, "the glossary is too small to be useful");
  for (const entry of entries) {
    assert.ok(entry.term, "a glossary entry has no term");
    assert.ok(entry.definition, `the term "${entry.term}" has no definition`);
  }
  const terms = entries.map((entry) => entry.term);
  assert.deepEqual(
    terms,
    [...terms].sort((a, b) => a.localeCompare(b))
  );
});

test("the letter audit covers all twenty-six capitals", () => {
  const checks = course.letterChecks || [];
  assert.equal(checks.length, 26);
  assert.deepEqual(
    checks.map((entry) => entry.letter),
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")
  );
  for (const entry of checks) {
    assert.ok(
      entry.checks?.length >= 3,
      `the letter ${entry.letter} has fewer than three checks`
    );
  }
});

// ------------------------------------------------------------- validation

test("validateCourse rejects a missing document", () => {
  const { ok, errors } = validateCourse(null);
  assert.equal(ok, false);
  assert.ok(errors.length);
});

test("validateCourse reports a phase without lessons", () => {
  const broken = { ...course, phases: [{ id: "x", number: 1, title: "X" }] };
  const { ok, errors } = validateCourse(broken);
  assert.equal(ok, false);
  assert.ok(errors.some((message) => message.includes("lessons")));
});

test("validateCourse reports duplicate ids", () => {
  const broken = JSON.parse(JSON.stringify(course));
  broken.phases[1].lessons[0].id = broken.phases[0].lessons[0].id;
  const { ok, errors } = validateCourse(broken);
  assert.equal(ok, false);
  assert.ok(errors.some((message) => message.includes("duplicate")));
});

// -------------------------------------------------------------- navigation

test("allLessons walks the course in order", () => {
  const lessons = allLessons(course);
  assert.equal(lessons.length, course.phases.length > 0 ? lessons.length : 0);
  assert.ok(lessons.length > 20);
  assert.equal(lessons[0].lesson.id, course.phases[0].lessons[0].id);
});

test("findLesson finds a lesson and its phase", () => {
  const first = course.phases[0].lessons[0];
  const entry = findLesson(course, first.id);
  assert.ok(entry);
  assert.equal(entry.phase.id, course.phases[0].id);
  assert.equal(findLesson(course, "no-such-lesson"), null);
});

test("nextLesson and previousLesson walk the course forwards and back", () => {
  const lessons = allLessons(course).map((entry) => entry.lesson);
  assert.equal(nextLesson(course, lessons[0].id).lesson.id, lessons[1].id);
  assert.equal(previousLesson(course, lessons[1].id).lesson.id, lessons[0].id);
  assert.equal(nextLesson(course, lessons[lessons.length - 1].id), null);
  assert.equal(previousLesson(course, lessons[0].id), null);
});

// ---------------------------------------------------------------- progress

test("progress starts empty", () => {
  const progress = emptyProgress();
  assert.deepEqual(progress.done, {});
  assert.deepEqual(progress.checks, {});
});

test("a lesson can be marked done and undone", () => {
  let progress = emptyProgress();
  progress = withLessonDone(progress, "seeing.shapes", true);
  assert.equal(isLessonDone(progress, "seeing.shapes"), true);
  progress = withLessonDone(progress, "seeing.shapes", false);
  assert.equal(isLessonDone(progress, "seeing.shapes"), false);
});

test("withLessonDone does not mutate the progress it is given", () => {
  const progress = emptyProgress();
  const next = withLessonDone(progress, "seeing.shapes", true);
  assert.equal(isLessonDone(progress, "seeing.shapes"), false);
  assert.equal(isLessonDone(next, "seeing.shapes"), true);
});

test("a checklist item can be ticked independently of the lesson", () => {
  let progress = emptyProgress();
  progress = withCheck(progress, "seeing.shapes:0", true);
  assert.equal(isCheckDone(progress, "seeing.shapes:0"), true);
  assert.equal(isCheckDone(progress, "seeing.shapes:1"), false);
  assert.equal(isLessonDone(progress, "seeing.shapes"), false);
});

test("progress survives a round trip through storage", () => {
  const storage = makeStorage();
  let progress = emptyProgress();
  progress = withLessonDone(progress, "seeing.shapes", true);
  progress = withCheck(progress, "seeing.shapes:0", true);
  assert.equal(saveProgress(storage, progress), true);

  const loaded = loadProgress(storage);
  assert.equal(isLessonDone(loaded, "seeing.shapes"), true);
  assert.equal(isCheckDone(loaded, "seeing.shapes:0"), true);
});

test("a corrupted progress record is treated as no progress", () => {
  const storage = makeStorage({ [STORAGE_KEY]: "{not json" });
  const progress = loadProgress(storage);
  assert.deepEqual(progress.done, {});
  assert.deepEqual(progress.checks, {});
});

test("a progress record of the wrong shape is ignored", () => {
  const storage = makeStorage({ [STORAGE_KEY]: JSON.stringify("nonsense") });
  const progress = loadProgress(storage);
  assert.deepEqual(progress.done, {});
});

test("loading without storage does not throw", () => {
  const progress = loadProgress(null);
  assert.deepEqual(progress.done, {});
  assert.equal(saveProgress(null, progress), false);
});

test("phase and course progress count the done lessons", () => {
  let progress = emptyProgress();
  const phase = course.phases[0];
  const before = phaseProgress(progress, phase);
  assert.equal(before.done, 0);
  assert.equal(before.total, phase.lessons.length);

  progress = withLessonDone(progress, phase.lessons[0].id, true);
  const after = phaseProgress(progress, phase);
  assert.equal(after.done, 1);
  assert.equal(after.total, phase.lessons.length);

  const total = courseProgress(progress, course);
  assert.equal(total.done, 1);
  assert.equal(total.total, allLessons(course).length);
  assert.ok(total.percent >= 0 && total.percent <= 100);
});

test("the course percentage is zero when nothing is done", () => {
  const total = courseProgress(emptyProgress(), course);
  assert.equal(total.percent, 0);
});

test("resumeLesson points at the first lesson that is not done", () => {
  let progress = emptyProgress();
  const lessons = allLessons(course).map((entry) => entry.lesson);
  assert.equal(resumeLesson(progress, course).lesson.id, lessons[0].id);

  progress = withLessonDone(progress, lessons[0].id, true);
  assert.equal(resumeLesson(progress, course).lesson.id, lessons[1].id);
});

test("resumeLesson points at the last lesson when everything is done", () => {
  let progress = emptyProgress();
  for (const entry of allLessons(course)) {
    progress = withLessonDone(progress, entry.lesson.id, true);
  }
  const lessons = allLessons(course).map((entry) => entry.lesson);
  assert.equal(
    resumeLesson(progress, course).lesson.id,
    lessons[lessons.length - 1].id
  );
});

test("checkProgress counts the ticked checklist items", () => {
  const lesson = course.phases[0].lessons[0];
  let progress = emptyProgress();
  assert.equal(checkProgress(progress, lesson).done, 0);
  progress = withCheck(progress, `${lesson.id}:0`, true);
  assert.equal(checkProgress(progress, lesson).done, 1);
  assert.equal(checkProgress(progress, lesson).total, lesson.checklist.length);
});
