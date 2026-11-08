from django.shortcuts import get_object_or_404
from rest_framework import mixins, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import ExternalAccount, Provider
from accounts.serializers import ExternalAccountSerializer

from .filters import GameFilter
from .models import Game
from .pgn import PgnError
from .providers import LichessClient, ProviderError, parse_lichess_game_id
from .serializers import GameDetailSerializer, GameListSerializer
from .services import import_pgn_text, store_lichess_game
from .tasks import sync_account_task


class GameViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.DestroyModelMixin, viewsets.GenericViewSet):
    filterset_class = GameFilter

    def get_queryset(self):
        qs = Game.objects.filter(user=self.request.user)
        if self.action == "retrieve":
            qs = qs.prefetch_related("moves")
        return qs

    def get_serializer_class(self):
        return GameDetailSerializer if self.action == "retrieve" else GameListSerializer


class PgnImportView(APIView):
    throttle_scope = "imports"

    def post(self, request):
        text = request.data.get("pgn")
        if not isinstance(text, str) or not text.strip():
            return Response({"detail": "Provide PGN text in 'pgn'."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = import_pgn_text(request.user, text)
        except PgnError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        code = status.HTTP_201_CREATED if result["created"] else status.HTTP_200_OK
        if not result["created"] and not result["existing"]:
            code = status.HTTP_400_BAD_REQUEST
        return Response(result, status=code)


def _queue_sync(request, provider: str):
    username = request.data.get("username")
    account = None
    if username:
        s = ExternalAccountSerializer(data={"provider": provider, "username": str(username)})
        s.is_valid(raise_exception=True)
        account, _ = ExternalAccount.objects.update_or_create(
            user=request.user, provider=provider, defaults={"username": s.validated_data["username"]}
        )
    else:
        account = ExternalAccount.objects.filter(user=request.user, provider=provider).first()
    if account is None:
        return Response({"detail": "Link a username first."}, status=status.HTTP_400_BAD_REQUEST)
    result = sync_account_task.delay(account.id)
    return Response({"account": account.id, "task_id": result.id, "status": "queued"}, status=status.HTTP_202_ACCEPTED)


class ChessComImportView(APIView):
    throttle_scope = "imports"

    def post(self, request):
        return _queue_sync(request, Provider.CHESSCOM)


class LichessImportView(APIView):
    throttle_scope = "imports"

    def post(self, request):
        ref = request.data.get("game_url_or_id")
        if ref:
            gid = parse_lichess_game_id(str(ref))
            if not gid:
                return Response({"detail": "Not a Lichess game URL or ID."}, status=status.HTTP_400_BAD_REQUEST)
            try:
                raw = LichessClient().game(gid)
            except ProviderError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
            game, created = store_lichess_game(request.user, raw)
            if game is None:
                return Response(
                    {"detail": "Game is unfinished or not standard chess."}, status=status.HTTP_400_BAD_REQUEST
                )
            return Response({"id": game.id, "created": created}, status=201 if created else 200)
        return _queue_sync(request, Provider.LICHESS)


class SyncNowView(APIView):
    throttle_scope = "imports"

    def post(self, request, pk: int):
        account = get_object_or_404(ExternalAccount, pk=pk, user=request.user)
        result = sync_account_task.delay(account.id)
        return Response({"task_id": result.id, "status": "queued"}, status=status.HTTP_202_ACCEPTED)
