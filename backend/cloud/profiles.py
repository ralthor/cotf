"""Engine profiles for cloud analysis. Settings are recorded with every run for comparability."""

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class EngineProfile:
    id: str
    label: str
    first_pass_depth: int
    deep_pass_depth: int
    brilliancy_shallow_depth: int
    brilliancy_deep_depth: int
    recheck_depth: int
    per_search_time_limit_s: float
    max_deep_positions: int
    max_brilliancy_candidates: int

    def as_dict(self) -> dict:
        return asdict(self)


PROFILES = {
    p.id: p
    for p in [
        EngineProfile("cloud-standard", "Cloud standard (d20 → d24)", 20, 24, 8, 24, 26, 30, 40, 6),
        EngineProfile("cloud-deep", "Cloud deep (d22 → d28 on key positions)", 22, 28, 8, 28, 30, 60, 30, 8),
    ]
}
