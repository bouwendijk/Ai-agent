"""
Niet-interactief dagrapport voor GitHub Actions (of cron).

Haalt transacties op (live via bunq, of uit een CSV als eerste argument),
laat Claude het gezondheidsrapport maken, schrijft het als Markdown naar
rapport.md en maakt er — als dit in GitHub Actions draait — een GitHub Issue
van, zodat je er een melding van krijgt.

Gebruik:  python -m finsight.report [export.csv]
Env:      ANTHROPIC_API_KEY (verplicht), BUNQ_API_KEY (voor live),
          GITHUB_TOKEN + GITHUB_REPOSITORY (door Actions geleverd, voor het Issue).
"""
import json
import os
import sys
from datetime import date

import requests
from dotenv import load_dotenv

from . import agent
from .main import LASTEN_PATH, aggregeer, haal_bunq, lees_csv

load_dotenv()


def to_markdown(r: dict) -> str:
    if "error" in r:
        return f"# FinSight rapport {date.today().isoformat()}\n\n⚠️ Fout: {r['error']}\n"
    mr = r.get("maandruimte") or {}
    md = [
        f"# 💶 FinSight rapport — {date.today().strftime('%d-%m-%Y')}",
        f"\n**Gezondheidsscore: {r.get('score', '?')}/10**\n",
        r.get("samenvatting", ""),
        "\n## Maandruimte",
        f"| Inkomsten | Uitgaven | Ruimte |\n|---:|---:|---:|\n"
        f"| € {mr.get('inkomsten', 0):,.2f} | € {mr.get('uitgaven', 0):,.2f} | **€ {mr.get('ruimte', 0):,.2f}** |",
        mr.get("toelichting", ""),
    ]
    if r.get("risicos"):
        md.append("\n## ⚠️ Risico's")
        for x in r["risicos"]:
            md.append(f"- **[{x.get('ernst')}] {x.get('risico')}** — {x.get('waarom')}")
    if r.get("acties"):
        md.append("\n## ✅ Acties")
        for i, a in enumerate(r["acties"], 1):
            md.append(f"{i}. **{a.get('actie')}** *(⏰ {a.get('deadline')})* — {a.get('effect')}")
    if r.get("schulden_prioriteit"):
        md.append("\n## 📋 Aflosvolgorde")
        for s in sorted(r["schulden_prioriteit"], key=lambda x: x.get("volgorde", 99)):
            md.append(f"{s.get('volgorde')}. **{s.get('schuldeiser')}** (€ {s.get('bedrag', 0):,.2f}) — {s.get('reden')}")
    return "\n".join(md) + "\n"


def push_melding(r: dict) -> None:
    """Pushmelding naar je telefoon via ntfy (zet NTFY_TOPIC als secret;
    installeer de gratis ntfy-app en abonneer je daar op hetzelfde topic)."""
    topic = os.getenv("NTFY_TOPIC")
    if not topic or "error" in r:
        return
    mr = r.get("maandruimte") or {}
    acties = r.get("acties") or []
    regel1 = f"Score {r.get('score', '?')}/10 · ruimte € {mr.get('ruimte', 0):,.0f}/mnd"
    regel2 = f"Vandaag: {acties[0]['actie']}" if acties else ""
    try:
        resp = requests.post(
            f"https://ntfy.sh/{topic}",
            data=(regel1 + ("\n" + regel2 if regel2 else "")).encode("utf-8"),
            headers={"Title": "FinSight dagrapport", "Tags": "moneybag",
                     "Priority": "high" if isinstance(r.get("score"), (int, float)) and r["score"] < 5 else "default"},
            timeout=15,
        )
        print("Pushmelding:", "verzonden" if resp.ok else f"mislukt (HTTP {resp.status_code})")
    except requests.RequestException as e:
        print("Pushmelding mislukt:", e)


def maak_issue(md: str) -> None:
    token, repo = os.getenv("GITHUB_TOKEN"), os.getenv("GITHUB_REPOSITORY")
    if not token or not repo:
        print("Geen GITHUB_TOKEN/GITHUB_REPOSITORY — Issue overgeslagen (rapport staat in rapport.md).")
        return
    resp = requests.post(
        f"https://api.github.com/repos/{repo}/issues",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
        json={"title": f"💶 FinSight rapport {date.today().isoformat()}",
              "body": md, "labels": ["finsight"]},
        timeout=30,
    )
    if resp.ok:
        print("Issue aangemaakt:", resp.json().get("html_url"))
    else:
        print(f"Issue maken mislukte (HTTP {resp.status_code}): {resp.text[:200]}")


def main() -> None:
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("ANTHROPIC_API_KEY ontbreekt.")
        sys.exit(1)

    if len(sys.argv) > 1 and sys.argv[1].lower().endswith(".csv"):
        tx, accounts = lees_csv(sys.argv[1]), []
    elif os.getenv("BUNQ_API_KEY"):
        accounts, tx = haal_bunq()
    else:
        print("Geen BUNQ_API_KEY en geen CSV — niets te rapporteren.")
        sys.exit(1)

    lasten = json.loads(LASTEN_PATH.read_text(encoding="utf-8")) if LASTEN_PATH.exists() else None
    summary = aggregeer(tx)
    if accounts:
        summary["huidige_saldi"] = [{"rekening": a["naam"], "saldo": a["saldo"]} for a in accounts]

    rapport = agent.analyze(summary, lasten)
    md = to_markdown(rapport)
    with open("rapport.md", "w", encoding="utf-8") as f:
        f.write(md)
    print(md)
    maak_issue(md)
    push_melding(rapport)


if __name__ == "__main__":
    main()
