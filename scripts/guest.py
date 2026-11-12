#!/usr/bin/env python3
"""Run the existing Linux commands inside an already running Colima guest."""
import argparse
from dataclasses import asdict, dataclass
import hashlib
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tarfile
import urllib.request

REPO = Path(__file__).resolve().parents[1]
PINS = {
    'birbcrew': '88b219c18adeb352d2f291f099ede990a3190a58',
    'birbverify': 'e785dd8882222b18eaf59ce2b1ceecbd092dcd9e',
}
REPOSITORIES = {'birbcrew': 'crew', 'birbverify': 'verify'}
TOOLS = (
    ('uv', 'https://github.com/astral-sh/uv/releases/download/0.11.3/uv-aarch64-unknown-linux-gnu.tar.gz',
     '711382e3158433f06b11d99afb440f4416359fc3c84558886d8ed8826a921bff', 'uv-aarch64-unknown-linux-gnu/uv'),
    ('rg', 'https://github.com/BurntSushi/ripgrep/releases/download/15.1.0/ripgrep-15.1.0-aarch64-unknown-linux-gnu.tar.gz',
     '2b661c6ef508e902f388e9098d9c4c5aca72c87b55922d94abdba830b4dc885e',
     'ripgrep-15.1.0-aarch64-unknown-linux-gnu/rg'),
    ('bn', 'https://github.com/mattsp1290/beans/releases/download/v0.3.0/bn-linux-aarch64',
     '1781e4b56f7b323a6f509515895d6001edefb151f8a393f7d4004755b7e8ceed', None),
)


@dataclass(frozen=True)
class GuestSetup:
    root: str
    profile: str
    tools: str
    sources: dict[str, str]
    exports: dict[str, str]
    revisions: dict[str, str]


def checked(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def ssh(profile, command, **kwargs):
    return checked(['colima', 'ssh', '--profile', profile, '--', 'sh', '-c', command], **kwargs)


def healthy(profile):
    try:
        checked(['colima', 'status', '--profile', profile, '--json'], stdout=subprocess.DEVNULL)
        result = ssh(profile, 'test "$(uname -s)/$(uname -m)" = Linux/aarch64 && '
                     'test -x /usr/bin/docker && test -x /usr/bin/git && '
                     '/usr/bin/docker info --format "{{.OSType}}/{{.Architecture}}"',
                     capture_output=True, text=True, timeout=30)
        if result.stdout.strip() != 'linux/aarch64':
            raise ValueError('The selected guest must run the Linux ARM64 Docker engine')
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError('Colima or its Docker engine is unavailable. Start or repair it separately. '
                         'This command does not change its lifecycle or network settings.') from error


def write_private(path, text):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(text)
    temporary.chmod(0o600)
    temporary.replace(path)


def tool_bytes(root, tool, download):
    name, url, digest, member = tool
    archive = root / (url.rsplit('/', 1)[-1] if member else 'bin/bn')
    if not archive.exists():
        if not download:
            raise ValueError(f'Missing pinned tool artifact: {archive}. Run scripts/guest-setup.')
        archive.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with urllib.request.urlopen(url, timeout=30) as response:
            data = response.read()
    else:
        data = archive.read_bytes()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f'Pinned tool checksum mismatch: {archive}')
    if not archive.exists():
        archive.write_bytes(data)
    if member:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as package:
            return package.extractfile(member).read()
    return data


def tools_ready(root, install=False):
    for tool in TOOLS:
        expected = tool_bytes(root, tool, install)
        binary = root / 'bin' / tool[0]
        if install and (not binary.exists() or binary.read_bytes() != expected):
            binary.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            temporary = binary.with_name(binary.name + '.tmp')
            temporary.write_bytes(expected)
            temporary.chmod(0o700)
            temporary.replace(binary)
        if not binary.exists() or binary.read_bytes() != expected:
            raise ValueError(f'Pinned tool executable mismatch: {binary}. Run scripts/guest-setup.')
        if install:
            binary.chmod(0o700)


def source_archive(source, revision):
    return subprocess.check_output(['git', '-C', source, 'archive', revision])


def verify_archive(root, content, name):
    with tarfile.open(fileobj=io.BytesIO(content)) as archive:
        members = {member.name.rstrip('/'): member for member in archive.getmembers()}
        for relative, member in members.items():
            path = root / relative
            if member.isfile():
                if path.is_symlink() or not path.is_file() or path.read_bytes() != archive.extractfile(member).read():
                    raise ValueError(f'Pinned producer source mismatch: {path}')
            elif member.issym():
                if not path.is_symlink() or os.readlink(path) != member.linkname:
                    raise ValueError(f'Pinned producer symlink mismatch: {path}')
            elif member.isdir():
                if path.is_symlink() or not path.is_dir():
                    raise ValueError(f'Pinned producer directory mismatch: {path}')
            else:
                raise ValueError(f'Unsupported producer archive member: {relative}')
    generated = {'.venv', '.proof'}
    if name == 'birbcrew':
        generated.add('clients/node_modules')
    for directory, folders, files in os.walk(root, followlinks=False):
        parent = Path(directory).relative_to(root)
        for entry in list(folders) + files:
            relative = (parent / entry).as_posix()
            path = root / relative
            if relative in generated or entry == '__pycache__':
                if path.is_symlink() or not path.is_dir():
                    raise ValueError(f'Invalid generated directory: {path}')
                if entry in folders:
                    folders.remove(entry)
                continue
            if relative == '.birbforge-revision' and path.is_file() and not path.is_symlink():
                continue
            if relative not in members:
                raise ValueError(f'Unexpected producer source: {path}')


def verify_exports(setup):
    if setup.revisions != PINS:
        raise ValueError('Guest setup producer revisions do not match this repository')
    for name, revision in PINS.items():
        root = Path(setup.exports[name])
        verify_archive(root, source_archive(setup.sources[name], revision), name)
        if name == 'birbcrew':
            checked([sys.executable, str(REPO / 'scripts/check-dependency.py'), str(root)], stdout=sys.stderr)
        else:
            manifest = json.loads(subprocess.check_output([
                'git', '-C', setup.sources[name], 'show', f'{revision}:docs/evidence/contextless-closure-acceptance.json']))['source_hashes']
            for relative, digest in manifest.items():
                if hashlib.sha256((root / relative).read_bytes()).hexdigest() != digest:
                    raise ValueError(f'Verify source manifest mismatch: {relative}')
            print(f'Verified {len(manifest)} pinned Verify source hashes', file=sys.stderr, flush=True)


def guest_command(setup, cwd, command):
    environment = [
        f'PATH={setup.tools}/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        f'UV_CACHE_DIR={setup.root}/linux-cache',
        f'UV_PYTHON_INSTALL_DIR={setup.root}/linux-python',
        'DD_INJECTION_ENABLED=false', 'DD_TRACE_ENABLED=false',
        'DD_INSTRUMENTATION_TELEMETRY_ENABLED=false',
        'OTEL_SDK_DISABLED=true',
    ]
    return 'umask 077; cd ' + shlex.quote(str(cwd)) + ' && exec ' + shlex.join([
        'env', '-u', 'PYTHONPATH', '-u', 'LD_PRELOAD', '-u', 'NODE_OPTIONS', *environment, *command])


def setup_parser():
    parser = argparse.ArgumentParser(description='Prepare private pinned tools and producer exports for an existing Linux ARM64 Colima guest.')
    parser.add_argument('--root', type=Path, default=Path.home() / '.local/state/birbforge/guest')
    parser.add_argument('--profile', default='default')
    parser.add_argument('--tools-root', type=Path)
    parser.add_argument('--prepare-only', action='store_true', help='Write configuration without running producer or Forge setup commands')
    for name in PINS:
        parser.add_argument(f'--{REPOSITORIES[name]}-source', f'--{name}-source', dest=f'{name}_source', type=Path, default=REPO.parent / REPOSITORIES[name])
        parser.add_argument(f'--{REPOSITORIES[name]}-export', f'--{name}-export', dest=f'{name}_export', type=Path)
    return parser


def setup_main():
    args = setup_parser().parse_args(sys.argv[2:])
    healthy(args.profile)
    root = args.root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    tools = (args.tools_root or root / 'linux-tools').expanduser().resolve()
    tools_ready(tools, install=True)
    sources = {name: str(getattr(args, name + '_source').expanduser().resolve()) for name in PINS}
    exports = {}
    for name, revision in PINS.items():
        supplied = getattr(args, name + '_export')
        destination = (supplied or root / 'dependencies' / name).expanduser().resolve()
        if not destination.exists():
            destination.mkdir(parents=True, mode=0o700)
            with tarfile.open(fileobj=io.BytesIO(source_archive(sources[name], revision))) as archive:
                archive.extractall(destination, filter='data')
        exports[name] = str(destination)
    setup = GuestSetup(str(root), args.profile, str(tools), sources, exports, PINS)
    marker = Path(exports['birbcrew']) / '.birbforge-revision'
    if not marker.exists():
        write_private(marker, PINS['birbcrew'] + '\n')
    verify_exports(setup)
    if not args.prepare_only:
        for destination in exports.values():
            ssh(setup.profile, guest_command(setup, destination, ['scripts/setup']))
        ssh(setup.profile, guest_command(setup, REPO, ['scripts/setup']))
        verify_exports(setup)
    config = root / 'guest-setup.json'
    write_private(config, json.dumps(asdict(setup), indent=2) + '\n')
    write_private(REPO / '.local/guest-setup-path', str(config) + '\n')
    write_private(REPO / '.local/dependency-path', exports['birbcrew'] + '\n')
    print(f'Guest setup recorded in {config}', flush=True)


def guest_main():
    parser = argparse.ArgumentParser(description='Run a command in the configured Linux guest without forwarding host credentials.')
    parser.add_argument('--producer', choices=(*REPOSITORIES.values(), *PINS), help='Run from this pinned producer export instead of Forge')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        parser.error('provide a command, for example scripts/guest -- uv --version')
    pointer = REPO / '.local/guest-setup-path'
    if not pointer.exists():
        raise ValueError('No guest setup is recorded. Run scripts/guest-setup first.')
    setup = GuestSetup(**json.loads(Path(pointer.read_text().strip()).read_text()))
    healthy(setup.profile)
    tools_ready(Path(setup.tools))
    verify_exports(setup)
    producer = {value: key for key, value in REPOSITORIES.items()}.get(args.producer, args.producer)
    cwd = setup.exports[producer] if producer else REPO
    command_line = guest_command(setup, cwd, command)
    os.execvp('colima', ['colima', 'ssh', '--profile', setup.profile, '--', 'sh', '-c', command_line])


if __name__ == '__main__':
    os.umask(0o077)
    try:
        setup_main() if sys.argv[1:2] == ['setup'] else guest_main()
    except (ValueError, OSError, KeyError, subprocess.SubprocessError, tarfile.TarError) as error:
        raise SystemExit(f'Guest execution failed: {error}')
