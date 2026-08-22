"""Tests for wh_mapper's management commands"""

# Standard Library
from datetime import timedelta
from io import StringIO

# Django
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone

# AA WH Mapper App
from wh_mapper.constants import MAP_PRESENCE_STALE_AFTER_SECONDS
from wh_mapper.models import Map, MapPresence, SystemStatic
from wh_mapper.tests.factories import make_user_with_character


class TestPruneStaleMapPresenceCommand(TestCase):
    """TestPruneStaleMapPresenceCommand"""

    @classmethod
    def setUpTestData(cls):
        cls.user = make_user_with_character("prune_command", 430002)
        cls.map = Map.objects.create(name="Prune Command Map", owner=cls.user)

    def test_prunes_stale_rows_and_reports_the_count(self):
        stale = MapPresence.objects.create(
            map=self.map, user=self.user, channel_name="chan-command-stale"
        )
        stale.last_seen_at = timezone.now() - timedelta(
            seconds=MAP_PRESENCE_STALE_AFTER_SECONDS + 1
        )
        stale.save(update_fields=["last_seen_at"])
        fresh = MapPresence.objects.create(
            map=self.map, user=self.user, channel_name="chan-command-fresh"
        )

        out = StringIO()
        call_command("wh_mapper_prune_stale_map_presence", stdout=out)

        self.assertFalse(MapPresence.objects.filter(pk=stale.pk).exists())
        self.assertTrue(MapPresence.objects.filter(pk=fresh.pk).exists())
        self.assertIn("Pruned 1 stale MapPresence row(s)", out.getvalue())


class TestImportSystemStaticsCommand(TestCase):
    """TestImportSystemStaticsCommand"""

    def test_imports_codes_from_the_bundled_csv_and_is_idempotent(self):
        out = StringIO()
        call_command("wh_mapper_import_system_statics", stdout=out)

        self.assertIn("created", out.getvalue())
        # J105443 (31000007), a plain C1 - single static, per the bundled
        # data/wh_effects.csv snapshot.
        self.assertEqual(SystemStatic.objects.get(pk=31000007).codes, ["Z060"])
        # Thera (31000005) - multiple statics.
        self.assertEqual(
            SystemStatic.objects.get(pk=31000005).codes, ["Q063", "V898", "E587"]
        )
        total = SystemStatic.objects.count()

        # Re-running is a plain update, not a duplicate insert.
        out = StringIO()
        call_command("wh_mapper_import_system_statics", stdout=out)

        self.assertEqual(SystemStatic.objects.count(), total)
        self.assertIn(f"0 created, {total} updated", out.getvalue())
