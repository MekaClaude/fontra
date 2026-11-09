// Where the guide is, for a plug-in loaded from `pluginPath`.
//
// jsDelivr serves an .html file as text/plain — on purpose: no web pages from
// a CDN — so when the plug-in comes from there (the address
// `Uplus-Type/fontra-umarks` in Settings › Plugins), the guide is the same page
// published by GitHub Pages from the public repository. Served by Hive, Pak or
// a local server, it is the page next to the plug-in's files.

export const GUIDE_PAGES_URL = "https://uplus-type.github.io/fontra-umarks/guide/";

const JSDELIVR = /^https:\/\/cdn\.jsdelivr\.net\/gh\/Uplus-Type\/fontra-umarks(@[^/]*)?\/?$/i;

export function guideURLFor(pluginPath) {
  if (JSDELIVR.test(pluginPath || "")) {
    return GUIDE_PAGES_URL;
  }
  const base = String(pluginPath || "").replace(/\/$/, "");
  return `${base}/guide/index.html`;
}
