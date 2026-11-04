"""Managed EUTONOS entry for this adoption profile."""
import os
from pathlib import Path
import subprocess
import sys

modules = {'assignments': 'assignments_cli', 'boards': 'boards_cli', 'capture': 'companion_capture', 'communication': 'communication_cli', 'companion': 'companion_control', 'dashboard': 'dashboard_cli', 'host': 'host_cli', 'hub': 'cli', 'measurement': 'measurement_cli', 'nav': 'nav_cli', 'ram': 'ram_cli', 'ram-capture': 'companion_ram_capture', 'ram-relevance': 'ram_relevance_cli', 'settings': 'settings_cli', 'setup': 'setup_cli', 'version': 'release', 'workflow': 'workflow_cli'}
launchers = {'assignments_cli': 'eutonos-assignments', 'boards_cli': 'eutonos-boards', 'cli': 'eutonos', 'communication_cli': 'eutonos-communication', 'companion_capture': 'eutonos-capture', 'companion_control': 'eutonos-companion', 'companion_ram_capture': 'eutonos-ram-capture', 'dashboard_cli': 'eutonos-dashboard', 'host_cli': 'eutonos-host', 'measurement_cli': 'eutonos-measurement', 'nav_cli': 'eutonos-nav', 'ram_cli': 'eutonos-ram', 'ram_relevance_cli': 'eutonos-ram-relevance', 'release': 'eutonos-version', 'settings_cli': 'eutonos-settings', 'setup_cli': 'eutonos-setup', 'workflow_cli': 'eutonos-workflow'}
if len(sys.argv) < 2 or sys.argv[1] not in modules:
    raise SystemExit("Choose: " + ", ".join(modules))
# Parity copy of eutonos.home.home(): EUTONOS_HOME (tests and staging) wins, else ~/.eutonos.
home = Path(os.environ.get("EUTONOS_HOME") or Path.home() / ".eutonos")
if not home.is_absolute():
    raise SystemExit("EUTONOS_HOME must be an absolute path.")
implementation = modules[sys.argv[1]]
launcher = home / "bin" / (launchers[implementation] + (".exe" if os.name == "nt" else ""))
python = os.environ.get("EUTONOS_PYTHON")
root = Path(__file__).resolve().parent.parent
if python:
    if not Path(python).is_file():
        raise SystemExit("EUTONOS runtime missing; install an exact wheel or set EUTONOS_PYTHON.")
    command = [python, "-m", "eutonos." + implementation]
elif launcher.is_file():
    command = [str(launcher)]
else:
    raise SystemExit("EUTONOS runtime missing; install EUTONOS (its commands live in " + str(launcher.parent) + ") or set EUTONOS_PYTHON.")
raise SystemExit(subprocess.call([*command, *sys.argv[2:], "--root", str(root)]))
