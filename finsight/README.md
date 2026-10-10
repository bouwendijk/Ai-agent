# FinSight Agent

Financiële-gezondheid-agent in de agent-world: leest je banktransacties (live via de
bunq API of offline via een bunq CSV-export), combineert ze met je vaste lasten &
schulden, en laat Claude een eerlijk gezondheidsrapport maken: score, maandruimte,
risico's, concrete acties en de slimste aflosvolgorde.

Zelfde architectuur als de betting-agent: fetcher → Claude-analyse → rich-CLI.

## Installatie

```bash
pip install -r finsight/requirements.txt
```

`.env` in de repo-root:

```
ANTHROPIC_API_KEY=sk-ant-...
BUNQ_API_KEY=...            # optioneel; alleen nodig voor live bunq
FINSIGHT_MODEL=claude-sonnet-5-5   # optioneel
```

De bunq-key maak je in de bunq-app: Profiel → Beveiliging & instellingen →
Ontwikkelaars → API-sleutels. Een key die met `sandbox_` begint gebruikt
automatisch de bunq-sandbox. De eenmalige apparaat-registratie wordt gecachet
in `~/.finsight/bunq_context.json`.

## Gebruik

```bash
python -m finsight.main                          # live via bunq
python -m finsight.main export.csv               # offline via bunq CSV-export
python -m finsight.main export.csv "kan ik in 2 jaar schuldenvrij zijn?"
```

## Vaste lasten & schulden

Kopieer `finsight/lasten.example.json` naar `finsight/lasten.json` en vul je echte
cijfers in. `lasten.json` staat in `.gitignore` — je financiële gegevens komen dus
nooit in git terecht.

## Verhouding tot de FinSight-app

De FinSight-app (claude.ai-artifact) is het dashboard voor dagelijks gebruik op je
telefoon; deze agent is de motor voor diepere analyse en automatisering vanuit de
agent-world. Ze delen dezelfde dataformaten (bunq CSV, lasten/schulden-structuur).
