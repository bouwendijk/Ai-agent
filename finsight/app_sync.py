"""
Dagelijkse sync, stap 1: bunq → sync-rows.json (voor de FinSight-app).

Haalt alle betalingen van de laatste FINSIGHT_SYNC_DAGEN (standaard 45) op
en schrijft ze als app-regels in centen:
  {"cutoff": "...", "accounts": [...], "rows": [{"date","amount","payee","desc","iban"}]}

Gebruik:  python finsight/app_sync.py [uitvoerpad]
Env:      BUNQ_API_KEY (verplicht), FINSIGHT_SYNC_DAGEN (optioneel)
"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from finsight.bunq_fetcher import BunqClient  # noqa: E402


def main() -> None:
    key = os.getenv("BUNQ_API_KEY", "")
    if not key:
        print("Geen BUNQ_API_KEY in de omgeving.", file=sys.stderr)
        sys.exit(1)
    dagen = int(os.getenv("FINSIGHT_SYNC_DAGEN", "45"))
    cutoff = (datetime.date.today() - datetime.timedelta(days=dagen)).isoformat()

    client = BunqClient(key)
    client.connect()
    accounts = client.accounts()
    rows = []
    for acc in accounts:
        for p in client.payments(acc["id"]):
            d = (p.get("datum") or "")[:10]
            if not d or d < cutoff:
                continue
            rows.append({
                "date": d,
                "amount": round(float(p.get("bedrag") or 0) * 100),
                "payee": (p.get("naam") or "Onbekend").strip() or "Onbekend",
                "desc": (p.get("omschrijving") or "").strip(),
                "iban": acc.get("iban", ""),
            })
    rows = [r for r in rows if r["amount"]]

    out = sys.argv[1] if len(sys.argv) > 1 else "sync-rows.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump({
            "cutoff": cutoff,
            "accounts": [{"naam": a["naam"], "iban": a["iban"], "saldo": a["saldo"]} for a in accounts],
            "rows": rows,
        }, f, ensure_ascii=False)
    print(f"{len(rows)} rijen sinds {cutoff} -> {out}")
    for a in accounts:
        print(f"  {a['naam']} ({a['iban']}): EUR {a['saldo']:.2f}")


if __name__ == "__main__":
    main()
