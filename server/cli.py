"""Command line for standalone deployments.

An organisation with no ITAM platform still has a spreadsheet. These two
commands are the way in and the way out, and they are what makes SQLite mode a
real deployment rather than a fixture:

    uv run python cli.py import walk-2026-08 example-walk.csv
    uv run uvicorn main:app
    ...walk the shelves in the client...
    uv run python cli.py export walk-2026-08 > variances.csv
"""

import argparse
import sys

from adapters.csvio import export_reconciliation, import_walk
from adapters.sqlstore import SqlStore


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="assetwalk")
    parser.add_argument("--db", default="assetwalk.db")
    commands = parser.add_subparsers(dest="command", required=True)

    seed = commands.add_parser("import", help="seed a walk from a location,sequence,asset CSV")
    seed.add_argument("walk")
    seed.add_argument("csv")

    report = commands.add_parser("export", help="write reconciliation to stdout as CSV")
    report.add_argument("walk")

    args = parser.parse_args(argv)
    store = SqlStore(args.db)

    if args.command == "import":
        with open(args.csv, encoding="utf-8") as rows:
            count = import_walk(store, args.walk, rows)
        # To stderr, so `export` and `import` can both be piped without the
        # progress line contaminating the data.
        print(f"seeded {count} positions into {args.walk}", file=sys.stderr)
    else:
        export_reconciliation(store, args.walk, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
