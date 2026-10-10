// bunq-client voor de FinSight-server (officiële bunq Public API).
// Flow: installation (publieke sleutel) -> device-server (API-key) -> session-server,
// met RSA-SHA256-handtekening over de request-body. De installatie-context wordt in de
// doc-store bewaard ("meta/bunq-context"), dus de registratie gebeurt maar één keer.
const crypto = require("crypto");

const BASE = process.env.BUNQ_API_BASE || "https://api.bunq.com/v1";
const CTX_DOC = "meta/bunq-context";

function pick(items, key) { for (const it of items) if (it[key]) return it[key]; return undefined; }

class BunqClient {
  constructor(apiKey, store) { this.key = apiKey; this.store = store; }

  async _call(path, { body, token, priv } = {}) {
    const bodyStr = body != null ? JSON.stringify(body) : "";
    const headers = {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "User-Agent": "FinSight/1.0",
      "X-Bunq-Language": "nl_NL",
      "X-Bunq-Region": "nl_NL",
      "X-Bunq-Client-Request-Id": crypto.randomUUID(),
      "X-Bunq-Geolocation": "0 0 0 0 000",
    };
    if (token) headers["X-Bunq-Client-Authentication"] = token;
    if (priv) {
      const signer = crypto.createSign("RSA-SHA256");
      signer.update(bodyStr);
      headers["X-Bunq-Client-Signature"] = signer.sign(priv, "base64");
    }
    const res = await fetch(BASE + path, { method: body != null ? "POST" : "GET", headers, body: body != null ? bodyStr : undefined });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`bunq gaf een onleesbaar antwoord (HTTP ${res.status})`); }
    if (!res.ok) throw new Error(json.Error?.[0]?.error_description || `bunq-fout (HTTP ${res.status})`);
    return json.Response || [];
  }

  async _install() {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const priv = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
    const inst = await this._call("/installation", { body: { client_public_key: pub } });
    const token = pick(inst, "Token")?.token;
    if (!token) throw new Error("Geen installatie-token van bunq ontvangen.");
    await this._call("/device-server", { body: { description: "FinSight server", secret: this.key, permitted_ips: ["*"] }, token, priv });
    const ctx = { priv, inst: token };
    await this.store.set(CTX_DOC, ctx);
    return ctx;
  }

  async connect() {
    let ctx = await this.store.get(CTX_DOC);
    const open = async (c) => {
      const s = await this._call("/session-server", { body: { secret: this.key }, token: c.inst, priv: c.priv });
      const token = pick(s, "Token")?.token;
      const user = pick(s, "UserPerson") || pick(s, "UserCompany") || pick(s, "UserApiKey");
      if (!token || !user) throw new Error("Sessie openen bij bunq mislukt.");
      this.session = token; this.userId = user.id; this.priv = c.priv;
    };
    if (ctx && ctx.priv && ctx.inst) {
      try { await open(ctx); return; } catch { /* context verouderd → opnieuw registreren */ }
    }
    await open(await this._install());
  }

  /** Alle EUR-betalingen van de laatste `days` dagen, als app-regels in centen. */
  async rows(days) {
    await this.connect();
    const cutoff = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const auth = { token: this.session, priv: this.priv };
    const accItems = await this._call(`/user/${this.userId}/monetary-account`, auth);
    const accounts = [];
    const rows = [];
    for (const it of accItems) {
      const a = it.MonetaryAccountBank || it.MonetaryAccountSavings || it.MonetaryAccountJoint;
      if (!a || a.status === "CANCELLED") continue;
      const iban = (a.alias || []).find((x) => x.type === "IBAN")?.value || `bunq-${a.id}`;
      accounts.push({ naam: a.description || "bunq-rekening", iban, saldo: a.balance ? parseFloat(a.balance.value) : null });
      const payItems = await this._call(`/user/${this.userId}/monetary-account/${a.id}/payment?count=200`, auth);
      for (const pi of payItems) {
        const p = pi.Payment;
        if (!p || p.amount.currency !== "EUR") continue;
        const date = (p.created || "").slice(0, 10);
        if (!date || date < cutoff) continue;
        const amount = Math.round(parseFloat(p.amount.value) * 100);
        if (!amount) continue;
        rows.push({
          date, amount, iban,
          time: (p.created || "").slice(11, 16) || undefined,
          payee: p.counterparty_alias?.display_name || p.counterparty_alias?.iban || "Onbekend",
          desc: (p.description || "").trim(),
        });
      }
    }
    rows.sort((x, y) => (x.date < y.date ? -1 : 1));
    return { accounts, rows, cutoff };
  }
}

module.exports = { BunqClient };
