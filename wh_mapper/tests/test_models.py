"""Tests for Map.objects.visible_to() sharing logic"""

# Django
from django.contrib.auth.models import Group
from django.test import TestCase

# AA WH Mapper App
from wh_mapper.models import Map, MapShare, MapShareGroup
from wh_mapper.tests.factories import make_user_with_character


class TestMapVisibility(TestCase):
    """TestMapVisibility"""

    @classmethod
    def setUpTestData(cls):
        cls.owner = make_user_with_character("owner", 100001)
        cls.char_grantee = make_user_with_character("char_grantee", 100002)
        cls.corp_grantee = make_user_with_character(
            "corp_grantee", 100003, corporation_id=6000
        )
        cls.alliance_grantee = make_user_with_character(
            "alliance_grantee", 100004, corporation_id=6001, alliance_id=7000
        )
        cls.group_grantee = make_user_with_character("group_grantee", 100006)
        cls.group = Group.objects.create(name="Test Grantee Group")
        cls.group_grantee.groups.add(cls.group)
        cls.outsider = make_user_with_character("outsider", 100005)

        cls.private_map = Map.objects.create(
            name="Private", owner=cls.owner, visibility=Map.Visibility.PRIVATE
        )
        cls.char_shared_map = Map.objects.create(
            name="Shared to char", owner=cls.owner, visibility=Map.Visibility.SHARED
        )
        MapShare.objects.create(
            map=cls.char_shared_map, scope=MapShare.Scope.CHARACTER, target_id=100002
        )

        cls.corp_shared_map = Map.objects.create(
            name="Shared to corp", owner=cls.owner, visibility=Map.Visibility.SHARED
        )
        MapShare.objects.create(
            map=cls.corp_shared_map, scope=MapShare.Scope.CORPORATION, target_id=6000
        )

        cls.alliance_shared_map = Map.objects.create(
            name="Shared to alliance", owner=cls.owner, visibility=Map.Visibility.SHARED
        )
        MapShare.objects.create(
            map=cls.alliance_shared_map, scope=MapShare.Scope.ALLIANCE, target_id=7000
        )

        cls.group_shared_map = Map.objects.create(
            name="Shared to group", owner=cls.owner, visibility=Map.Visibility.SHARED
        )
        MapShareGroup.objects.create(map=cls.group_shared_map, group=cls.group)

        cls.read_only_map = Map.objects.create(
            name="Read Only",
            owner=cls.owner,
            visibility=Map.Visibility.PRIVATE,
            read_only=True,
        )

    def test_owner_sees_all_own_maps(self):
        visible = set(Map.objects.visible_to(self.owner).values_list("id", flat=True))
        self.assertEqual(
            visible,
            {
                self.private_map.id,
                self.char_shared_map.id,
                self.corp_shared_map.id,
                self.alliance_shared_map.id,
                self.group_shared_map.id,
                self.read_only_map.id,
            },
        )

    def test_character_grant_scopes_to_that_user_only(self):
        visible = set(
            Map.objects.visible_to(self.char_grantee).values_list("id", flat=True)
        )
        self.assertEqual(visible, {self.char_shared_map.id, self.read_only_map.id})

    def test_corporation_grant_scopes_to_that_corporation(self):
        visible = set(
            Map.objects.visible_to(self.corp_grantee).values_list("id", flat=True)
        )
        self.assertEqual(visible, {self.corp_shared_map.id, self.read_only_map.id})

    def test_alliance_grant_scopes_to_that_alliance(self):
        visible = set(
            Map.objects.visible_to(self.alliance_grantee).values_list("id", flat=True)
        )
        self.assertEqual(visible, {self.alliance_shared_map.id, self.read_only_map.id})

    def test_group_grant_scopes_to_that_group(self):
        visible = set(
            Map.objects.visible_to(self.group_grantee).values_list("id", flat=True)
        )
        self.assertEqual(visible, {self.group_shared_map.id, self.read_only_map.id})

    def test_outsider_sees_only_read_only_maps(self):
        visible = set(Map.objects.visible_to(self.outsider).values_list("id", flat=True))
        self.assertEqual(visible, {self.read_only_map.id})

    def test_read_only_map_visible_to_every_user_with_no_share(self):
        for user in (
            self.char_grantee,
            self.corp_grantee,
            self.alliance_grantee,
            self.group_grantee,
            self.outsider,
        ):
            visible = set(Map.objects.visible_to(user).values_list("id", flat=True))
            self.assertIn(self.read_only_map.id, visible)

    def test_private_map_never_visible_to_non_owner(self):
        for user in (
            self.char_grantee,
            self.corp_grantee,
            self.alliance_grantee,
            self.group_grantee,
            self.outsider,
        ):
            visible = set(Map.objects.visible_to(user).values_list("id", flat=True))
            self.assertNotIn(self.private_map.id, visible)
