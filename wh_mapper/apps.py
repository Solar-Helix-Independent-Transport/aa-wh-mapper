"""App Configuration"""

# Django
from django.apps import AppConfig

# AA WH Mapper App
from wh_mapper import __version__


class WhMapperConfig(AppConfig):
    """App Config"""

    name = "wh_mapper"
    label = "wh_mapper"
    verbose_name = f"YAWN v{__version__}"
