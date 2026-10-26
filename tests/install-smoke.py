#!/usr/bin/env python3
"""Exercise installation, update, crash recovery, packaging and removal in private HOME / D-Bus."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
UUID = 'ubuntutool@zhaoshi2000'

def run():
    with tempfile.TemporaryDirectory(prefix='ubuntutool-install-') as temp:
        base = Path(temp)
        for name in ('home', 'config', 'data', 'runtime', 'cache'):
            (base/name).mkdir(mode=0o700)
        env = dict(os.environ, HOME=str(base/'home'), XDG_CONFIG_HOME=str(base/'config'),
                   XDG_DATA_HOME=str(base/'data'), XDG_CACHE_HOME=str(base/'cache'), XDG_RUNTIME_DIR=str(base/'runtime'), GIO_USE_VFS='local')
        env.pop('DBUS_SESSION_BUS_ADDRESS', None)
        if os.environ.get('UBUNTUTOOL_INSTALL_TEST_CHILD') != '1':
            subprocess.run(['dbus-run-session', '--', 'env', 'UBUNTUTOOL_INSTALL_TEST_CHILD=1', 'python3', __file__], env=env, check=True)
            return
        # This invocation already has a private D-Bus from the parent. Use its isolated HOME.
        home = Path.home()
        data = Path(os.environ['XDG_DATA_HOME'])
        extension = data/'gnome-shell/extensions'/UUID
        command_env = dict(os.environ)
        def command(args):
            result = subprocess.run(args, env=command_env, capture_output=True, text=True, timeout=25)
            if result.returncode:
                raise AssertionError(f'{args}: {result.stdout}\n{result.stderr}')
            return result.stdout
        command(['bash', str(ROOT/'scripts/install.sh'), '--no-enable'])
        assert (extension/'schemas/gschemas.compiled').exists()
        assert (home/'.local/bin/ubuntutool').exists()
        assert (extension/'LICENSE').exists()
        print('PASS installer and schema compilation', flush=True)

        command_env['GSETTINGS_SCHEMA_DIR'] = str(extension/'schemas')
        baseline = command(['gsettings', 'get', 'org.gnome.shell.keybindings', 'toggle-message-tray']).strip()
        backup = [{'schema': 'org.gnome.shell.keybindings', 'key': 'toggle-message-tray',
                   'before': ['<Super>v', '<Super>m'], 'wasDefault': True, 'applied': ['<Super>m']}]
        command(['gsettings', 'set', 'org.gnome.shell.keybindings', 'toggle-message-tray', "['<Super>m']"])
        # Supply the JSON string as a GVariant string without shell quoting ambiguities.
        from gi.repository import Gio
        source = Gio.SettingsSchemaSource.new_from_directory(str(extension/'schemas'), Gio.SettingsSchemaSource.get_default(), False)
        own = Gio.Settings.new_full(source.lookup('org.gnome.shell.extensions.ubuntutool', False), None, None)
        own.set_string('profile-backup', json.dumps(backup)); Gio.Settings.sync()
        command(['bash', str(ROOT/'scripts/install.sh'), '--defer-reload', '--no-enable'])
        assert command(['gsettings', 'get', 'org.gnome.shell.keybindings', 'toggle-message-tray']).strip() == "['<Super>m']"
        assert json.loads(own.get_string('profile-backup')) == backup
        print('PASS deferred update preserves active shortcut bindings and recovery data', flush=True)
        command(['gjs', '-m', str(extension/'restore-profile.js')])
        assert command(['gsettings', 'get', 'org.gnome.shell.keybindings', 'toggle-message-tray']).strip() == baseline
        print('PASS standalone crash recovery', flush=True)

        command(['bash', str(ROOT/'scripts/install.sh'), '--no-enable'])
        assert list((data/'ubuntutool-backups').iterdir())
        history = data/'ubuntutool/history.json'
        history.parent.mkdir(mode=0o700, exist_ok=True)
        history.write_text('{"version":1,"entries":[]}')
        command(['bash', str(ROOT/'scripts/uninstall.sh')])
        assert not extension.exists()
        assert not (home/'.local/bin/ubuntutool').exists()
        assert history.exists(), 'uninstall must not delete user history implicitly'
        print('PASS update backup and uninstall preserving user data', flush=True)

        command(['python3', str(ROOT/'tools/package.py'), '--output', str(base/'packages')])
        package = base/'packages'/f'{UUID}.shell-extension.zip'
        command(['gnome-extensions', 'install', '--force', str(package)])
        assert (extension/'schemas/gschemas.compiled').exists()
        assert not (extension/'tests').exists()
        print('PASS built extension ZIP installs with GNOME tools', flush=True)
        print('ALL INSTALLATION CHECKS PASSED', flush=True)

if __name__ == '__main__':
    run()
