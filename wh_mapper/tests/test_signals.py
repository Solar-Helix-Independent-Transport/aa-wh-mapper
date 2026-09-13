"""Tests for wh_mapper's map_changed signal"""

# Standard Library
from unittest.mock import patch

# Django
from django.test import SimpleTestCase

# AA WH Mapper App
from wh_mapper.broadcast import broadcast_map_event
from wh_mapper.models import Map
from wh_mapper.signals import map_changed


class TestMapChangedSignal(SimpleTestCase):
    """TestMapChangedSignal"""

    def test_broadcast_map_event_fires_map_changed(self):
        received = []

        def _receiver(sender, **kwargs):
            received.append((sender, kwargs))

        map_changed.connect(_receiver)
        try:
            with patch("wh_mapper.broadcast.get_channel_layer", return_value=None):
                broadcast_map_event(42, "system.added", {"id": 1})
        finally:
            map_changed.disconnect(_receiver)

        self.assertEqual(len(received), 1)
        sender, kwargs = received[0]
        self.assertIs(sender, Map)
        self.assertEqual(kwargs["map_id"], 42)
        self.assertEqual(kwargs["event"], "system.added")
        self.assertEqual(kwargs["data"], {"id": 1})
        self.assertIsNone(kwargs["user"])

    def test_broadcast_map_event_forwards_the_acting_user(self):
        # A sentinel object, not a real User - broadcast_map_event/map_changed
        # never touch it beyond passing it through, so nothing here needs a
        # real user row.
        acting_user = object()
        received = []

        def _receiver(sender, **kwargs):
            received.append(kwargs)

        map_changed.connect(_receiver)
        try:
            with patch("wh_mapper.broadcast.get_channel_layer", return_value=None):
                broadcast_map_event(42, "system.added", {"id": 1}, user=acting_user)
        finally:
            map_changed.disconnect(_receiver)

        self.assertEqual(len(received), 1)
        self.assertIs(received[0]["user"], acting_user)

    def test_fires_even_without_a_channel_layer(self):
        # No channel layer configured shouldn't stop other code from
        # reacting to the mutation - only the websocket fan-out is gated on
        # it (see broadcast_map_event).
        received = []

        def _receiver(sender, **kwargs):
            received.append(kwargs)

        map_changed.connect(_receiver)
        try:
            with patch("wh_mapper.broadcast.get_channel_layer", return_value=None):
                broadcast_map_event(1, "system.removed", {})
        finally:
            map_changed.disconnect(_receiver)

        self.assertEqual(len(received), 1)
