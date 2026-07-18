"""
Delete stale MapPresence rows - websocket connections whose disconnect()
never fired (see wh_mapper.tasks.prune_stale_map_presence for why that can
happen and how staleness is decided). Normally run periodically as a Celery
task; this is the same logic invoked directly, for a manual cleanup (e.g.
right after a deploy that killed the ASGI worker mid-connection) without
waiting for the next scheduled run.
"""

# Django
from django.core.management.base import BaseCommand

from ...tasks import prune_stale_map_presence


class Command(BaseCommand):
    help = "Delete MapPresence rows whose last heartbeat is older than MAP_PRESENCE_STALE_AFTER_SECONDS."

    def handle(self, *args, **options):
        pruned = prune_stale_map_presence()
        self.stdout.write(self.style.SUCCESS(f"Pruned {pruned} stale MapPresence row(s)"))
