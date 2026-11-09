import asyncio
import atexit
import concurrent.futures

_threadPool = None


async def runInWorker(func, *args):
    """Run `func(*args)` in a worker thread and await its result.

    This used to use a `concurrent.futures.ProcessPoolExecutor`. On
    Windows the default start method is "spawn", and a spawned worker
    re-executes the parent's `__main__` module before it starts working.
    Any host whose `__main__` is not safe to re-execute — an MCP server
    launched with `python -m`, or a pytest run — then breaks the pool:
    the worker dies while importing, or recursively spawns more workers,
    and the awaiting call never returns.

    The work this is used for (scanning a glyph directory and parsing
    JSON) is I/O-bound and releases the GIL between reads, so a thread
    pool is safe, starts instantly, and does not re-execute anything.
    """
    global _threadPool

    if _threadPool is None:
        _threadPool = concurrent.futures.ThreadPoolExecutor(
            thread_name_prefix="fontra-worker"
        )

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_threadPool, func, *args)


def shutdownWorkerPool() -> None:
    global _threadPool

    if _threadPool is not None:
        _threadPool.shutdown(wait=False)
        _threadPool = None


atexit.register(shutdownWorkerPool)
