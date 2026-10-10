"""
Regelgebaseerde financiële analyse — géén AI of API-key nodig.

Maakt hetzelfde rapport-dict als agent.analyze() (score, samenvatting,
maandruimte, risico's, acties, aflosvolgorde), maar met vaste rekenregels:
- direct opeisbare schulden vóór alles, dan schulden zonder regeling, dan regelingen;
- structureel maandtekort weegt het zwaarst;
- vergelijking met de vorige maand op basis van de echte transacties.
"""
from datetime import date

STATUS_RANG = {"direct te betalen": 0, "direct": 0, "uitstel verlopen": 1, "uitstel": 1,
               "geen regeling": 2, "open": 2, "betalingsregeling": 3, "regeling": 3}


def _status_rang(status: str) -> int:
    s = (status or "").lower().strip()
    for key, rang in STATUS_RANG.items():
        if key in s:
            return rang
    return 2


def _lasten_cijfers(lasten: dict | None) -> tuple[float, float, list[dict]]:
    if not lasten:
        return 0.0, 0.0, []
    vaste = sum(p.get("bedrag", 0) for p in lasten.get("vaste_lasten_per_maand", []))
    inkomsten = sum(p.get("bedrag", 0) for p in lasten.get("inkomsten_per_maand", []))
    schulden = lasten.get("schulden", [])
    return inkomsten, vaste, schulden


def analyze(summary: dict, lasten: dict | None, vraag: str | None = None) -> dict:
    maanden = summary.get("per_maand_laatste_12", {})
    keys = sorted(maanden)
    huidige = date.today().strftime("%Y-%m")
    vol = [k for k in keys if k < huidige][-3:]  # laatste volledige maanden

    tx_in = sum(maanden[k]["in"] for k in vol) / len(vol) if vol else 0.0
    tx_uit = sum(maanden[k]["uit"] for k in vol) / len(vol) if vol else 0.0

    b_in, b_uit, schulden = _lasten_cijfers(lasten)
    # banktransacties zijn de werkelijkheid; de begroting vult aan als er geen bankdata is
    inkomsten = tx_in if vol else b_in
    uitgaven = tx_uit if vol else b_uit
    ruimte = inkomsten - uitgaven

    open_totaal = sum(s.get("open", 0) for s in schulden)
    direct = [s for s in schulden if _status_rang(s.get("status", "")) <= 1]
    geen_regeling = [s for s in schulden if _status_rang(s.get("status", "")) == 2]
    direct_totaal = sum(s.get("open", 0) for s in direct)
    geen_regeling_totaal = sum(s.get("open", 0) for s in geen_regeling)

    # ── score (start 10, trek af per probleem) ──────────────────────────────
    score = 10
    if ruimte < 0:
        score -= 3 if ruimte < -250 else 2
    if direct_totaal > 0:
        score -= 2
    if geen_regeling_totaal > 0:
        score -= 2
    if open_totaal > max(inkomsten, 1) * 6:
        score -= 1
    score = max(1, min(10, score))

    # ── risico's ────────────────────────────────────────────────────────────
    risicos = []
    if direct_totaal > 0:
        risicos.append({"risico": f"€ {direct_totaal:,.2f} per direct opeisbaar ({len(direct)} schuld(en))",
                        "ernst": "HOOG", "waarom": "Dwanginvordering en extra kosten dreigen op korte termijn."})
    if geen_regeling_totaal > 0:
        risicos.append({"risico": f"€ {geen_regeling_totaal:,.2f} schuld zonder betalingsregeling",
                        "ernst": "HOOG", "waarom": "Zonder regeling kan verrekening met toeslagen of beslag volgen."})
    if ruimte < 0:
        risicos.append({"risico": f"Structureel maandtekort van € {abs(ruimte):,.2f}",
                        "ernst": "HOOG" if ruimte < -250 else "MIDDEL",
                        "waarom": "Elke maand groeit het gat; aflossen is zo niet vol te houden."})
    if len(vol) >= 2:
        vorige, laatste = maanden[vol[-2]]["uit"], maanden[vol[-1]]["uit"]
        if vorige > 100 and laatste > vorige * 1.2:
            risicos.append({"risico": f"Uitgaven stegen {round((laatste - vorige) / vorige * 100)}% t.o.v. de maand ervoor",
                            "ernst": "MIDDEL", "waarom": f"€ {vorige:,.0f} → € {laatste:,.0f}."})

    # ── acties ──────────────────────────────────────────────────────────────
    acties = []
    for s in sorted(direct, key=lambda x: -x.get("open", 0)):
        acties.append({"actie": f"Betaal of tref déze week een regeling voor {s.get('schuldeiser')} (€ {s.get('open', 0):,.2f})",
                       "deadline": "deze week", "effect": "voorkomt dwangbevel en invorderingskosten"})
    for s in sorted(geen_regeling, key=lambda x: -x.get("open", 0)):
        acties.append({"actie": f"Vraag een betalingsregeling aan voor {s.get('schuldeiser')} (€ {s.get('open', 0):,.2f})",
                       "deadline": "deze week" if s.get("open", 0) > 5000 else "deze maand",
                       "effect": "voorkomt verrekening/beslag en maakt de last planbaar"})
    if ruimte < 0:
        acties.append({"actie": f"Dicht het maandtekort van € {abs(ruimte):,.2f}: herzie de verdeling van vaste lasten of verlaag de grootste post",
                       "deadline": "deze maand", "effect": f"€ {abs(ruimte):,.0f}/maand structureel"})
    if not acties:
        acties.append({"actie": "Geen urgente acties — houd je budgetten aan en los volgens plan af",
                       "deadline": "deze maand", "effect": "koers vasthouden"})

    # ── aflosvolgorde ────────────────────────────────────────────────────────
    prioriteit = []
    for i, s in enumerate(sorted(schulden, key=lambda x: (_status_rang(x.get("status", "")), -x.get("open", 0))), 1):
        reden = ["per direct opeisbaar", "uitstel is verlopen", "nog geen regeling — grootste risico",
                 "loopt al in een regeling"][min(_status_rang(s.get("status", "")), 3)]
        prioriteit.append({"schuldeiser": s.get("schuldeiser", "?"), "bedrag": s.get("open", 0),
                           "volgorde": i, "reden": reden})

    kern = (f"Gemiddeld € {inkomsten:,.2f} in en € {uitgaven:,.2f} uit per maand "
            f"({'tekort' if ruimte < 0 else 'over'}: € {abs(ruimte):,.2f}). "
            f"Totale schuld € {open_totaal:,.2f}" + (f", waarvan € {direct_totaal:,.2f} direct opeisbaar." if direct_totaal else "."))

    return {
        "score": score,
        "samenvatting": kern,
        "maandruimte": {"inkomsten": round(inkomsten, 2), "uitgaven": round(uitgaven, 2),
                        "ruimte": round(ruimte, 2),
                        "toelichting": f"Gemiddelde van je laatste {len(vol)} volledige maanden banktransacties." if vol else "Op basis van je begroting (nog geen bankdata)."},
        "risicos": risicos[:5],
        "acties": acties[:6],
        "schulden_prioriteit": prioriteit,
        "antwoord_op_vraag": None if not vraag else "Stel vragen via de Claude-coach (optionele ANTHROPIC_API_KEY) of in de FinSight-chat.",
    }
