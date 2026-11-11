import os
import shutil
from pathlib import Path

import pytest


@pytest.fixture
def temporal_cli():
    binary = os.environ.get("TEMPORAL_CLI") or shutil.which("temporal")
    if not binary or not Path(binary).is_file():
        pytest.skip(
            "set TEMPORAL_CLI to an installed Temporal CLI; downloads are disabled"
        )
    return binary
