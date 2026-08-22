"""
Import SystemStatic rows (which wormhole type code(s) are permanently
static in each J-space system) from the bundled data/wh_effects.csv - a
snapshot of zKillboard's setup/wh_effects.csv (github.com/zKillboard/
zKillboard, commit fb8ce9d), the same community-curated source
wh_mapper.constants's WORMHOLE_REGION_LETTER_TO_CLASS/DRIFTER_SYSTEM_CLASS
comments already cite for cross-checking wormhole_class_id.

Bundled rather than fetched live: this data changes only when CCP adds new
wormhole systems (rare, and never for existing ones), so a live fetch would
just be an unnecessary runtime dependency on zKillboard staying up. Re-run
this command (it's idempotent - update_or_create) after refreshing
data/wh_effects.csv from upstream to pick up any newly added systems.
"""

# Standard Library
import csv
from pathlib import Path

# Django
from django.core.management.base import BaseCommand

from ...models import SystemStatic

DATA_FILE = Path(__file__).resolve().parent / "data" / "wh_effects.csv"


class Command(BaseCommand):
    help = "Import per-system static wormhole codes from the bundled wh_effects.csv"

    def handle(self, *args, **options):
        if not DATA_FILE.exists():
            self.stdout.write(self.style.ERROR(f"Data file not found: {DATA_FILE}"))
            return

        created, updated = 0, 0

        with DATA_FILE.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                solar_system_id = int(row["SolarSystemID"])
                codes = [code.strip() for code in row["statics"].split(",") if code.strip()]

                _static, was_created = SystemStatic.objects.update_or_create(
                    solar_system_id=solar_system_id,
                    defaults={"codes": codes},
                )

                if was_created:
                    created += 1
                else:
                    updated += 1

        self.stdout.write(
            self.style.SUCCESS(f"SystemStatic: {created} created, {updated} updated")
        )
