// course.js — the data layer of the Type Design School plug-in.
//
// Everything that can be reasoned about without a browser lives here:
// loading and validating the course document, walking the phases and
// lessons, and the learner's progress. The panel (panel.js) only draws
// what this module decides, and the tests (tests/course.test.mjs) only
// exercise what this module owns.
//
// The course document itself is the *corpus*: an original body of type
// design knowledge written for this plug-in. It is data, not code, so it
// can grow without touching the panel.

export const STORAGE_KEY = "fontra.type-design-course.progress";

export const PANEL_ID = "type-design-course";

// --- the course document -------------------------------------------------

const REQUIRED_PHASE_KEYS = ["id", "number", "title", "goal", "lessons"];
const REQUIRED_LESSON_KEYS = ["id", "title", "objective"];

/**
 * Check that a course document is usable.
 *
 * A broken course document must not take the panel down: the panel shows
 * the error instead of the course. This returns the list of problems
 * rather than throwing, so the panel can show all of them at once.
 *
 * @param {any} course
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateCourse(course) {
  const errors = [];
  if (!course || typeof course !== "object") {
    return { ok: false, errors: ["The course document is missing."] };
  }
  if (!course.meta || typeof course.meta !== "object") {
    errors.push("The course document has no meta section.");
  }
  if (!Array.isArray(course.phases) || !course.phases.length) {
    errors.push("The course document has no phases.");
    return { ok: false, errors };
  }

  const phaseIds = new Set();
  const lessonIds = new Set();

  for (const [phaseIndex, phase] of course.phases.entries()) {
    const where = `Phase ${phaseIndex + 1}`;
    if (!phase || typeof phase !== "object") {
      errors.push(`${where}: not an object.`);
      continue;
    }
    for (const key of REQUIRED_PHASE_KEYS) {
      if (!phase[key]) {
        errors.push(`${where} (${phase.id || "?"}): missing "${key}".`);
      }
    }
    if (phaseIds.has(phase.id)) {
      errors.push(`${where}: duplicate phase id "${phase.id}".`);
    }
    phaseIds.add(phase.id);

    if (!Array.isArray(phase.lessons) || !phase.lessons.length) {
      errors.push(`${where} (${phase.id || "?"}): has no lessons.`);
      continue;
    }
    for (const lesson of phase.lessons) {
      if (!lesson || typeof lesson !== "object") {
        errors.push(`${where}: a lesson is not an object.`);
        continue;
      }
      for (const key of REQUIRED_LESSON_KEYS) {
        if (!lesson[key]) {
          errors.push(
            `${where} (${phase.id || "?"}): lesson "${lesson.id || "?"} is missing "${key}".`
          );
        }
      }
      if (lessonIds.has(lesson.id)) {
        errors.push(`${where}: duplicate lesson id "${lesson.id}".`);
      }
      lessonIds.add(lesson.id);
    }
  }

  if (!Array.isArray(course.glossary)) {
    errors.push("The course document has no glossary array.");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Every lesson of the course, in order, each with the phase it belongs to.
 * @param {any} course
 * @returns {{phase: any, lesson: any, phaseIndex: number, lessonIndex: number}[]}
 */
export function allLessons(course) {
  const result = [];
  if (!course?.phases) {
    return result;
  }
  for (const [phaseIndex, phase] of course.phases.entries()) {
    for (const [lessonIndex, lesson] of (phase.lessons || []).entries()) {
      result.push({ phase, lesson, phaseIndex, lessonIndex });
    }
  }
  return result;
}

/**
 * Find a lesson by its id, together with the phase it lives in.
 * @param {any} course
 * @param {string} lessonId
 */
export function findLesson(course, lessonId) {
  for (const entry of allLessons(course)) {
    if (entry.lesson.id === lessonId) {
      return entry;
    }
  }
  return null;
}

/**
 * The lesson that comes after the given one — the last lesson of the last
 * phase has no successor.
 * @param {any} course
 * @param {string} lessonId
 */
export function nextLesson(course, lessonId) {
  const lessons = allLessons(course);
  const index = lessons.findIndex((entry) => entry.lesson.id === lessonId);
  if (index < 0 || index >= lessons.length - 1) {
    return null;
  }
  return lessons[index + 1];
}

/**
 * The lesson that comes before the given one.
 * @param {any} course
 * @param {string} lessonId
 */
export function previousLesson(course, lessonId) {
  const lessons = allLessons(course);
  const index = lessons.findIndex((entry) => entry.lesson.id === lessonId);
  if (index <= 0) {
    return null;
  }
  return lessons[index - 1];
}

// --- progress ------------------------------------------------------------

/**
 * The shape of a progress record.
 * @returns {{done: Record<string, boolean>, checks: Record<string, boolean>}}
 */
export function emptyProgress() {
  return { done: {}, checks: {} };
}

/**
 * Read the learner's progress.
 *
 * A corrupted or missing record must not break the panel: an unreadable
 * record is simply an empty one.
 *
 * @param {Storage|null} storage
 */
export function loadProgress(storage) {
  const progress = emptyProgress();
  if (!storage) {
    return progress;
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return progress;
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (parsed.done && typeof parsed.done === "object") {
        progress.done = { ...parsed.done };
      }
      if (parsed.checks && typeof parsed.checks === "object") {
        progress.checks = { ...parsed.checks };
      }
    }
  } catch (e) {
    // Unreadable progress is the same as no progress.
  }
  return progress;
}

/**
 * Write the learner's progress.
 * @param {Storage|null} storage
 * @param {any} progress
 * @returns {boolean} whether it could be written
 */
export function saveProgress(storage, progress) {
  if (!storage) {
    return false;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * A copy of the progress with a lesson marked done (or not done).
 * @param {any} progress
 * @param {string} lessonId
 * @param {boolean} done
 */
export function withLessonDone(progress, lessonId, done) {
  const next = {
    done: { ...(progress?.done || {}) },
    checks: { ...(progress?.checks || {}) },
  };
  if (done) {
    next.done[lessonId] = true;
  } else {
    delete next.done[lessonId];
  }
  return next;
}

/**
 * A copy of the progress with one checklist item ticked (or not).
 * @param {any} progress
 * @param {string} checkId
 * @param {boolean} checked
 */
export function withCheck(progress, checkId, checked) {
  const next = {
    done: { ...(progress?.done || {}) },
    checks: { ...(progress?.checks || {}) },
  };
  if (checked) {
    next.checks[checkId] = true;
  } else {
    delete next.checks[checkId];
  }
  return next;
}

/**
 * Is a lesson done?
 * @param {any} progress
 * @param {string} lessonId
 */
export function isLessonDone(progress, lessonId) {
  return !!progress?.done?.[lessonId];
}

/**
 * Is a checklist item ticked?
 * @param {any} progress
 * @param {string} checkId
 */
export function isCheckDone(progress, checkId) {
  return !!progress?.checks?.[checkId];
}

/**
 * How much of a phase is done.
 * @param {any} progress
 * @param {any} phase
 * @returns {{done: number, total: number}}
 */
export function phaseProgress(progress, phase) {
  const lessons = (phase?.lessons || []).map((lesson) => lesson.id);
  return {
    done: lessons.filter((id) => isLessonDone(progress, id)).length,
    total: lessons.length,
  };
}

/**
 * How much of the whole course is done.
 * @param {any} progress
 * @param {any} course
 * @returns {{done: number, total: number, percent: number}}
 */
export function courseProgress(progress, course) {
  const lessons = allLessons(course).map((entry) => entry.lesson.id);
  const done = lessons.filter((id) => isLessonDone(progress, id)).length;
  const total = lessons.length;
  return {
    done,
    total,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}

/**
 * The first lesson the learner has not done yet — where to pick up.
 * @param {any} progress
 * @param {any} course
 */
export function resumeLesson(progress, course) {
  const lessons = allLessons(course);
  for (const entry of lessons) {
    if (!isLessonDone(progress, entry.lesson.id)) {
      return entry;
    }
  }
  return lessons.length ? lessons[lessons.length - 1] : null;
}

/**
 * How many checklist items of a lesson are ticked.
 * @param {any} progress
 * @param {any} lesson
 */
export function checkProgress(progress, lesson) {
  const items = lesson?.checklist || [];
  return {
    done: items.filter((_, index) => isCheckDone(progress, `${lesson.id}:${index}`))
      .length,
    total: items.length,
  };
}

/**
 * A flat, searchable glossary, with the terms sorted.
 * @param {any} course
 */
export function glossaryEntries(course) {
  const entries = (course?.glossary || []).filter(
    (entry) => entry && entry.term && entry.definition
  );
  return [...entries].sort((a, b) => a.term.localeCompare(b.term));
}
