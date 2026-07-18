"""Tests for the MapPresence admin's grouped "currently online" summary"""

# Django
from django.contrib.auth.models import User
from django.test import TestCase, override_settings
from django.urls import reverse

# AA WH Mapper App
from wh_mapper.models import Map, MapPresence


@override_settings(
    STORAGES={
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        # The project's real staticfiles backend (AaManifestStaticFilesStorage,
        # see testauth/settings/base.py) needs collectstatic to have run
        # against STATIC_ROOT first, which nothing in this test suite (or
        # tox.ini) does - so any test that actually renders an admin template
        # (these are the only ones in the suite that do) fails on `{% static %}`
        # tags with a missing-manifest-entry error, regardless of environment.
        # Swap in the plain non-manifest storage here, whose `.url()` just
        # returns STATIC_URL + name unconditionally, since these tests only
        # care about the page's content, not real hashed static asset URLs.
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
)
class TestMapPresenceAdminOnlineUsers(TestCase):
    """The default flat MapPresence changelist is overridden to show, per
    currently-online user, which map(s) they have open (see
    wh_mapper.admin.MapPresenceAdmin.changelist_view) - it's a Django admin
    view, so access is gated by Django admin's own is_staff/permission
    checks rather than anything custom.
    """

    def setUp(self):
        self.superuser = User.objects.create_superuser(
            "boss", password="test-password"
        )
        self.staff_user = User.objects.create_user(
            "staffer", password="test-password", is_staff=True
        )
        self.plain_user = User.objects.create_user("rando", password="test-password")

        self.owner = User.objects.create_user("owner", password="test-password")
        self.other_user = User.objects.create_user("loner", password="test-password")

        self.map_a = Map.objects.create(name="Alpha Chain", owner=self.owner)
        self.map_b = Map.objects.create(name="Beta Chain", owner=self.owner)

        # owner has two tabs open (Alpha + Beta); loner has one (Alpha).
        MapPresence.objects.create(map=self.map_a, user=self.owner, channel_name="chan-a")
        MapPresence.objects.create(map=self.map_b, user=self.owner, channel_name="chan-b")
        MapPresence.objects.create(
            map=self.map_a, user=self.other_user, channel_name="chan-c"
        )

        self.url = reverse("admin:wh_mapper_mappresence_changelist")

    def test_superuser_sees_grouped_summary_by_user(self):
        self.client.login(username="boss", password="test-password")

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "owner")
        self.assertContains(response, "loner")
        self.assertContains(response, "Alpha Chain")
        self.assertContains(response, "Beta Chain")

    def test_user_with_no_open_maps_is_absent_from_summary(self):
        self.client.login(username="boss", password="test-password")

        response = self.client.get(self.url)

        # staffer/rando/plain accounts never opened a map - shouldn't show up.
        self.assertNotContains(response, "staffer")
        self.assertNotContains(response, "rando")

    def test_staff_without_model_permission_is_rejected(self):
        # MapPresence carries no auto-created permissions (default_permissions
        # = () on the model) so plain staff - lacking any grantable
        # view/change perm for it - can't reach this page; only superusers can.
        self.client.login(username="staffer", password="test-password")

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 403)

    def test_non_staff_user_is_redirected_to_admin_login(self):
        self.client.login(username="rando", password="test-password")

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 302)
        self.assertIn("/login/", response.url)

    def test_anonymous_is_redirected_to_admin_login(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 302)
        self.assertIn("/login/", response.url)
