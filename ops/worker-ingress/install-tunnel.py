#!/usr/bin/env python3
"""Install a supervised Mac → Oracle reverse tunnel using an existing identity."""
import argparse
import os
from pathlib import Path
import plistlib
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--identity', required=True, type=Path)
parser.add_argument('--host', required=True)
parser.add_argument('--state-dir', required=True, type=Path)
args = parser.parse_args()
identity = args.identity.expanduser().resolve(strict=True)
state = args.state_dir.expanduser().resolve()
state.mkdir(parents=True, exist_ok=True)
label = 'app.skatehive.worker-tunnel'
plist = state / f'{label}.plist'
agent = Path.home() / 'Library' / 'LaunchAgents' / plist.name
if agent.exists() or agent.is_symlink():
    raise SystemExit('LaunchAgent already exists. Inspect/drain before replacing; no automatic restart.')
config = {
    'Label': label,
    'ProgramArguments': ['/usr/bin/ssh', '-NT', '-i', str(identity),
        '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
        '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15',
        '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=10',
        '-o', 'TCPKeepAlive=yes',
        '-R', '127.0.0.1:18081:127.0.0.1:8081',
        '-R', '127.0.0.1:16666:127.0.0.1:6666', args.host],
    'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
    'StandardOutPath': str(state / 'tunnel.log'),
    'StandardErrorPath': str(state / 'tunnel-error.log'),
}
plist.write_bytes(plistlib.dumps(config))
agent.parent.mkdir(parents=True, exist_ok=True)
agent.symlink_to(plist)
subprocess.run(['plutil', '-lint', str(plist)], check=True)
subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(agent)], check=True)
print('Installed. Validate loopback listeners and public routes before switching traffic.')
