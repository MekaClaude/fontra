/**
 * Development auto-registration for the U+Marks plugin.
 *
 * Paste this into the browser console on the editor page:
 *
 *   javascript:(()=>{const k="fontra.pluginsplugins";const p="/localplugins/fontra-umarks/";const a=JSON.parse(localStorage.getItem(k)||"[]");if(!a.some(x=>(x.address||"").includes("fontra-umarks"))){a.push({address:p});localStorage.setItem(k,JSON.stringify(a));location.reload();}})();
 */
(function autoRegisterUMarks() {
  const STORAGE_KEY = "fontra.pluginsplugins";
  const PLUGIN_ADDRESS = "/localplugins/fontra-umarks/";

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const plugins = raw ? JSON.parse(raw) : [];

    const alreadyRegistered = plugins.some(
      (plugin) =>
        plugin && typeof plugin.address === "string" &&
        plugin.address.includes("fontra-umarks")
    );

    if (!alreadyRegistered) {
      plugins.push({ address: PLUGIN_ADDRESS });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
      console.log(
        "[U+Marks] Plugin auto-registered. Reloading to activate..."
      );
      setTimeout(() => location.reload(), 500);
    }
  } catch (e) {
    console.warn("[U+Marks] Auto-registration failed:", e);
  }
})();
