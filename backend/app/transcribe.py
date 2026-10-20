"""Team radio as text: every clip of a session transcribed on this computer with Whisper (no audio
leaves it). MLX-Whisper on Apple silicon, faster-whisper elsewhere, both optional
(`uv sync --group transcribe`); PyAV decodes the mp3s, so no ffmpeg is needed.

The text is kept per session in <RADIO_CACHE_DIR>/<year>/<event>/<session>/transcripts.json, by
the clip's file name (a live session's clip numbers can shift when one arrives late). A job per
session works through the clips without text; while the session is live it keeps looking for new
ones. One model in memory, one clip at a time (`_model_lock`).
"""

import importlib.util
import io
import json
import logging
import os
import threading
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal

import numpy as np

from app import radio, replays, sessions
from app.config import RADIO_CACHE_DIR
from app.schemas import TeamRadio

MODELS = {
    "mlx": "mlx-community/whisper-large-v3-turbo",
    "faster-whisper": "large-v3-turbo",
}
"""Turbo: near large-v3 on noisy radio, fast. F1DASH_WHISPER_MODEL overrides (e.g. a smaller
one: mlx-community/whisper-small-mlx)."""
SAMPLE_RATE = 16000
NO_SPEECH = 0.6
"""A segment Whisper itself thinks is not speech is left out."""
LOGPROB = -1.0
"""A segment Whisper is this unsure of is made up (a quiet clip: 'Mindster Telemetrics')."""
COMPRESSION = 2.4
"""Text that compresses this well repeats itself ('I like the other.' thirty times)."""
MADE_UP = ("copyright", "subtitles by", "thanks for watching", "thank you for watching", "amara")
"""What Whisper writes over noise, learned from subtitled video."""
PEAK = 0.9
"""Clips are scaled to this peak: F1's are quiet (0.06-0.3), and quiet ones make it repeat."""
LIVE_POLL = 15.0
"""Seconds between looks for new clips while the session is live."""
PROMPT = (
    "Formula 1 team radio between a driver and his race engineer. Box, box. Copy. "
    "Push now. Tyres, softs, mediums, hards, inters. Undercut, overcut, DRS, safety car, "
    "virtual safety car, red flag, track limits. Drivers: {names}."
)

log = logging.getLogger(__name__)
_model_lock = threading.Lock()
_faster_model = None

State = Literal["idle", "running", "done", "error"]


@dataclass
class Job:
    state: State = "running"
    done: int = 0
    total: int = 0
    error: str | None = None


_jobs: dict[tuple[int, int, str], Job] = {}
_guard = threading.Lock()


def engine() -> str | None:
    """'mlx' or 'faster-whisper', whichever is installed; None: transcription is not set up."""
    if importlib.util.find_spec("av") is None:
        return None
    if importlib.util.find_spec("mlx_whisper") is not None:
        return "mlx"
    if importlib.util.find_spec("faster_whisper") is not None:
        return "faster-whisper"
    return None


def model_name(kind: str) -> str:
    return os.environ.get("F1DASH_WHISPER_MODEL") or MODELS[kind]


def decode(mp3: bytes) -> np.ndarray:
    """The clip as 16 kHz mono float32 samples, what Whisper takes."""
    import av

    chunks = []
    with av.open(io.BytesIO(mp3)) as container:
        resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)
        for frame in container.decode(audio=0):
            chunks.extend(out.to_ndarray() for out in resampler.resample(frame))
        chunks.extend(out.to_ndarray() for out in resampler.resample(None))
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks, axis=1)[0].astype(np.float32)


Segment = tuple[str, float, float, float]
"""(text, no-speech probability, average log probability, compression ratio)."""


def keep(segments: list[Segment]) -> str:
    """The text of the segments that are speech and not made up."""
    return " ".join(
        text.strip()
        for text, no_speech, logprob, compression in segments
        if no_speech < NO_SPEECH
        and logprob >= LOGPROB
        and compression <= COMPRESSION
        and not any(phrase in text.lower() for phrase in MADE_UP)
    ).strip()


def normalised(audio: np.ndarray) -> np.ndarray:
    peak = float(np.abs(audio).max()) if len(audio) else 0.0
    return audio * (PEAK / peak) if peak > 0 else audio


def transcribe(audio: np.ndarray, prompt: str) -> str:
    kind = engine()
    if kind is None:
        raise RuntimeError("Transcription is not set up: in backend/, uv sync --group transcribe")
    with _model_lock:
        if kind == "mlx":
            import mlx_whisper

            result = mlx_whisper.transcribe(
                normalised(audio),
                path_or_hf_repo=model_name(kind),
                language="en",
                initial_prompt=prompt,
                condition_on_previous_text=False,
            )
            segments = [
                (s["text"], s["no_speech_prob"], s["avg_logprob"], s["compression_ratio"])
                for s in result["segments"]
            ]
        else:
            global _faster_model
            from faster_whisper import WhisperModel

            if _faster_model is None:
                _faster_model = WhisperModel(model_name(kind), compute_type="int8")
            found, _ = _faster_model.transcribe(
                normalised(audio),
                language="en",
                initial_prompt=prompt,
                condition_on_previous_text=False,
            )
            segments = [
                (s.text, s.no_speech_prob, s.avg_logprob, s.compression_ratio) for s in found
            ]
    return keep(segments)


# --- Per session --------------------------------------------------------------------------------


def _path(year: int, round_number: int, code: str) -> Path:
    event, session = sessions.folders(year, round_number, code)
    return RADIO_CACHE_DIR / str(year) / event / session / "transcripts.json"


def transcripts(year: int, round_number: int, code: str) -> dict[str, str]:
    """Clip file name -> its text, for the clips done so far."""
    try:
        data = json.loads(_path(year, round_number, code).read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save(path: Path, texts: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(texts, ensure_ascii=False, indent=0))
    tmp.replace(path)


def prompt(year: int, round_number: int, code: str) -> str:
    drivers = sessions.get_detail(year, round_number, code).drivers
    return PROMPT.format(names=", ".join(f"{d.first_name} {d.last_name}" for d in drivers))


def with_text(year: int, round_number: int, code: str, clips: list[TeamRadio]) -> list[TeamRadio]:
    files = radio.clip_files(year, round_number, code)
    texts = transcripts(year, round_number, code)
    return [c.model_copy(update={"text": texts.get(files.get(c.id, ""))}) for c in clips]


def status(year: int, round_number: int, code: str) -> Job:
    job = _jobs.get((year, round_number, code))
    if job is not None:
        return job
    files = radio.clip_files(year, round_number, code)
    done = transcripts(year, round_number, code)
    count = sum(1 for f in files.values() if f in done)
    state: State = "done" if files and count == len(files) else "idle"
    return Job(state=state, done=count, total=len(files))


def auto(year: int, round_number: int, code: str) -> None:
    """A live session: transcribe its radio without being asked, once Whisper is set up and
    there are clips (the job then keeps going until the session ends)."""
    key = (year, round_number, code)
    if key in _jobs or _engine_cached() is None:
        return
    if radio.clip_files(*key):
        start(*key)


@lru_cache(maxsize=1)
def _engine_cached() -> str | None:
    return engine()


def start(year: int, round_number: int, code: str) -> Job:
    if engine() is None:
        raise RuntimeError("Transcription is not set up: in backend/, uv sync --group transcribe")
    key = (year, round_number, code)
    with _guard:
        job = _jobs.get(key)
        if job is None or job.state != "running":
            job = _jobs[key] = Job()
            threading.Thread(target=_run, args=(key, job), daemon=True).start()
    return job


def _run(key: tuple[int, int, str], job: Job) -> None:
    try:
        path = _path(*key)
        words = prompt(*key)
        while True:
            files = radio.clip_files(*key)
            texts = transcripts(*key)
            missing = [(clip, f) for clip, f in files.items() if f not in texts]
            job.total, job.done = len(files), len(files) - len(missing)
            for clip, file in missing:
                audio = decode(radio.get_audio(*key, clip))
                texts[file] = transcribe(audio, words) if len(audio) else ""
                _save(path, texts)
                job.done += 1
            if not replays.is_live(*key):
                break
            time.sleep(LIVE_POLL)
        job.state = "done"
    except Exception as error:
        log.exception("Transcribing the team radio of %s failed", key)
        job.state, job.error = "error", str(error) or type(error).__name__
