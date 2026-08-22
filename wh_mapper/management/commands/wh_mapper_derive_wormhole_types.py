"""
Derive WormholeType rows from the ItemType/TypeDogma/DogmaAttribute data
already imported from the SDE (via django-eve-sde), plus a hardcoded
code -> leads_to_class table (CODE_TO_CLASS below) for the one field with no
SDE dogma attribute at all.

The mass/jump-mass/lifetime dogma attribute names below are the well-known
"wormhole*" attribute names CCP uses in the real SDE, but this workspace has
no imported SDE data to verify them against - the matching is intentionally
name-fragment based (case-insensitive `icontains`, not exact/id-based) so it
degrades gracefully and logs what it saw, rather than silently matching
nothing (or the wrong attribute) if a name differs slightly from expected.
Run with -v 2 after a real SDE import to confirm the matches look right.
"""

# Standard Library
import re

# Third Party
# Django EvE SDE
from eve_sde.models import ItemType

# Django
from django.core.management.base import BaseCommand
from django.db.models import Q

from ...constants import CODE_TO_CLASS
from ...models import WormholeType

CODE_PATTERN = re.compile(r"^[A-Z]\d{2,3}$")

# Fragments matched case-insensitively against DogmaAttribute.name.
MASS_FRAGMENTS = ("maxstablemass", "wormholemaxmass")
JUMP_MASS_FRAGMENTS = ("maxjumpmass",)
STABLE_TIME_FRAGMENTS = ("maxstabletime",)

# leads_to_class has no SDE dogma attribute (see WormholeType's docstring) -
# see wh_mapper.constants.CODE_TO_CLASS for where this is sourced from.


def _match_value(dogma_rows, fragments):
    for row in dogma_rows:
        name = (row.dogma_attribute.name or "").lower()
        if any(fragment in name for fragment in fragments):
            return row.value
    return None


class Command(BaseCommand):
    help = (
        "Derive WormholeType rows (code, max_mass, max_jump_mass, "
        "max_stable_time) from imported ItemType/TypeDogma data."
    )

    def handle(self, *args, **options):
        wormhole_types = ItemType.objects.filter(
            Q(group__name__icontains="wormhole")
        ).prefetch_related("dogma__dogma_attribute")

        if not wormhole_types.exists():
            self.stdout.write(
                self.style.WARNING(
                    "No ItemType found in a 'Wormhole' group - is the SDE imported?"
                )
            )
            return

        created, updated, skipped = 0, 0, 0

        for item_type in wormhole_types:
            code_candidate = item_type.name.strip().split(" ")[-1].upper()
            if not CODE_PATTERN.match(code_candidate):
                skipped += 1
                self.stdout.write(
                    self.style.WARNING(
                        f"Skipping '{item_type.name}' - no wormhole code found in name"
                    )
                )
                continue

            dogma_rows = list(item_type.dogma.all())
            max_mass = _match_value(dogma_rows, MASS_FRAGMENTS)
            max_jump_mass = _match_value(dogma_rows, JUMP_MASS_FRAGMENTS)
            max_stable_time = _match_value(dogma_rows, STABLE_TIME_FRAGMENTS)
            leads_to_class = CODE_TO_CLASS.get(code_candidate)

            _wh_type, was_created = WormholeType.objects.update_or_create(
                item_type=item_type,
                defaults={
                    "code": code_candidate,
                    "leads_to_class": leads_to_class,
                    "max_mass": max_mass,
                    "max_jump_mass": max_jump_mass,
                    "max_stable_time": max_stable_time,
                },
            )

            if was_created:
                created += 1
            else:
                updated += 1

            if max_mass is None or max_jump_mass is None or max_stable_time is None:
                self.stdout.write(
                    self.style.WARNING(
                        f"{code_candidate}: missing "
                        f"{'max_mass ' if max_mass is None else ''}"
                        f"{'max_jump_mass ' if max_jump_mass is None else ''}"
                        f"{'max_stable_time' if max_stable_time is None else ''}"
                        " - check DogmaAttribute names against MASS_FRAGMENTS/"
                        "JUMP_MASS_FRAGMENTS/STABLE_TIME_FRAGMENTS in this command"
                    )
                )
            if leads_to_class is None:
                self.stdout.write(
                    self.style.WARNING(
                        f"{code_candidate}: no leads_to_class match in CODE_TO_CLASS "
                        "- new/unrecognized code, or a K162 (which has no single "
                        "destination class); fill in manually via admin if needed"
                    )
                )

        self.stdout.write(
            self.style.SUCCESS(
                f"WormholeType: {created} created, {updated} updated, "
                f"{skipped} skipped (no code match)"
            )
        )
