"""Tests for fontra.core.workers.

The worker pool used to be a `concurrent.futures.ProcessPoolExecutor`. On
Windows the default start method is "spawn", and a spawned worker
re-executes the parent's `__main__` module before it starts working. Any
host whose `__main__` is not safe to re-execute — an MCP server started
with `python -m`, for instance — then breaks the pool, and the awaiting
call never returns. The pool is now thread-based.
"""

import asyncio
import multiprocessing

import pytest

from fontra.core.workers import runInWorker, shutdownWorkerPool


def _double(value):
    return value * 2


def _boom():
    raise ValueError("boom")


async def test_runInWorkerReturnsResult():
    assert await runInWorker(_double, 21) == 42


async def test_runInWorkerPropagatesExceptions():
    with pytest.raises(ValueError, match="boom"):
        await runInWorker(_boom)


async def test_runInWorkerDoesNotSpawnAProcess():
    """The worker pool must not create child processes.

    A spawned worker re-executes the host's `__main__`, which deadlocks
    for any host that is not spawn-safe.
    """
    before = len(multiprocessing.active_children())
    assert await runInWorker(_double, 3) == 6
    await asyncio.sleep(0.05)
    assert len(multiprocessing.active_children()) == before


async def test_shutdownWorkerPoolIsSafeToCall():
    assert await runInWorker(_double, 1) == 2
    shutdownWorkerPool()
    # The pool is recreated on demand.
    assert await runInWorker(_double, 2) == 4
