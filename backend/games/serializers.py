from rest_framework import serializers

from .models import Game, Move


class MoveSerializer(serializers.ModelSerializer):
    class Meta:
        model = Move
        fields = ["ply", "colour", "san", "uci", "fen_before", "fen_after", "legal_move_count", "clock_seconds"]


class GameListSerializer(serializers.ModelSerializer):
    latest_accuracy = serializers.SerializerMethodField()

    class Meta:
        model = Game
        fields = [
            "id", "provider", "external_id", "source_url", "white", "black", "white_rating", "black_rating",
            "result", "user_colour", "user_result", "user_rating", "opponent", "opponent_rating", "time_class",
            "time_control", "eco", "opening", "played_at", "ply_count", "provider_accuracy", "imported_at",
            "latest_accuracy",
        ]

    def get_latest_accuracy(self, obj: Game):
        summary = getattr(obj, "_latest_summary", None)
        if summary is None:
            run = obj.analysis_runs.filter(status="complete").order_by("-created_at").first()
            summary = run.summary if run else None
        if not summary:
            return None
        return {"white": summary.get("white", {}).get("accuracy"), "black": summary.get("black", {}).get("accuracy")}


class GameDetailSerializer(GameListSerializer):
    moves = MoveSerializer(many=True, read_only=True)

    class Meta(GameListSerializer.Meta):
        fields = GameListSerializer.Meta.fields + ["pgn", "headers", "initial_fen", "moves"]
