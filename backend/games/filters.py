import django_filters

from .models import Game


class GameFilter(django_filters.FilterSet):
    colour = django_filters.ChoiceFilter(field_name="user_colour", choices=[("w", "white"), ("b", "black")])
    time_class = django_filters.CharFilter(field_name="time_class")
    provider = django_filters.CharFilter(field_name="provider")
    result = django_filters.ChoiceFilter(
        field_name="user_result", choices=[("win", "win"), ("loss", "loss"), ("draw", "draw")]
    )
    opponent = django_filters.CharFilter(field_name="opponent", lookup_expr="icontains")
    date_from = django_filters.IsoDateTimeFilter(field_name="played_at", lookup_expr="gte")
    date_to = django_filters.IsoDateTimeFilter(field_name="played_at", lookup_expr="lte")
    min_rating = django_filters.NumberFilter(field_name="user_rating", lookup_expr="gte")
    max_rating = django_filters.NumberFilter(field_name="user_rating", lookup_expr="lte")
    opening = django_filters.CharFilter(field_name="opening", lookup_expr="icontains")

    class Meta:
        model = Game
        fields = []
