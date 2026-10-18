"""Telemetry per lap from the live feed: CarData.z and Position.z samples merged like FastF1's
lap.get_telemetry() (which made the archive's <DRV>/<lap>_tel.json): both sample sets on one time
axis, numbers interpolated, gear/brake/DRS held, distance integrated from speed.
"""

from array import array
from dataclasses import dataclass, field

import numpy as np

CHANNELS = {"rpm": "0", "speed": "2", "gear": "3", "throttle": "4", "brake": "5", "drs": "45"}
"""Name -> channel number in CarData.z."""
HELD = ("gear", "brake", "drs")
"""Not interpolated: the last sample holds (CLAUDE.md, delta-tijd)."""
DRS_OPEN = (10, 12, 14)


def _floats() -> array:
    return array("d")


@dataclass
class Samples:
    """One car's samples, appended in time order (compact: ~8 bytes per value)."""

    t: array = field(default_factory=_floats)
    values: dict[str, array] = field(default_factory=dict)

    def add(self, t: float, sample: dict[str, float]) -> None:
        if self.t and t <= self.t[-1]:
            return
        self.t.append(t)
        for name, value in sample.items():
            self.values.setdefault(name, _floats()).append(value)

    def copy(self) -> "Samples":
        """A snapshot another thread can read while this one grows (numpy views of the arrays
        would block their appends). Values appended after the times are cut off."""
        t = self.t[:]
        values = {name: v[: len(t)] for name, v in list(self.values.items())}
        n = min([len(t), *(len(v) for v in values.values())])
        return Samples(t[:n], {name: v[:n] for name, v in values.items()})

    @property
    def last(self) -> float | None:
        return self.t[-1] if self.t else None

    def window(self, start: float, end: float) -> tuple[np.ndarray, dict[str, np.ndarray]]:
        """Samples from just before `start` to just after `end` (to interpolate the ends)."""
        t = np.frombuffer(self.t, dtype=float)
        lo = max(int(np.searchsorted(t, start)) - 1, 0)
        hi = min(int(np.searchsorted(t, end, side="right")) + 1, len(t))
        return t[lo:hi].copy(), {
            name: np.frombuffer(v, dtype=float)[lo:hi].copy() for name, v in self.values.items()
        }


def car_sample(channels: dict[str, float]) -> dict[str, float]:
    out = {name: float(channels.get(number) or 0) for name, number in CHANNELS.items()}
    out["brake"] = 1.0 if out["brake"] > 0 else 0.0
    out["drs"] = 1.0 if int(out["drs"]) in DRS_OPEN else 0.0
    out["throttle"] = min(max(out["throttle"], 0.0), 100.0)
    return out


def lap_telemetry(car: Samples, pos: Samples, start: float, end: float) -> dict[str, list] | None:
    """The archive's `tel` columns for the lap from `start` to `end` (session time), or None when
    the samples do not cover it."""
    ct, cv = car.window(start, end)
    pt, pv = pos.window(start, end)
    if len(ct) < 2 or len(pt) < 2 or ct[0] > start + 1 or ct[-1] < end - 1:
        return None
    inside = lambda t: t[(t > start) & (t < end)]  # noqa: E731
    time = np.unique(np.concatenate([[start], inside(ct), inside(pt), [end]]))
    out: dict[str, np.ndarray] = {}
    for name, values in cv.items():
        if name in HELD:
            index = np.clip(np.searchsorted(ct, time, side="right") - 1, 0, len(ct) - 1)
            out[name] = values[index]
        else:
            out[name] = np.interp(time, ct, values)
    for name in ("x", "y", "z"):
        out[name] = np.interp(time, pt, pv[name]) if name in pv else np.zeros(len(time))
    metres = out["speed"] / 3.6
    steps = np.diff(time) * (metres[1:] + metres[:-1]) / 2
    distance = np.concatenate([[0.0], np.cumsum(steps)])
    rel = time - start
    return {
        "time": np.round(rel, 3).tolist(),
        "rpm": np.round(out["rpm"]).tolist(),
        "speed": np.round(out["speed"], 1).tolist(),
        "gear": out["gear"].astype(int).tolist(),
        "throttle": np.round(out["throttle"], 1).tolist(),
        "brake": out["brake"].astype(int).tolist(),
        "drs": out["drs"].astype(int).tolist(),
        "distance": np.round(distance, 2).tolist(),
        "rel_distance": np.round(distance / max(distance[-1], 1e-9), 5).tolist(),
        "x": np.round(out["x"], 1).tolist(),
        "y": np.round(out["y"], 1).tolist(),
        "z": np.round(out["z"], 1).tolist(),
    }
