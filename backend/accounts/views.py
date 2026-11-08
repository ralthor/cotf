from django.contrib.auth import authenticate
from rest_framework import generics, permissions, status
from rest_framework.authtoken.models import Token
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ExternalAccount
from .serializers import ExternalAccountSerializer, MeSerializer, RegisterSerializer


def _auth_payload(user):
    token, _ = Token.objects.get_or_create(user=user)
    return {"token": token.key, "user": MeSerializer(user).data}


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = "auth"

    def post(self, request):
        s = RegisterSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = s.save()
        return Response(_auth_payload(user), status=status.HTTP_201_CREATED)


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_scope = "auth"

    def post(self, request):
        user = authenticate(
            request, username=str(request.data.get("username", "")), password=str(request.data.get("password", ""))
        )
        if user is None:
            return Response({"detail": "Invalid username or password."}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_auth_payload(user))


class LogoutView(APIView):
    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(MeSerializer(request.user).data)


class ExternalAccountListView(generics.ListCreateAPIView):
    serializer_class = ExternalAccountSerializer
    pagination_class = None

    def get_queryset(self):
        return ExternalAccount.objects.filter(user=self.request.user).order_by("provider")

    def create(self, request, *args, **kwargs):
        s = self.get_serializer(data=request.data)
        s.is_valid(raise_exception=True)
        account, created = ExternalAccount.objects.update_or_create(
            user=request.user,
            provider=s.validated_data["provider"],
            defaults={"username": s.validated_data["username"]},
        )
        return Response(
            ExternalAccountSerializer(account).data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
        )


class ExternalAccountDetailView(generics.DestroyAPIView):
    serializer_class = ExternalAccountSerializer

    def get_queryset(self):
        return ExternalAccount.objects.filter(user=self.request.user)
