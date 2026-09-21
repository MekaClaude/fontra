import pathlib
import subprocess
import sys

repoDir = pathlib.Path(__file__).resolve().parent.parent
scriptPath = repoDir / "scripts" / "rebuild_unicode_scripts_blocks_data.py"


def test_unicode_scripts_data_needs_update():
    try:
        subprocess.run(
            [sys.executable, str(scriptPath), "--check"],
            check=True,
        )
    except subprocess.CalledProcessError:
        assert (
            0
        ), f"unicode-scripts-blocks.js is stale, please run ./scripts/{scriptPath.name}"
