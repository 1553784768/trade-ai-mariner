from typing import Protocol


class LlmStore(Protocol):
    def get(self) -> dict | None: ...
    # -> {"base_url","model","api_key","last_test"}; the plaintext key lives only in memory
    def save(self, *, base_url: str, model: str, api_key: str) -> dict: ...  # resets last_test to None
    def clear(self) -> None: ...
    def record_test(self, result: dict) -> None: ...  # {"ok","message","latency_ms","at"}


class MemoryLlmStore:
    """Single-process store for the standalone app and the ported MA tests."""
    def __init__(self):
        self._value = None
    def get(self):
        return None if self._value is None else dict(self._value)
    def save(self, *, base_url, model, api_key):
        self._value = dict(base_url=base_url, model=model, api_key=api_key, last_test=None)
        return self.get()
    def clear(self):
        self._value = None
    def record_test(self, result):
        if self._value is not None:
            self._value["last_test"] = result
