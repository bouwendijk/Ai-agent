// Document-opslag voor FinSight: Postgres (DATABASE_URL) of een lokale map (voor tests).
// Documenten zijn JSON op een pad zoals "months/2026-10" of "meta/config".
const fs = require("fs");
const path = require("path");

class Store {
  constructor(dbUrl, dataDir) {
    if (dbUrl) {
      const { Pool } = require("pg");
      this.pool = new Pool({
        connectionString: dbUrl,
        ssl: /localhost|127\.0\.0\.1/.test(dbUrl) ? false : { rejectUnauthorized: false },
      });
      this.ready = this.pool.query(
        "CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data JSONB NOT NULL, updated TIMESTAMPTZ DEFAULT now())"
      );
    } else {
      this.dir = dataDir;
      fs.mkdirSync(dataDir, { recursive: true });
    }
  }
  _file(p) { return path.join(this.dir, encodeURIComponent(p) + ".json"); }

  async get(p) {
    if (this.pool) {
      await this.ready;
      const r = await this.pool.query("SELECT data FROM docs WHERE path = $1", [p]);
      return r.rows[0] ? r.rows[0].data : null;
    }
    const f = this._file(p);
    return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
  }

  async set(p, data) {
    if (this.pool) {
      await this.ready;
      await this.pool.query(
        "INSERT INTO docs (path, data, updated) VALUES ($1, $2, now()) ON CONFLICT (path) DO UPDATE SET data = $2, updated = now()",
        [p, data]
      );
      return;
    }
    fs.writeFileSync(this._file(p), JSON.stringify(data));
  }

  async list(prefix) {
    if (this.pool) {
      await this.ready;
      const r = await this.pool.query("SELECT path, data FROM docs WHERE path LIKE $1", [prefix + "/%"]);
      return r.rows
        .map((x) => ({ id: x.path.slice(prefix.length + 1), data: x.data }))
        .filter((x) => !x.id.includes("/"));
    }
    const pre = encodeURIComponent(prefix + "/");
    return fs.readdirSync(this.dir)
      .filter((f) => f.startsWith(pre) && f.endsWith(".json"))
      .map((f) => {
        const p = decodeURIComponent(f.slice(0, -5));
        return { id: p.slice(prefix.length + 1), data: JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf8")) };
      })
      .filter((x) => !x.id.includes("/"));
  }
}

module.exports = { Store };
