"""
Sync the two read-only Thera/Turnur reference Maps (see Map.read_only)
against eve-scout.com's public live-signatures feed (see
wh_mapper.tasks.sync_eve_scout_thera_turnur for the full sync logic).
Normally run periodically as a Celery task; this is the same logic invoked
directly, for a manual/on-demand sync without waiting for the next
scheduled run.
"""

# Django
from django.core.management.base import BaseCommand

from ...tasks import sync_eve_scout_thera_turnur


class Command(BaseCommand):
    help = "Sync the Thera/Turnur read-only reference maps against eve-scout.com's public signatures feed."

    def handle(self, *args, **options):
        sync_eve_scout_thera_turnur()
        self.stdout.write(self.style.SUCCESS("Synced Thera/Turnur reference maps"))
