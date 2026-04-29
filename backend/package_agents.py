#!/usr/bin/env python3
"""
Package each Lambda directory into a linux/amd64 zip suitable for AWS Lambda.

For each Lambda we:
  1. `uv export` its pinned requirements
  2. `pip install` them into a tempdir using the official Lambda base image
     (linux/amd64) so wheels match the runtime
  3. Copy the Lambda's handler.py + the shared `vendor_concentration_agent`
     package + references/references.json into the same tempdir
  4. Zip it.

Run from repo root:
    uv run backend/package_agents.py
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND = REPO_ROOT / "backend"
SHARED_PKG = BACKEND / "vendor_concentration_agent"
REFERENCES = REPO_ROOT / "references" / "references.json"

# Lambdas → whether they need the shared agent package + references registry
LAMBDAS: dict[str, dict] = {
    "orchestrator": {"include_shared": True, "include_references": True},
    "discovery_agent": {"include_shared": True, "include_references": True},
    "investigation_agent": {"include_shared": True, "include_references": True},
    "validator_agent": {"include_shared": True, "include_references": True},
    "narrative_agent": {"include_shared": True, "include_references": True},
    "scheduler": {"include_shared": False, "include_references": False},
    "scan_scheduler": {"include_shared": False, "include_references": False},
}


def run(cmd: list[str], cwd: Path | None = None) -> str:
    print(f"  $ {' '.join(map(str, cmd))}")
    r = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout)
        print(r.stderr, file=sys.stderr)
        sys.exit(r.returncode)
    return r.stdout


def package(lambda_name: str, opts: dict) -> Path:
    lambda_dir = BACKEND / lambda_name
    print(f"\n▸ packaging {lambda_name}")

    with tempfile.TemporaryDirectory() as td:
        td_path = Path(td)
        pkg_dir = td_path / "package"
        pkg_dir.mkdir()

        # Pinned requirements from this Lambda's uv project
        requirements = run(
            ["uv", "export", "--no-hashes", "--no-emit-project"],
            cwd=lambda_dir,
        )
        req_file = td_path / "requirements.txt"
        req_file.write_text(requirements)

        # Make the tempdir + req file world-readable so the rootful Docker
        # container can read it, then chown back after.
        td_path.chmod(0o755)
        req_file.chmod(0o644)

        # Install for linux/amd64 inside the official Lambda base image.
        # `sudo` matches the prep-deploy reference — needed where the docker
        # daemon socket is owned by root and the user isn't in the docker group.
        run([
            "sudo", "docker", "run", "--rm", "--platform", "linux/amd64",
            "-v", f"{td_path}:/build:z",
            "--entrypoint", "/bin/bash",
            "public.ecr.aws/lambda/python:3.12",
            "-c", "pip install --quiet --target /build/package -r /build/requirements.txt",
        ])

        # Docker ran as root → chown the package back so this script can clean up.
        if os.name == "posix":
            run(["sudo", "chown", "-R", f"{os.getuid()}:{os.getgid()}", str(td_path)])

        # Copy the handler
        shutil.copy(lambda_dir / "handler.py", pkg_dir / "handler.py")

        # Copy the shared agent package (the heart of the funding-loops
        # implementation: math layer, agents/, prompts/, tools/, trace/, etc.)
        if opts["include_shared"]:
            shutil.copytree(
                SHARED_PKG,
                pkg_dir / "vendor_concentration_agent",
                ignore=shutil.ignore_patterns(
                    "__pycache__", "*.pyc", "*.pyo", "*.swp", ".pytest_cache"
                ),
            )

        # Copy references.json so the validator + math layer can resolve
        # reference_ids without a network round-trip.
        if opts["include_references"] and REFERENCES.exists():
            ref_dir = pkg_dir / "references"
            ref_dir.mkdir()
            shutil.copy(REFERENCES, ref_dir / "references.json")

        # Zip it
        zip_path = lambda_dir / f"{lambda_name}.zip"
        if zip_path.exists():
            zip_path.unlink()
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in pkg_dir.rglob("*"):
                if f.is_file():
                    zf.write(f, f.relative_to(pkg_dir))

        size_mb = zip_path.stat().st_size / (1024 * 1024)
        print(f"  ✓ {zip_path.relative_to(REPO_ROOT)} ({size_mb:.1f} MB)")
        return zip_path


def main() -> int:
    print("=" * 60)
    print("Packaging Lambda functions for vendor-agent")
    print("=" * 60)

    try:
        run(["sudo", "docker", "info", "--format", "{{.ServerVersion}}"])
    except SystemExit:
        print("Docker is not running. Start it and retry.", file=sys.stderr)
        return 1
    except FileNotFoundError:
        print("Docker not found.", file=sys.stderr)
        return 1

    for name, opts in LAMBDAS.items():
        package(name, opts)

    print("\nDone. Next: cd terraform && terraform apply")
    return 0


if __name__ == "__main__":
    sys.exit(main())
