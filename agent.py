"""
Claude-powered betting analysis agent.
Receives structured odds data and returns ranked bet selections + accumulator build.
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


SYSTEM_PROMPT = """You are an elite sports betting analyst specialising in value betting and accumulator strategy.

Core methodology:
1. VALUE: A bet has value when bookmaker implied probability < true event probability.
   implied_prob = 1 / odds * 100 %
2. MARKET CONSENSUS: avg_market_odds across many bookmakers is the best proxy for true probability.
   If unibet_odds > avg_market_odds → Unibet is offering above-market value → positive edge.
3. CONFIDENCE (1-10): Reflects both the strength of the value edge AND your assessment of the outcome's likelihood.
4. ACCUMULATOR CORRELATION: Avoid selecting multiple outcomes from the same team or heavily linked markets.
   Mix sports where possible to reduce co-movement risk.
5. HONESTY: If data is sparse or markets are highly efficient, say so. Never manufacture false confidence.

Format your entire response as a single valid JSON object — no markdown, no explanation outside the JSON."""


def analyze(opportunities: list[dict], num_bets: int) -> dict:
    """
    Calls Claude to pick the best `num_bets` selections and build an accumulator.
    Returns a dict with keys: selected_bets, accumulator, market_summary.
    """
    client = _get_client()

    # Prioritise opportunities where Unibet offers above-market odds
    candidates = sorted(
        [o for o in opportunities if o.get("bookmaker_count", 0) >= 2],
        key=lambda x: (
            x.get("value_diff_vs_market") or -99,
            x.get("bookmaker_count", 0),
        ),
        reverse=True,
    )[:60]  # Send top 60 candidates to Claude

    if not candidates:
        return {"error": "No opportunities with sufficient bookmaker coverage."}

    prompt = f"""You have {len(candidates)} betting opportunities from Unibet (and market consensus data).
Select exactly {num_bets} best individual bets, then build an accumulator from those {num_bets} selections.

Opportunities (sorted by Unibet value edge, best first):
{json.dumps(candidates, indent=2)}

Rules:
- Select exactly {num_bets} bets.
- Prefer selections where unibet_odds is available (has_unibet=true) and > avg_market_odds.
- Spread across different sports/events where possible.
- For the accumulator, multiply all selected unibet_odds together.

Return this JSON structure (ONLY JSON, nothing else):
{{
  "selected_bets": [
    {{
      "rank": 1,
      "event": "...",
      "sport": "...",
      "selection": "...",
      "unibet_odds": 1.85,
      "avg_market_odds": 1.72,
      "value_diff": "+0.13",
      "confidence": 7,
      "value_rating": "GOOD",
      "implied_probability": "54.1%",
      "estimated_true_probability": "58%",
      "reasoning": "..."
    }}
  ],
  "accumulator": {{
    "num_selections": {num_bets},
    "legs": ["Selection A @ 1.85", "Selection B @ 2.10"],
    "combined_odds": 3.89,
    "return_per_10_eur": 38.9,
    "implied_probability": "25.7%",
    "estimated_true_probability": "30%",
    "risk_level": "MEDIUM",
    "key_risks": ["Risk 1", "Risk 2"],
    "verdict": "Overall assessment of this accumulator"
  }},
  "market_summary": "2-3 sentence overview of today's market conditions"
}}"""

    response = client.messages.create(
        model="claude-opus-4-7",
        max_tokens=4096,
        thinking={"type": "adaptive"},
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )

    raw_text = ""
    for block in response.content:
        if block.type == "text":
            raw_text = block.text
            break

    if not raw_text:
        return {"error": "Empty response from AI."}

    try:
        start = raw_text.find("{")
        end = raw_text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(raw_text[start:end])
        return json.loads(raw_text)
    except json.JSONDecodeError as exc:
        return {"error": f"JSON parse error: {exc}", "raw": raw_text[:500]}
