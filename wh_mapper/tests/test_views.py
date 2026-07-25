"""Tests for wh_mapper.views.index - the React SPA shell, served for every
client-side route so a direct visit/refresh doesn't 404."""

# Django
from django.test import TestCase

# AA WH Mapper App
from wh_mapper.tests.factories import make_user_with_character


class TestIndexView(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = make_user_with_character("view_alice", 300501)

    def setUp(self):
        self.client.login(username="view_alice", password="test-password")

    def test_index(self):
        response = self.client.get("/wh-mapper/")
        self.assertEqual(response.status_code, 200)

    def test_map_detail_deep_link(self):
        response = self.client.get("/wh-mapper/maps/1/")
        self.assertEqual(response.status_code, 200)

    def test_route_finder_deep_link(self):
        response = self.client.get("/wh-mapper/route/")
        self.assertEqual(response.status_code, 200)

    def test_shared_route_detail_deep_link(self):
        response = self.client.get("/wh-mapper/route/shared/1/")
        self.assertEqual(response.status_code, 200)
