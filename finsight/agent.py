"""
Claude-powered financiële-gezondheid-agent.
Krijgt een samenvatting van banktransacties + vaste lasten & schulden,
en geeft een gestructureerd gezondheidsrapport met concrete acties terug.
"""
import json
import os

import anthropic

_client = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    return _client


SYSTEM_PROMPT = """Je bent een nuchtere Nederlandse financiële coach en schuldhulp-expert.

Werkwijze:
1. EERLIJK: benoem de werkelijke situatie, ook als die vervelend is. Geen valse geruststelling.
2. PRIORITEIT: direct opeisbare schulden (gemeente, SVHW, dwanginvordering) gaan vóór alles;
   daarna schulden zonder regeling (risico op verrekening/beslag); daarna lopende regelingen.
3. CASHFLOW EERST: structureel maandtekort los je op vóór je gaat aflossen of sparen.
4. CONCREET: elke aanbeveling is een actie die deze week kan, met bedrag en bij wie.
5. NEDERLANDSE CONTEXT: ken kwijtschelding gemeentebelastingen, betalingsregelingen
   Belastingdienst, beslagvrije voet, toeslagen-verrekening.

Antwoord ALTIJD met uitsluitend één geldig JSON-object, zonder tekst eromheen."""


def analyze(summary: dict, lasten: dict | None, vraag: str | None = None) -> dict:
    """
    summary: geaggregeerde transactiedata (maanden, categorieën, top-tegenpartijen).
    lasten:  vaste lasten & schulden-overzicht (optioneel).
    vraag:   optionele vrije vraag van de gebruiker.
    """
    client = _get_client()

    prompt = f"""Analyseer de financiële situatie van de gebruiker.

TRANSACTIEDATA (uit de bank, geaggregeerd):
{json.dumps(summary, ensure_ascii=False, indent=1)}

VASTE LASTEN & SCHULDEN:
{json.dumps(lasten, ensure_ascii=False, indent=1) if lasten else "niet aangeleverd"}

{f'VRAAG VAN DE GEBRUIKER: {vraag}' if vraag else ''}

Geef exact dit JSON-object terug:
{{
  "score": <financiële gezondheid 1-10>,
  "samenvatting": "<2-3 zinnen: de kern van de situatie>",
  "maandruimte": {{"inkomsten": <euro>, "uitgaven": <euro>, "ruimte": <euro>, "toelichting": "<1 zin>"}},
  "risicos": [{{"risico": "<wat>", "ernst": "HOOG|MIDDEL|LAAG", "waarom": "<1 zin>"}}],
  "acties": [{{"actie": "<concrete stap>", "deadline": "<deze week|deze maand|dit kwartaal>", "effect": "<verwacht effect in euro's of risico>"}}],
  "schulden_prioriteit": [{{"schuldeiser": "<naam>", "bedrag": <euro>, "volgorde": <1..n>, "reden": "<waarom deze positie>"}}],
  "antwoord_op_vraag": "<antwoord op de vraag van de gebruiker, of null>"
}}
Maximaal 5 risico's en 6 acties, gesorteerd op belangrijkheid."""

    response = client.messages.create(
        model=os.getenv("FINSIGHT_MODEL", "claude-sonnet-5-5"),
        max_tokens=3000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("```")[1].lstrip("json").strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        return {"error": "Geen geldige JSON in het antwoord.", "raw": text[:500]}
    try:
        return json.loads(text[start:end + 1])
    except ValueError:
        return {"error": "JSON kon niet worden gelezen.", "raw": text[:500]}
