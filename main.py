"""
Unibet AI Betting Agent — interactive CLI.
Usage: python main.py
"""
import os
import sys

from dotenv import load_dotenv
from rich import box
from rich.console import Console
from rich.panel import Panel
from rich.prompt import IntPrompt
from rich.table import Table
from rich.text import Text

load_dotenv()
console = Console()

# ── helpers ─────────────────────────────────────────────────────────────────

VALUE_COLORS = {
    "EXCELLENT": "bold green",
    "GREAT": "bold green",
    "GOOD": "cyan",
    "FAIR": "yellow",
    "POOR": "red",
    "LOW": "red",
}

RISK_COLORS = {
    "LOW": "green",
    "MEDIUM": "yellow",
    "HIGH": "red",
    "VERY HIGH": "bold red",
}


def _color(mapping: dict, key: str, fallback: str = "white") -> str:
    return mapping.get((key or "").upper(), fallback)


def check_env() -> list[str]:
    errors = []
    if not os.getenv("ANTHROPIC_API_KEY"):
        errors.append("ANTHROPIC_API_KEY missing — get one at https://console.anthropic.com")
    if not os.getenv("ODDS_API_KEY"):
        errors.append("ODDS_API_KEY missing — free key at https://the-odds-api.com")
    return errors


# ── display functions ────────────────────────────────────────────────────────

def show_header() -> None:
    console.print()
    console.print(
        Panel.fit(
            "[bold blue]🎯  Unibet AI Betting Agent[/bold blue]\n"
            "[dim]Powered by Claude AI · Odds via The Odds API[/dim]",
            border_style="blue",
            padding=(1, 4),
        )
    )
    console.print()


def show_bet(bet: dict, index: int) -> None:
    val_color = _color(VALUE_COLORS, bet.get("value_rating", ""))
    conf = min(max(int(bet.get("confidence", 5)), 0), 10)
    conf_bar = "█" * conf + "░" * (10 - conf)

    t = Table(show_header=False, box=box.SIMPLE, padding=(0, 1))
    t.add_column("", style="dim", min_width=26)
    t.add_column("")

    sport_label = (bet.get("sport") or "—").replace("_", " ").title()
    t.add_row("Event", f"[bold]{bet.get('event', '—')}[/bold]")
    t.add_row("Selection", f"[bold cyan]{bet.get('selection', '—')}[/bold cyan]")
    t.add_row("Unibet Odds", f"[bold yellow]{bet.get('unibet_odds', '—')}[/bold yellow]")
    t.add_row("Market Average", str(bet.get("avg_market_odds", "—")))
    t.add_row("Value Edge", str(bet.get("value_diff", "—")))
    t.add_row("Value Rating", f"[{val_color}]{bet.get('value_rating', '—')}[/{val_color}]")
    t.add_row("Confidence", f"[green]{conf_bar}[/green]  {conf}/10")
    t.add_row("Implied Prob.", bet.get("implied_probability", "—"))
    t.add_row("True Prob. Est.", bet.get("estimated_true_probability", "—"))
    t.add_row("", "")
    t.add_row("Reasoning", f"[italic]{bet.get('reasoning', '—')}[/italic]")

    console.print(
        Panel(
            t,
            title=f"[bold]#{index}  {sport_label}[/bold]",
            border_style=val_color.split()[-1],
        )
    )


def show_accumulator(acc: dict) -> None:
    risk = (acc.get("risk_level") or "MEDIUM").upper()
    risk_color = _color(RISK_COLORS, risk)

    # Legs list
    legs_text = Text()
    for i, leg in enumerate(acc.get("legs", []), 1):
        legs_text.append(f"  {i}. ", style="dim")
        legs_text.append(f"{leg}\n", style="bold cyan")

    # Stats table
    stats = Table(show_header=False, box=box.SIMPLE, padding=(0, 2))
    stats.add_column("", style="dim", min_width=28)
    stats.add_column("")
    stats.add_row("Number of selections", str(acc.get("num_selections", "—")))
    stats.add_row(
        "Combined odds",
        f"[bold yellow]{acc.get('combined_odds', '—')}[/bold yellow]",
    )
    stats.add_row(
        "Return per €10 staked",
        f"[bold green]€{acc.get('return_per_10_eur', '—')}[/bold green]",
    )
    stats.add_row("Implied probability", acc.get("implied_probability", "—"))
    stats.add_row("True probability est.", acc.get("estimated_true_probability", "—"))
    stats.add_row("Risk level", f"[{risk_color}]{risk}[/{risk_color}]")

    content = Text()
    content.append("Selections:\n", style="bold")
    content.append(legs_text)

    console.print(
        Panel(
            content,
            title="[bold]Accumulator[/bold]",
            border_style="yellow",
        )
    )
    console.print(stats)

    risks = acc.get("key_risks", [])
    if risks:
        console.print("\n[bold red]Key Risks:[/bold red]")
        for r in risks:
            console.print(f"  ⚠  {r}", style="yellow")

    verdict = acc.get("verdict") or acc.get("analysis")
    if verdict:
        console.print(
            Panel(verdict, title="[bold]AI Verdict[/bold]", border_style="blue")
        )


# ── main ────────────────────────────────────────────────────────────────────

def main() -> None:
    show_header()

    errors = check_env()
    if errors:
        for e in errors:
            console.print(f"[bold red]✗[/bold red]  {e}")
        console.print(
            "\n[dim]Copy .env.example → .env and fill in both API keys, then re-run.[/dim]"
        )
        sys.exit(1)

    console.print("[bold]How many bets do you want in your accumulator?[/bold]")
    console.print("[dim]Enter a number from 1 (single bet) to 10 (10-fold acca)[/dim]\n")
    num_bets = IntPrompt.ask("Number of selections", default=3)
    num_bets = max(1, min(10, num_bets))

    console.print(f"\n[green]Building a {num_bets}-selection bet…[/green]\n")

    # ── fetch odds ──────────────────────────────────────────────────────────
    with console.status("[bold blue]Fetching live Unibet odds…[/bold blue]"):
        from fetcher import fetch_opportunities

        try:
            opportunities, meta = fetch_opportunities()
        except Exception as exc:
            console.print(f"[red]Failed to fetch odds: {exc}[/red]")
            sys.exit(1)

    if not opportunities:
        console.print(
            "[red]No odds data returned. Verify your ODDS_API_KEY and internet connection.[/red]"
        )
        sys.exit(1)

    unibet_count = meta.get("unibet_covered", 0)
    console.print(
        f"[dim]Checked {len(meta.get('sports_checked', []))} sports · "
        f"{meta['total_raw_events']} events · "
        f"{unibet_count} with Unibet odds[/dim]\n"
    )

    # ── analyse with Claude ─────────────────────────────────────────────────
    with console.status("[bold blue]Claude is analysing the best bets…[/bold blue]"):
        from agent import analyze

        try:
            result = analyze(opportunities, num_bets)
        except Exception as exc:
            console.print(f"[red]AI analysis failed: {exc}[/red]")
            sys.exit(1)

    if "error" in result:
        console.print(f"[red]Analysis error:[/red] {result['error']}")
        if "raw" in result:
            console.print(f"[dim]{result['raw']}[/dim]")
        sys.exit(1)

    # ── market overview ─────────────────────────────────────────────────────
    if result.get("market_summary"):
        console.print(
            Panel(
                result["market_summary"],
                title="[bold]Market Overview[/bold]",
                border_style="dim",
            )
        )
        console.print()

    # ── individual bets ─────────────────────────────────────────────────────
    bets = result.get("selected_bets", [])
    if bets:
        console.print(f"[bold green]Top {len(bets)} Selected Bets[/bold green]\n")
        for i, bet in enumerate(bets, 1):
            show_bet(bet, i)
            console.print()

    # ── accumulator ─────────────────────────────────────────────────────────
    if result.get("accumulator") and num_bets > 1:
        console.print("[bold green]Accumulator Summary[/bold green]\n")
        show_accumulator(result["accumulator"])
        console.print()

    # ── disclaimer ─────────────────────────────────────────────────────────
    console.print(
        Panel(
            "[yellow]⚠  Responsible Gambling Reminder[/yellow]\n\n"
            "[dim]This tool is for informational purposes only.\n"
            "Betting carries risk — you may lose your stake.\n"
            "Only bet what you can afford to lose.\n"
            "Help: [link]https://www.begambleaware.org[/link][/dim]",
            border_style="yellow",
        )
    )


if __name__ == "__main__":
    main()
