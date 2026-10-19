import numpy as np
import pytest

from app import energy
from app.analysis import LapTrace

SAMPLE = 0.25  # s, like car data
POWER = 700.0  # W/kg
DRAG = 0.0009  # 1/m: a = P/(m v) - DRAG v², top speed ~330 km/h
GRIP = 12.0  # m/s², traction limit out of the corner
EXIT = 150.0  # km/h
BRAKE_AT = 2500.0
CORNER = BRAKE_AT + 150.0
LENGTH = 3000.0


def full_accel(v: float) -> float:
    return min(GRIP, POWER / v - DRAG * v * v)


def lap(
    clip_from: float | None = None,
    power: float = POWER,
    slope: float = 0.0,
    bend: tuple[float, float, float] | None = None,
    lift_at: float | None = None,
    entry: float = EXIT,
    length: float = LENGTH,
    lose: float = 0.0,
    pause: tuple[float, float] | None = None,
) -> LapTrace:
    """Out of a corner at `entry` km/h, full throttle to BRAKE_AT, brake for corner 1, then
    part throttle to the line. From `clip_from` the car holds its speed at full throttle.
    `slope` climbs over the whole straight; `bend` = (start, end, radius) of a curve in it.
    `lift_at`: off the throttle there, braking only at BRAKE_AT (lift and coast). `lose`: from
    `clip_from` it loses this many m/s² instead (superclipping). `pause` = (start, end): holds its
    speed there and then gains again."""
    rows = []
    t, x, v = 0.0, 0.0, entry / 3.6
    heading, px, py = 0.0, 0.0, 0.0
    while x < length:
        braking = BRAKE_AT <= x < CORNER and v > EXIT / 3.6
        lifted = lift_at is not None and lift_at <= x < BRAKE_AT
        if braking:
            a, throttle, brake = -40.0, 0.0, 1
        elif x >= CORNER:
            a, throttle, brake = 0.0, 40.0, 0
        elif lifted:
            a, throttle, brake = -1.5, 0.0, 0
        elif (clip_from is not None and x >= clip_from) or (
            pause is not None and pause[0] <= x < pause[1]
        ):
            lost = lose if clip_from is not None and x >= clip_from else 0.0
            a, throttle, brake = -9.81 * slope - lost, 100.0, 0
        else:
            a = min(GRIP, power / v - DRAG * v * v) - 9.81 * slope
            throttle, brake = 100.0, 0
        rows.append((t, x, round(v * 3.6), throttle, brake, px, py, x * slope))
        step = v * SAMPLE + a * SAMPLE**2 / 2
        if bend is not None and bend[0] <= x < bend[1]:
            heading += step / bend[2]
        px += step * np.cos(heading)
        py += step * np.sin(heading)
        x += step
        v = max(v + a * SAMPLE, EXIT / 3.6 * 0.5)
        t += SAMPLE
    cols = np.array(rows).T
    return LapTrace(
        distance=cols[1],
        time=cols[0],
        channels={
            "speed": cols[2],
            "throttle": cols[3],
            "brake": cols[4],
            "x": cols[5] * 10,  # decimetres, like the archive
            "y": cols[6] * 10,
            "z": cols[7] * 10,
        },
    )


CORNERS = [("1", CORNER), ("2", LENGTH - 100.0)]


def straight_of(trace: LapTrace, previous: LapTrace | None = None):
    k = energy.kinematics(trace, previous)
    [(corner, after, run)] = energy.straights(k, CORNERS)
    return k, corner, after, run


def envelope_of(*traces: LapTrace) -> energy.Envelope:
    profiles = []
    for trace in traces:
        k, _, _, run = straight_of(trace)
        profile = energy.samples(run, k)
        assert profile is not None
        profiles.append(profile)
    env = energy.envelope(profiles)
    assert env is not None
    return env


def time_at(trace: LapTrace, distance: float) -> float:
    return float(np.interp(distance, trace.distance, trace.time))


def test_acceleration_follows_the_power_curve():
    k, corner, after, run = straight_of(lap())
    assert (corner, after) == ("1", "2")
    v = k.speed[run.start : run.end] / 3.6
    expected = np.minimum(GRIP, POWER / v - DRAG * v**2)
    middle = slice(10, -10)  # the window is one-sided at the ends
    assert np.median(np.abs(run.accel[middle] - expected[middle])) < 0.4


def test_full_deployment_does_not_clip():
    env = envelope_of(lap(), lap(power=POWER * 0.98))
    k, corner, after, run = straight_of(lap())
    result = energy.analyse(k, corner, after, run, env)
    assert result.clip_at is None
    assert result.clipping == []
    assert result.clip_cost_time == 0
    assert result.end == pytest.approx(BRAKE_AT, abs=30)


def test_clipping_and_what_it_costs():
    full, clipped = lap(), lap(clip_from=600.0)
    env = envelope_of(full, full, full, clipped)
    k, corner, after, run = straight_of(clipped)
    result = energy.analyse(k, corner, after, run, env)

    # The 1 s window sees the end of the acceleration: up to half a second (~40 m) late.
    assert result.clip_at == pytest.approx(600.0, abs=60)
    assert result.clipped == pytest.approx(BRAKE_AT - 600.0, abs=60)
    true_cost = (time_at(clipped, BRAKE_AT) - time_at(clipped, 600.0)) - (
        time_at(full, BRAKE_AT) - time_at(full, 600.0)
    )
    # A little low: the clip point comes up to half a second late (see above).
    assert result.clip_cost_time == pytest.approx(true_cost, rel=0.05)
    true_speed = np.interp(BRAKE_AT - 20, full.distance, full.channels["speed"]) - np.interp(
        BRAKE_AT - 20, clipped.distance, clipped.channels["speed"]
    )
    assert result.clip_cost_speed == pytest.approx(true_speed, abs=4)


def test_superclipping_where_nobody_was_faster():
    """Losing speed at full throttle near the top: no lap gained there, but it is the battery."""
    superclipped = lap(clip_from=800.0, lose=0.8)
    env = envelope_of(superclipped, superclipped, superclipped)
    k, corner, after, run = straight_of(superclipped)
    result = energy.analyse(k, corner, after, run, env)
    assert result.clip_at == pytest.approx(800.0, abs=60)
    assert result.superclip is not None
    assert result.superclip[0] == pytest.approx(800.0, abs=80)
    peak = np.interp(800.0, superclipped.distance, superclipped.channels["speed"])
    end = np.interp(BRAKE_AT - 30, superclipped.distance, superclipped.channels["speed"])
    assert result.lost == pytest.approx(peak - end, abs=3)
    # The cost: holding the speed it had instead of losing it.
    assert result.clip_cost_speed == pytest.approx(result.lost, abs=3)


def test_clipping_without_losing_speed_is_not_superclipping():
    full, clipped = lap(), lap(clip_from=600.0)
    env = envelope_of(full, full, full, clipped)
    k, corner, after, run = straight_of(clipped)
    result = energy.analyse(k, corner, after, run, env)
    assert result.clip_at is not None
    assert result.superclip is None
    assert result.lost == 0


def test_clipping_then_deploying_again():
    """Flat for a while where the best laps gained, then deploying again (Baku): it clipped."""
    full, again = lap(), lap(pause=(300.0, 450.0), clip_from=700.0)
    env = envelope_of(full, full, full, again)
    k, corner, after, run = straight_of(again)
    result = energy.analyse(k, corner, after, run, env)
    assert result.clip_at == pytest.approx(300.0, abs=60)
    assert len(result.clipping) == 2
    assert result.clipping[1][0] == pytest.approx(700.0, abs=60)


def _ending(rpm_falls: bool) -> tuple[energy.Kinematics, energy.Run]:
    """3 s at 320 km/h, then 0.4 s losing 9 m/s² at full throttle, the rpm with it or not."""
    n, fast = 34, 4
    t = np.arange(n) * energy.DT
    speed = np.concatenate(
        [np.full(n - fast, 320.0), 320.0 - 9 * 3.6 * energy.DT * np.arange(1, fast + 1)]
    )
    rpm = (speed if rpm_falls else np.full(n, 320.0)) * 34.4
    k = energy.Kinematics(
        distance=np.cumsum(speed / 3.6 * energy.DT),
        time=t,
        speed=speed,
        full=np.ones(n, dtype=bool),
        brake=np.zeros(n, dtype=bool),
        gear=np.full(n, 8.0),
        rpm=rpm,
        slope=np.zeros(n),
        lateral=np.zeros(n),
        length=LENGTH,
    )
    accel = np.concatenate([np.zeros(n - fast), np.full(fast, -9.0)])
    return k, energy.Run(start=0, end=n, accel=accel, judged=np.ones(n, dtype=bool))


def test_a_fast_loss_at_the_end_with_the_rpm_is_superclipping():
    """Monza 2026 R into T8: 312 to 302 km/h in 0.65 s at full throttle, the rpm falling too."""
    k, run = _ending(rpm_falls=True)
    assert energy._held_to(k, run) == run.end


def test_a_fast_loss_at_the_end_without_the_rpm_is_the_lift():
    """The speed falls a fraction of a second before the throttle shows the lift; the rpm (the
    wheels, in one gear) does not yet."""
    k, run = _ending(rpm_falls=False)
    assert energy._held_to(k, run) == run.end - 4


def test_less_power_while_still_gaining_is_not_clipping():
    env = envelope_of(lap(), lap())
    k = energy.kinematics(lap(power=POWER * 0.8, lift_at=800.0))
    [(corner, after, run)] = energy.straights(k, CORNERS)
    assert energy.analyse(k, corner, after, run, env).clip_at is None


def test_climb_is_not_clipping():
    """Uphill the car gains less on the same power: corrected by g × slope."""
    env = envelope_of(lap(), lap())
    k, corner, after, run = straight_of(lap(slope=0.08))
    assert energy.analyse(k, corner, after, run, env).clip_at is None


def test_holding_speed_in_a_fast_corner_is_not_clipping():
    """A flat-out bend: speed set by grip and drag, not by the battery."""
    bend = (600.0, 900.0, 250.0)  # ~280 km/h on a 250 m radius: > 2 g
    env = envelope_of(lap(), lap())
    k, corner, after, run = straight_of(lap(clip_from=600.0, bend=bend))
    assert not run.judged[(k.distance[run.start : run.end] > 700)].all()
    result = energy.analyse(k, corner, after, run, env)
    # Only the part after the bend counts.
    assert result.clip_at == pytest.approx(900.0, abs=60)


def test_main_straight_continues_from_the_previous_lap():
    previous = lap(length=LENGTH)
    current = lap(entry=EXIT)
    k = energy.kinematics(current, previous)
    assert k.distance[0] < -energy.PREVIOUS_TAIL + 50
    starts = [k.distance[run.start] for _, _, run in energy.straights(k, CORNERS)]
    assert starts == [pytest.approx(0.0, abs=15)]  # the previous lap ends at part throttle


def test_run_cut_by_the_line_belongs_to_the_next_lap():
    # Full throttle to the line: no corner to brake for in this lap.
    trace = lap(clip_from=None)
    trace.channels["throttle"][trace.distance > CORNER] = 100.0
    k = energy.kinematics(trace)
    assert [c for c, _, _ in energy.straights(k, CORNERS)] == ["1"]


def test_data_gap_is_not_a_straight():
    trace = lap()
    hole = (trace.distance > 1000) & (trace.distance < 1300)
    keep = ~hole
    gappy = LapTrace(
        distance=trace.distance[keep],
        time=trace.time[keep],
        channels={k: v[keep] for k, v in trace.channels.items()},
    )
    k = energy.kinematics(gappy)
    runs = energy.runs(k)
    assert all(not (k.distance[r.start] < 1100 < k.distance[r.end - 1]) for r in runs)


def test_lift_and_coast():
    k = energy.kinematics(lap(lift_at=BRAKE_AT - 150.0))
    [(corner, after, run)] = energy.straights(k, CORNERS)
    result = energy.analyse(k, corner, after, run, None)
    assert result.end == pytest.approx(BRAKE_AT - 150.0, abs=30)
    # The brake comes at the first sample past BRAKE_AT, the lift a sample before lift_at.
    assert result.coast == pytest.approx(150.0, abs=50)
    plain = energy.analyse(*straight_of(lap())[0:1], "1", "2", straight_of(lap())[3], None)
    assert plain.coast == 0


def test_envelope_projection():
    env = energy.Envelope(speed=np.array([100.0, 400.0]), accel=np.array([5.0, 5.0]))
    v1, time = env.project(180.0, 200.0)
    v0 = 50.0  # m/s
    assert v1 / 3.6 == pytest.approx(np.sqrt(v0**2 + 2 * 5.0 * 200.0), rel=1e-3)
    assert time == pytest.approx((v1 / 3.6 - v0) / 5.0, rel=1e-3)


def test_envelope_projection_uphill():
    env = energy.Envelope(speed=np.array([100.0, 400.0]), accel=np.array([5.0, 5.0]))
    v1, _ = env.project(180.0, 200.0, slope=0.1)  # 10%: ~1 m/s² less
    a = 5.0 - round(9.81 * 0.1, 1)
    assert v1 / 3.6 == pytest.approx(np.sqrt(50.0**2 + 2 * a * 200.0), rel=1e-3)


def test_envelope_projection_stops_at_its_top_speed():
    env = energy.Envelope(speed=np.array([200.0, 300.0]), accel=np.array([4.0, 4.0]))
    v1, time = env.project(290.0, 1000.0)
    assert v1 == pytest.approx(300.0, abs=0.3)
    assert env.project(320.0, 100.0) == pytest.approx((320.0, 100.0 / (320.0 / 3.6)))


def profiles(*laps: tuple[list[float], list[float]]) -> list[energy.Profile]:
    out = [energy.profile(np.array(s), np.array(a)) for s, a in laps]
    assert all(p is not None for p in out)
    return out  # type: ignore[return-value]


def test_profile_is_the_median_per_bin():
    p = energy.profile(np.array([201.0, 202.0, 203.0, 204.0, 251.0]), np.array([5, 9, 1, 2, 3.0]))
    assert p is not None
    assert p.bins.tolist() == [40, 50]
    assert p.accel.tolist() == [3.5, 3.0]
    assert p.top == 251.0


def test_envelope_is_the_best_laps_per_speed():
    env = energy.envelope(
        profiles(
            ([201.0, 202.0, 203.0, 251.0], [5.0, 9.0, 1.0, 3.0]),  # noisy: the median counts
            ([202.0, 252.0], [4.0, 2.0]),
            ([203.0, 251.5], [6.0, 2.5]),
        )
    )
    assert env is not None
    assert env.speed.tolist() == [202.5, 252.0]  # the top ends at the highest speed seen
    assert env.accel[0] == pytest.approx(np.percentile([5.0, 4.0, 6.0], energy.PERCENTILE))
    assert env.accel[1] == pytest.approx(np.percentile([3.0, 2.0, 2.5], energy.PERCENTILE))


def test_envelope_needs_laps_per_bin():
    laps = profiles(
        ([201.0, 251.0], [5.0, 3.0]),
        ([202.0, 252.0], [4.0, 2.0]),
        ([203.0, 301.0], [6.0, 1.0]),
        ([204.0, 253.0], [6.0, 1.0]),
    )
    env = energy.envelope(laps)
    assert env is not None
    assert 302.5 not in env.speed  # one lap only
    assert energy.envelope(laps[:1]) is not None  # with one lap, that lap is the envelope
    assert energy.envelope(profiles(([200.0], [1.0]))) is None


def test_corner_names():
    corners = [("1", 800.0), ("4", 1980.0), ("11", 5000.0)]
    assert energy.corner_after(corners, 760.0) == "1"
    assert energy.corner_after(corners, 840.0) == "1"  # within the slack past the apex
    assert energy.corner_after(corners, 5100.0) is None
    assert energy.corner_before(corners, 1000.0) == "1"
    assert energy.corner_before(corners, -400.0) == "11"  # from the previous lap


def test_deploy_is_the_share_of_the_envelope():
    env = envelope_of(lap(), lap(power=POWER * 0.98))
    k, _, _, run = straight_of(lap())
    full = energy.deploy(k, run, env)
    gaining = env.at(k.speed[run.start : run.end]) >= energy.DEPLOY_MIN_ENVELOPE
    assert np.nanmedian(full[gaining]) == pytest.approx(100, abs=8)
    k, _, _, run = straight_of(lap(clip_from=500.0))
    clipped = energy.deploy(k, run, env)
    after = (k.distance[run.start : run.end] > 600) & ~np.isnan(clipped)
    assert after.any()
    assert np.median(clipped[after]) == pytest.approx(0, abs=8)


def test_deploy_is_not_judged_in_a_bend_but_near_top_speed():
    env = envelope_of(lap(), lap(power=POWER * 0.98))
    k, _, _, run = straight_of(lap(bend=(600.0, 900.0, 120.0)))
    share = energy.deploy(k, run, env)
    d = k.distance[run.start : run.end]
    assert np.isnan(share[(d > 650) & (d < 850)]).all()
    # Near the top speed the share is of DEPLOY_MIN_ENVELOPE: a car holding speed reads ~0.
    v = k.speed[run.start : run.end]
    top = (env.at(v) < 0.5 * energy.DEPLOY_MIN_ENVELOPE) & ~np.isnan(share)
    assert top.any() and np.all(np.abs(share[top]) < 60)


def test_downshift_at_full_throttle():
    trace = lap(clip_from=1200.0)
    gear = np.full(trace.distance.size, 8.0)
    gear[trace.distance > 2200] = 7.0
    gear[trace.distance < 300] = 4.0  # out of the corner: upshifts only
    trace.channels["gear"] = gear
    k, corner, after, run = straight_of(trace)
    [(at, to, speed)] = energy.downshifts(k, run)
    assert at == pytest.approx(2200, abs=30)
    assert to == 7 and speed > energy.MIN_DOWNSHIFT_SPEED
    assert energy.analyse(k, corner, after, run, None).downshifts == [(at, to, speed)]


def test_run_across_the_line():
    trace = lap()
    trace.channels["throttle"][trace.distance > CORNER] = 100.0
    k = energy.kinematics(trace)
    found = energy.runs(k)
    across = energy.across_line(k, found)
    assert across is not None and k.distance[across.start] > BRAKE_AT
    assert (
        energy.across_line(energy.kinematics(lap()), energy.runs(energy.kinematics(lap()))) is None
    )


def test_deploying_is_more_than_the_engine_alone():
    env = envelope_of(lap(), lap(power=POWER * 0.98))
    k, corner, after, run = straight_of(lap())
    full = energy.analyse(k, corner, after, run, env, env)
    # Full power: deploying from where power, not grip, limits (200 km/h) until it stops
    # gaining at its top speed (~323 km/h after ~950 m).
    [(start, end)] = full.deploying
    assert 200 < float(np.interp(start, k.distance, k.speed)) < 215
    assert 800 < end < 1100
    # The same car on the engine alone (the MGU-K's share of the power gone) never deploys.
    engine = POWER - energy.K_POWER / energy.MASS
    k, corner, after, run = straight_of(lap(power=engine))
    assert energy.analyse(k, corner, after, run, env, env).deploying == []
    # Without the session's envelope nothing is said.
    assert energy.analyse(k, corner, after, run, env).deploying == []
