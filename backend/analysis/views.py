from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from games.models import Game

from .models import AnalysisRun
from .services import AnalysisValidationError, create_run, run_to_frontend
from .stats import filtered_games, user_stats

ALLOWED_BROWSER_PROFILES = {"fast", "standard", "deep"}


class GameAnalysisView(APIView):
    """GET: all runs for a game (newest first). POST: store a browser analysis as a new immutable run."""

    def get(self, request, pk: int):
        game = get_object_or_404(Game, pk=pk, user=request.user)
        runs = AnalysisRun.objects.filter(game=game).prefetch_related("moves").select_related("game")
        return Response([run_to_frontend(r) for r in runs])

    def post(self, request, pk: int):
        game = get_object_or_404(Game, pk=pk, user=request.user)
        data = request.data
        preset = str(data.get("presetId", ""))
        if preset not in ALLOWED_BROWSER_PROFILES:
            return Response({"detail": "Unknown preset."}, status=status.HTTP_400_BAD_REQUEST)
        moves = data.get("moves")
        if not isinstance(moves, list) or len(moves) > game.ply_count:
            return Response({"detail": "'moves' must be a list no longer than the game."}, status=400)
        try:
            run = create_run(
                game,
                source=AnalysisRun.Source.BROWSER,
                profile=f"browser-{preset}",
                engine_id=str(data.get("engineId", "unknown")),
                settings={"preset": preset},
                moves=moves,
                position_evals=data.get("positionEvals") if isinstance(data.get("positionEvals"), list) else [],
                brilliancy_version=str(data.get("brilliancyVersion", "")),
            )
        except AnalysisValidationError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(run_to_frontend(run), status=status.HTTP_201_CREATED)


class StatsView(APIView):
    def get(self, request):
        return Response(user_stats(filtered_games(request.user, request.query_params)))
