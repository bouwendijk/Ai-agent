// Dagelijkse sync, stap 2: sync-rows.json + bestaande maand-docs → bijgewerkte maand-docs.
//
// - hoofdrekening  NL61…0150 → gewone banktransacties, gelabeld met de autoCat uit de
//   app zelf (de HTML van het gepubliceerde artifact wordt ingeladen, dus labels en
//   woordenboek lopen nooit uit de pas met de app);
// - spaarrekening  NL49…8271 ("Mijn Doel 5000") → spaarpot (acc:"spaar", cat:"potje");
// - kleine afschrijvingen naar jezelf (≤ €1, bank-kant van bunq's auto-sparen) → cat "potje";
// - overige rekeningen → overslaan;
// - dedupe met occurrence-telling (datum|bedrag|naam) — idempotent bij opnieuw draaien.
//
// Gebruik: node finsight/app_merge.js <sync-rows.json> <monthsdir> <app.html> <config.json|-> <outdir>
//   monthsdir : map met de huidige maand-docs uit de artifact-db ({txs:[...]} per bestand)
//   config.json: inhoud van meta/config uit de db, of "-" als die niet bestaat
//   outdir    : hier komen alléén de gewijzigde maand-docs te staan
const fs = require("fs");
const path = require("path");

const [rowsFile, monthsDir, appHtml, configFile, outDir] = process.argv.slice(2);
if (!outDir) { console.error("gebruik: node app_merge.js rows.json monthsdir app.html config.json|- outdir"); process.exit(1); }

const MAIN = "NL61BUNQ2042260150";
const SPAAR = "NL49BUNQ2105588271";

// app-logica (autoCat, CATS_DEFAULT, uid) uit de echte app-HTML laden met DOM-stubs
const src = fs.readFileSync(appHtml, "utf8").match(/<script>([\s\S]*)<\/script>/)[1];
const stubEl = { addEventListener() {}, classList: { toggle() {}, add() {}, remove() {} }, dataset: {}, style: {}, innerHTML: "", textContent: "", className: "", value: "", showModal() {}, close() {}, appendChild() {}, remove() {}, focus() {} };
const sandbox = {
  document: { querySelector: () => stubEl, querySelectorAll: () => [], createElement: () => ({ ...stubEl }), body: { appendChild() {} }, documentElement: { dataset: {} }, addEventListener() {} },
  window: { matchMedia: () => ({ matches: false, addEventListener() {} }), addEventListener() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: {}, claude: null, console,
  location: { hash: "" }, history: { replaceState() {} },
  setTimeout: () => 0, addEventListener() {},
};
process.on("unhandledRejection", () => {});
const keys = Object.keys(sandbox);
const app = new Function(...keys, src + "\n;return { state, autoCat, CATS_DEFAULT, uid };")(...keys.map((k) => sandbox[k]));

const config = configFile && configFile !== "-" && fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : null;
app.state.config = config && Array.isArray(config.cats) && config.cats.length
  ? { ...config, rules: config.rules || [] }
  : { cats: app.CATS_DEFAULT, rules: config?.rules || [] };

const rows = JSON.parse(fs.readFileSync(rowsFile, "utf8")).rows;
const months = {};
for (const f of fs.readdirSync(monthsDir)) if (f.endsWith(".json"))
  months[f.replace(".json", "")] = JSON.parse(fs.readFileSync(path.join(monthsDir, f), "utf8")).txs;

const have = {};
for (const l of Object.values(months)) for (const t of l) { const k = t.date + "|" + t.amount + "|" + t.payee; have[k] = (have[k] || 0) + 1; }
const inF = {};
let bank = 0, spaar = 0, dup = 0, skip = 0;
const dirty = new Set();
for (const r of rows) {
  if (r.iban !== MAIN && r.iban !== SPAAR) { skip++; continue; }
  const k = r.date + "|" + r.amount + "|" + r.payee;
  inF[k] = (inF[k] || 0) + 1;
  if (inF[k] <= (have[k] || 0)) { dup++; continue; }
  const ym = r.date.slice(0, 7);
  const t = { id: app.uid(), date: r.date, amount: r.amount, payee: r.payee, desc: r.desc || "" };
  if (r.iban === SPAAR) {
    t.acc = "spaar"; t.cat = "potje"; t.desc = t.desc || "Mijn Doel 5000"; spaar++;
  } else {
    t.cat = app.autoCat(r.payee, r.desc || "", r.amount);
    // bank-kant van bunq auto-sparen: mini-afschrijving naar jezelf = potje-overboeking
    if (!t.cat && r.payee === "B. Ouwendijk" && r.amount < 0 && r.amount >= -100) t.cat = "potje";
    bank++;
  }
  (months[ym] = months[ym] || []).push(t);
  dirty.add(ym);
}
fs.mkdirSync(outDir, { recursive: true });
for (const ym of dirty) fs.writeFileSync(path.join(outDir, ym + ".json"), JSON.stringify({ txs: months[ym] }));
console.log(JSON.stringify({ bank_nieuw: bank, spaar_nieuw: spaar, dubbel: dup, andere_rek: skip, maanden: [...dirty].sort() }));
