"""
FinSight Agent — financiële gezondheid via bunq + Claude.

Gebruik:
  python -m finsight.main                      # live via bunq (BUNQ_API_KEY in .env)
  python -m finsight.main export.csv           # of: offline via een bunq CSV-export
  python -m finsight.main export.csv "vraag"   # met een vrije vraag aan de coach
"""
import csv
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

from dotenv import load_dotenv
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from . import agent

load_dotenv()
console = Console()

ERNST_KLEUR = {"HOOG": "bold red", "MIDDEL": "yellow", "LAAG": "green"}
LASTEN_PATH = Path(__file__).parent / "lasten.json"


def lees_csv(pad: str) -> list[dict]:
    """Leest een bunq CSV-export (Date, Amount, Counterparty, Name, Description)."""
    rows = []
    with open(pad, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            try:
                bedrag = float((r.get("Amount") or "0").replace(".", "").replace(",", "."))
            except ValueError:
                continue
            rows.append({
                "datum": (r.get("Date") or "")[:10],
                "bedrag": bedrag,
                "naam": (r.get("Name") or r.get("Counterparty") or "Onbekend").strip(),
                "omschrijving": (r.get("Description") or "").strip().strip('"'),
            })
    return rows


def haal_bunq() -> tuple[list[dict], list[dict]]:
    from .bunq_fetcher import BunqClient
    client = BunqClient(os.getenv("BUNQ_API_KEY", ""))
    console.print("[dim]Verbinden met bunq…[/dim]")
    client.connect()
    accounts = client.accounts()
    tx: list[dict] = []
    for acc in accounts:
        tx += client.payments(acc["id"])
    return accounts, tx


def aggregeer(tx: list[dict]) -> dict:
    """Comprimeert duizenden transacties tot een samenvatting die Claude aankan."""
    maanden: dict = defaultdict(lambda: {"in": 0.0, "uit": 0.0})
    partijen: dict = defaultdict(lambda: {"totaal": 0.0, "n": 0})
    for t in tx:
        m = t["datum"][:7]
        if not m:
            continue
        if t["bedrag"] > 0:
            maanden[m]["in"] += t["bedrag"]
        else:
            maanden[m]["uit"] += -t["bedrag"]
        p = partijen[t["naam"][:40]]
        p["totaal"] += t["bedrag"]
        p["n"] += 1
    laatste = sorted(maanden)[-12:]
    top_uit = sorted(partijen.items(), key=lambda kv: kv[1]["totaal"])[:15]
    top_in = sorted(partijen.items(), key=lambda kv: -kv[1]["totaal"])[:8]
    return {
        "aantal_transacties": len(tx),
        "periode": f"{min(maanden) if maanden else '?'} t/m {max(maanden) if maanden else '?'}",
        "per_maand_laatste_12": {m: {k: round(v, 2) for k, v in maanden[m].items()} for m in laatste},
        "grootste_uitgavenpartijen": [
            {"naam": n, "totaal": round(d["totaal"], 2), "keer": d["n"]} for n, d in top_uit],
        "grootste_inkomstenbronnen": [
            {"naam": n, "totaal": round(d["totaal"], 2), "keer": d["n"]} for n, d in top_in],
    }


def toon(rapport: dict) -> None:
    if "error" in rapport:
        console.print(f"[red]Fout:[/red] {rapport['error']}")
        return
    score = rapport.get("score", "?")
    kleur = "green" if isinstance(score, (int, float)) and score >= 7 else \
            "yellow" if isinstance(score, (int, float)) and score >= 5 else "red"
    console.print(Panel(
        f"[bold {kleur}]Gezondheidsscore: {score}/10[/bold {kleur}]\n\n{rapport.get('samenvatting', '')}",
        title="💶 FinSight", box=box.ROUNDED))

    mr = rapport.get("maandruimte") or {}
    console.print(Panel(
        f"Inkomsten  € {mr.get('inkomsten', 0):>10,.2f}\n"
        f"Uitgaven   € {mr.get('uitgaven', 0):>10,.2f}\n"
        f"[bold]Ruimte     € {mr.get('ruimte', 0):>10,.2f}[/bold]\n{mr.get('toelichting', '')}",
        title="Maandruimte", box=box.ROUNDED))

    if rapport.get("risicos"):
        t = Table(title="⚠️  Risico's", box=box.SIMPLE_HEAVY)
        t.add_column("Ernst"); t.add_column("Risico"); t.add_column("Waarom")
        for r in rapport["risicos"]:
            t.add_row(f"[{ERNST_KLEUR.get(r.get('ernst', ''), 'white')}]{r.get('ernst')}[/]",
                      r.get("risico", ""), r.get("waarom", ""))
        console.print(t)

    if rapport.get("acties"):
        t = Table(title="✅ Acties", box=box.SIMPLE_HEAVY)
        t.add_column("#"); t.add_column("Actie"); t.add_column("Wanneer"); t.add_column("Effect")
        for i, a in enumerate(rapport["acties"], 1):
            t.add_row(str(i), a.get("actie", ""), a.get("deadline", ""), a.get("effect", ""))
        console.print(t)

    if rapport.get("schulden_prioriteit"):
        t = Table(title="📋 Aflosvolgorde", box=box.SIMPLE_HEAVY)
        t.add_column("#"); t.add_column("Schuldeiser"); t.add_column("Bedrag", justify="right"); t.add_column("Reden")
        for s in sorted(rapport["schulden_prioriteit"], key=lambda x: x.get("volgorde", 99)):
            t.add_row(str(s.get("volgorde", "")), s.get("schuldeiser", ""),
                      f"€ {s.get('bedrag', 0):,.2f}", s.get("reden", ""))
        console.print(t)

    if rapport.get("antwoord_op_vraag"):
        console.print(Panel(str(rapport["antwoord_op_vraag"]), title="Antwoord op je vraag", box=box.ROUNDED))


def main() -> None:
    if not os.getenv("ANTHROPIC_API_KEY"):
        console.print("[red]ANTHROPIC_API_KEY ontbreekt in .env[/red]")
        sys.exit(1)

    args = [a for a in sys.argv[1:]]
    vraag = None
    if len(args) >= 2:
        vraag = args[1]

    if args and args[0].lower().endswith(".csv"):
        tx = lees_csv(args[0])
        accounts = []
        console.print(f"[dim]{len(tx)} transacties gelezen uit {args[0]}[/dim]")
    else:
        if not os.getenv("BUNQ_API_KEY"):
            console.print("[red]Geen BUNQ_API_KEY in .env en geen CSV meegegeven.[/red]\n"
                          "Gebruik: python -m finsight.main export.csv")
            sys.exit(1)
        accounts, tx = haal_bunq()
        for a in accounts:
            console.print(f"[dim]{a['naam']} ({a['iban']}): € {a['saldo']:,.2f}[/dim]")

    lasten = None
    if LASTEN_PATH.exists():
        lasten = json.loads(LASTEN_PATH.read_text(encoding="utf-8"))
        console.print(f"[dim]Vaste lasten & schulden geladen uit {LASTEN_PATH.name}[/dim]")

    summary = aggregeer(tx)
    if accounts:
        summary["huidige_saldi"] = [{"rekening": a["naam"], "saldo": a["saldo"]} for a in accounts]

    console.print("[dim]Claude analyseert…[/dim]")
    toon(agent.analyze(summary, lasten, vraag))


if __name__ == "__main__":
    main()
