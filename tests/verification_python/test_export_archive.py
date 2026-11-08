import importlib.util
import io
import sys
import tarfile
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location(
    "guest_export_checker", Path(__file__).resolve().parents[2] / "scripts/guest.py"
)
guest = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = guest
spec.loader.exec_module(guest)


def archive(root):
    (root / "src").mkdir()
    (root / "src/module.py").write_text("answer = 42\n")
    (root / "entry.py").symlink_to("src/module.py")
    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w") as package:
        package.add(root / "src", arcname="src")
        package.add(root / "entry.py", arcname="entry.py")
    return data.getvalue()


def test_archive_rejects_extra_importable_module(tmp_path):
    content = archive(tmp_path)
    guest.verify_archive(tmp_path, content, "birbverify")
    (tmp_path / ".venv").mkdir()
    (tmp_path / ".venv/generated").write_text("runtime")
    guest.verify_archive(tmp_path, content, "birbverify")
    (tmp_path / "src/sitecustomize.py").write_text("raise RuntimeError()")
    with pytest.raises(ValueError, match="Unexpected producer source"):
        guest.verify_archive(tmp_path, content, "birbverify")


def test_archive_rejects_changed_symlink_and_generated_symlink(tmp_path):
    content = archive(tmp_path)
    (tmp_path / "entry.py").unlink()
    (tmp_path / "entry.py").symlink_to("src/other.py")
    with pytest.raises(ValueError, match="symlink mismatch"):
        guest.verify_archive(tmp_path, content, "birbverify")
    (tmp_path / "entry.py").unlink()
    (tmp_path / "entry.py").symlink_to("src/module.py")
    (tmp_path / ".venv").symlink_to("src", target_is_directory=True)
    with pytest.raises(ValueError, match="Invalid generated directory"):
        guest.verify_archive(tmp_path, content, "birbverify")
