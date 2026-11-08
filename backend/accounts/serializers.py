import re

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from .models import ExternalAccount, Provider

USERNAME_PATTERNS = {
    Provider.CHESSCOM: re.compile(r"^[A-Za-z0-9_-]{2,50}$"),
    Provider.LICHESS: re.compile(r"^[A-Za-z0-9_-]{2,30}$"),
}


class RegisterSerializer(serializers.Serializer):
    username = serializers.RegexField(r"^[A-Za-z0-9_.-]{3,40}$", max_length=40)
    password = serializers.CharField(write_only=True, min_length=8, max_length=128)
    email = serializers.EmailField(required=False, allow_blank=True)

    def validate_username(self, value: str) -> str:
        if get_user_model().objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("That username is taken.")
        return value

    def validate(self, attrs):
        validate_password(attrs["password"], get_user_model()(username=attrs["username"]))
        return attrs

    def create(self, validated_data):
        return get_user_model().objects.create_user(
            username=validated_data["username"],
            password=validated_data["password"],
            email=validated_data.get("email", ""),
        )


class ExternalAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExternalAccount
        fields = ["id", "provider", "username", "created_at", "last_synced_at", "last_sync_status", "last_sync_error"]
        read_only_fields = ["id", "created_at", "last_synced_at", "last_sync_status", "last_sync_error"]

    def validate(self, attrs):
        provider = attrs["provider"]
        username = attrs["username"].strip().lstrip("@")
        if not USERNAME_PATTERNS[provider].match(username):
            raise serializers.ValidationError({"username": "Invalid username for this provider."})
        attrs["username"] = username.lower() if provider == Provider.CHESSCOM else username
        return attrs


class MeSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    email = serializers.EmailField()
    external_accounts = ExternalAccountSerializer(many=True)
