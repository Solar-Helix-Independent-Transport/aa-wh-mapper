"""Hook into Alliance Auth"""

# Django
from django.utils.translation import gettext_lazy as _

# Alliance Auth
from allianceauth import hooks
from allianceauth.services.hooks import MenuItemHook, UrlHook

# AA WH Mapper App
from wh_mapper import urls


class WhMapperMenuItem(MenuItemHook):
    """This class ensures only authorized users will see the menu entry"""

    def __init__(self):
        # setup menu entry for sidebar
        MenuItemHook.__init__(
            self,
            _("YAWN"),
            "fas fa-cube fa-fw",
            "wh_mapper:index",
            navactive=["wh_mapper:"],
        )

    def render(self, request):
        """Render the menu item"""

        if request.user.has_perm("wh_mapper.basic_access"):
            return MenuItemHook.render(self, request)

        return ""


@hooks.register("menu_item_hook")
def register_menu():
    """Register the menu item"""

    return WhMapperMenuItem()


@hooks.register("url_hook")
def register_urls():
    """Register app urls"""

    return UrlHook(urls, "wh_mapper", r"^wh-mapper/")
