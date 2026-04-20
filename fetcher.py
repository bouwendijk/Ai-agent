"""
Fetches live odds from The Odds API, filtering for Unibet (unibet_eu).
Falls back to market consensus when Unibet lacks coverage on a specific event.
"""
import os
import requests
from typing import Optional

ODDS_API_KEY = os.getenv("ODDS_API_KEY", "")
BASE_URL = "https://api.the-odds-api.com/v4"

UNIBET_KEYS = {"unibet_eu", "unibet"}

# Popular sports available on Unibet EU
DEFAULT_SPORTS = [
    "soccer_epl",
    "soccer_spain_la_liga",
    "soccer_germany_bundesliga",
    "soccer_italy_serie_a",
    "soccer_france_ligue1",
    "soccer_uefa_champs_league",
    "soccer_uefa_europa_league",
    "tennis_atp_french_open",
    "tennis_wta_french_open",
    "basketball_nba",
    "basketball_euroleague",
    "icehockey_nhl",
]


def get_active_sports() -> list[dict]:
    resp = requests.get(
        f"{BASE_URL}/sports",
        params={"apiKey": ODDS_API_KEY, "all": "false"},
        timeout=10,
    )
    resp.raise_for_status()
    return resp.json()


def get_odds_for_sport(sport: str) -> list[dict]:
    resp = requests.get(
        f"{BASE_URL}/sports/{sport}/odds",
        params={
            "apiKey": ODDS_API_KEY,
            "regions": "eu,uk",
            "markets": "h2h",
            "oddsFormat": "decimal",
        },
        timeout=10,
    )
    if resp.status_code in (404, 422):
        return []
    resp.raise_for_status()
    return resp.json()


def _extract_from_events(events: list[dict]) -> list[dict]:
    """Convert raw API events into structured betting opportunities."""
    opportunities = []

    for event in events:
        home = event.get("home_team", "")
        away = event.get("away_team", "")
        sport = event.get("sport_key", "")
        event_name = f"{home} vs {away}"
        commence = event.get("commence_time", "")

        # Gather all odds per outcome across bookmakers
        all_odds: dict[str, list[float]] = {}
        unibet_odds: dict[str, float] = {}

        for bm in event.get("bookmakers", []):
            bm_key = bm.get("key", "")
            for market in bm.get("markets", []):
                if market.get("key") != "h2h":
                    continue
                for outcome in market.get("outcomes", []):
                    name = outcome.get("name", "")
                    price = float(outcome.get("price", 0))
                    if not name or price <= 1.0:
                        continue
                    all_odds.setdefault(name, []).append(price)
                    if bm_key in UNIBET_KEYS:
                        unibet_odds[name] = price

        for outcome_name, prices in all_odds.items():
            if not prices:
                continue
            avg = round(sum(prices) / len(prices), 3)
            best = round(max(prices), 3)
            uni_price = unibet_odds.get(outcome_name)

            # Value indicator: Unibet price vs market average
            value_diff = None
            if uni_price:
                value_diff = round(uni_price - avg, 3)

            opportunities.append(
                {
                    "event": event_name,
                    "sport": sport,
                    "selection": outcome_name,
                    "commence_time": commence,
                    "unibet_odds": uni_price,
                    "avg_market_odds": avg,
                    "best_market_odds": best,
                    "value_diff_vs_market": value_diff,
                    "consensus_probability_pct": round(100 / avg, 1),
                    "has_unibet": uni_price is not None,
                    "bookmaker_count": len(prices),
                }
            )

    return opportunities


def fetch_opportunities(sports: Optional[list[str]] = None) -> tuple[list[dict], dict]:
    """
    Returns (opportunities, metadata).
    Tries each sport in the list, skips on error.
    """
    if sports is None:
        try:
            active = {s["key"] for s in get_active_sports()}
            sports = [s for s in DEFAULT_SPORTS if s in active]
            if not sports:
                sports = list(active)[:6]
        except Exception:
            sports = DEFAULT_SPORTS

    all_events: list[dict] = []
    covered_sports: list[str] = []

    for sport in sports:
        try:
            events = get_odds_for_sport(sport)
            if events:
                all_events.extend(events)
                covered_sports.append(sport)
        except requests.RequestException:
            pass

    opportunities = _extract_from_events(all_events)
    metadata = {
        "sports_checked": covered_sports,
        "total_raw_events": len(all_events),
        "total_opportunities": len(opportunities),
        "unibet_covered": sum(1 for o in opportunities if o["has_unibet"]),
    }
    return opportunities, metadata
