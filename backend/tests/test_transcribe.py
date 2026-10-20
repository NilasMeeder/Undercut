"""Team radio as text: what is kept of Whisper's segments, and decoding the clips."""

import io
from pathlib import Path

import numpy as np
import pytest

from app import transcribe


def test_made_up_text_is_left_out() -> None:
    segments = [
        ("Box, box.", 0.01, -0.3, 1.1),
        (" Copyright Australian Broadcasting Corporation", 0.0, -0.8, 0.9),  # over noise
        (" Mindster Telemetrics", 0.0, -4.6, 0.7),  # unsure
        (" I like the other.", 0.0, -0.9, 14.5),  # repeats
        (" Thank you.", 0.9, -0.2, 0.6),  # not speech
        (" Copy.", 0.1, -0.4, 0.8),
    ]
    assert transcribe.keep(segments) == "Box, box. Copy."
    assert transcribe.keep([]) == ""


def test_quiet_clips_are_scaled_up() -> None:
    audio = np.array([0.0, 0.05, -0.1], dtype=np.float32)
    assert np.abs(transcribe.normalised(audio)).max() == pytest.approx(transcribe.PEAK)
    assert transcribe.normalised(np.zeros(3, dtype=np.float32)).max() == 0.0


def test_a_clip_decodes_to_16_khz_mono() -> None:
    av = pytest.importorskip("av")
    buffer = io.BytesIO()
    with av.open(buffer, "w", format="mp3") as container:
        stream = container.add_stream("mp3", rate=44100, layout="stereo")
        tone = np.sin(np.linspace(0, 440 * 2 * np.pi, 44100)).astype(np.float32)
        for start in range(0, 44100, 1152):
            chunk = np.tile(tone[start : start + 1152], (2, 1))
            frame = av.AudioFrame.from_ndarray(chunk, format="fltp", layout="stereo")
            frame.sample_rate = 44100
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
    audio = transcribe.decode(buffer.getvalue())
    assert audio.dtype == np.float32 and audio.ndim == 1
    assert abs(len(audio) - 16000) < 2000  # one second, give or take the codec's padding


def test_a_session_is_transcribed_clip_by_clip(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from datetime import UTC, datetime

    from app import radio, replays, sessions
    from app.schemas import TeamRadio

    key = (2025, 16, "R")
    files = {0: "VERSTA01_1_20250907_150000.mp3", 1: "NORLAN01_4_20250907_150100.mp3"}
    monkeypatch.setattr(transcribe, "RADIO_CACHE_DIR", tmp_path)
    monkeypatch.setattr(sessions, "folders", lambda y, r, c: ("Italian Grand Prix", "Race"))
    monkeypatch.setattr(radio, "clip_files", lambda y, r, c: files)
    monkeypatch.setattr(radio, "get_audio", lambda y, r, c, clip: b"mp3")
    monkeypatch.setattr(transcribe, "decode", lambda mp3: np.ones(16000, dtype=np.float32))
    monkeypatch.setattr(transcribe, "prompt", lambda y, r, c: "")
    monkeypatch.setattr(replays, "is_live", lambda y, r, c: False)
    said = iter(["Box, box.", "Copy."])
    monkeypatch.setattr(transcribe, "transcribe", lambda audio, prompt: next(said))

    assert transcribe.status(*key).state == "idle"
    job = transcribe.Job()
    transcribe._run(key, job)
    assert (job.state, job.done, job.total) == ("done", 2, 2)
    assert transcribe.transcripts(*key) == {files[0]: "Box, box.", files[1]: "Copy."}

    utc = datetime(2025, 9, 7, 15, tzinfo=UTC)
    clips = [
        TeamRadio(id=1, driver="NOR", utc=utc, t=10.0),
        TeamRadio(id=2, driver="X", utc=utc, t=None),
    ]
    assert [c.text for c in transcribe.with_text(*key, clips)] == ["Copy.", None]


def test_without_whisper_it_says_how_to_set_it_up(monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi.testclient import TestClient

    from app import radio, sessions
    from app.main import app

    monkeypatch.setattr(transcribe, "engine", lambda: None)
    monkeypatch.setattr(sessions, "folders", lambda y, r, c: ("Italian Grand Prix", "Race"))
    monkeypatch.setattr(radio, "clip_files", lambda y, r, c: {})
    client = TestClient(app, base_url="http://localhost")
    url = "/api/sessions/2025/16/R/team-radio/transcription"
    assert client.get(url).json()["engine"] is None
    refused = client.post(url)
    assert refused.status_code == 409 and "uv sync --group transcribe" in refused.json()["detail"]
