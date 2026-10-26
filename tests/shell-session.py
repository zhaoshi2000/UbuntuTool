#!/usr/bin/env python3
"""Run integration checks in a private GNOME/Wayland session, never the user's Shell.

Needs Ubuntu GNOME, Python 3, gnome-shell, gjs, glib-compile-schemas, gdbus.
Example: python3 tests/shell-session.py --artifacts work/integration
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import base64
import struct
import zlib
import gi
from gi.repository import Gio, GLib

ROOT = Path(__file__).resolve().parents[1]
UUID = 'ubuntutool@zhaoshi2000'
FIXTURE = 'ubuntutool-test-only@local'
def sample_png():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind+data) & 0xffffffff)
    width, height = 160, 96
    pixels = bytearray()
    for y in range(height):
        pixels.append(0)
        for x in range(width):
            # A clearly visible, synthetic image; no private user clipboard data.
            pixels.extend((244, 153, 103) if 28<x<132 and 24<y<72 else (42+x//3, 50+y//3, 81))
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
    return base64.b64encode(data + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')).decode()

PNG = sample_png()

def wait_for(callback, timeout=20, description='condition'):
    end = time.monotonic() + timeout
    error = None
    while time.monotonic() < end:
        try:
            result = callback()
            if result:
                return result
        except Exception as exception:
            error = exception
        time.sleep(0.25)
    raise AssertionError(f'Timed out waiting for {description}: {error}')

def run(artifacts):
    artifacts.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='ubuntutool-shell-', ignore_cleanup_errors=True) as temp:
        base = Path(temp)
        for folder in ('home', 'data', 'config', 'cache', 'runtime'):
            (base / folder).mkdir(mode=0o700)
        extensions = base / 'data/gnome-shell/extensions'
        extensions.mkdir(parents=True)
        shutil.copytree(ROOT / 'extension', extensions / UUID)
        shutil.copytree(ROOT / 'tests/fixture', extensions / FIXTURE)
        subprocess.run(['glib-compile-schemas', '--strict', str(extensions / UUID / 'schemas')], check=True)
        env = dict(os.environ, HOME=str(base/'home'), XDG_DATA_HOME=str(base/'data'),
                   XDG_CONFIG_HOME=str(base/'config'), XDG_CACHE_HOME=str(base/'cache'),
                   XDG_RUNTIME_DIR=str(base/'runtime'), GNOME_SHELL_SESSION_MODE='user',
                   LIBGL_ALWAYS_SOFTWARE='1', GALLIUM_DRIVER='llvmpipe',
                   WAYLAND_DISPLAY='wayland-ubuntutool-test', XDG_SESSION_TYPE='wayland', GIO_USE_VFS='local')
        env.pop('DISPLAY', None)
        env.pop('DBUS_SESSION_BUS_ADDRESS', None)
        bootstrap = '''
python3 -c 'import json,os,sys; json.dump(dict(os.environ),open(sys.argv[1],"w"))' "$1"
gsettings set org.gnome.shell enabled-extensions "['ubuntutool-test-only@local', 'ubuntutool@zhaoshi2000']"
gsettings set org.gnome.shell welcome-dialog-last-shown-version '50.0'
gsettings set org.gnome.shell disable-user-extensions false
exec gnome-shell --wayland --headless --no-x11 --virtual-monitor=1280x900 --wayland-display=wayland-ubuntutool-test --mode=user
'''
        logfile = artifacts / 'shell.log'
        with logfile.open('w') as log:
            process = subprocess.Popen(['dbus-run-session', '--', 'sh', '-c', bootstrap, 'sh', str(base/'env.json')],
                                       env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                wait_for(lambda: (base/'env.json').exists(), description='private D-Bus environment')
                bus_env = json.loads((base/'env.json').read_text())
                bus = Gio.DBusConnection.new_for_address_sync(bus_env['DBUS_SESSION_BUS_ADDRESS'],
                    Gio.DBusConnectionFlags.AUTHENTICATION_CLIENT | Gio.DBusConnectionFlags.MESSAGE_BUS_CONNECTION, None, None)
                def command(args):
                    return subprocess.run(args, env=bus_env, capture_output=True, text=True, timeout=15, check=True).stdout.strip()
                def evaluate(code):
                    result = bus.call_sync('org.gnome.Shell', '/org/gnome/Shell', 'org.gnome.Shell', 'Eval',
                        GLib.Variant('(s)', (code,)), GLib.VariantType.new('(bs)'), Gio.DBusCallFlags.NONE, 15000, None).unpack()
                    if not result[0]: raise AssertionError(result[1])
                    return json.loads(result[1]) if result[1] else None
                def extension(body):
                    return evaluate(f'(()=>{{ const e=Main.extensionManager.lookup("{UUID}").stateObj; {body} }})()')
                wait_for(lambda: extension('return e?._alive === true;'), timeout=35, description='extension startup')
                assert extension('return JSON.parse(e._settings.get_string("shortcut-status"));') == []
                print('PASS extension enabled and shortcuts registered', flush=True)
                # Let the test-only unsafe-mode banner expire before a clean UI capture.
                evaluate('Main.overview.hide(); true;')

                def copy_text(value):
                    extension(f'e._clipboard.set_text(imports.gi.St.ClipboardType.CLIPBOARD,{json.dumps(value)}); return true;')
                copy_text('Hello UbuntuTool — 文本历史')
                wait_for(lambda: extension('return e._model.entries.length === 1;'), description='text capture')
                copy_text('第二条 · Windows shortcuts on Ubuntu')
                wait_for(lambda: extension('return e._model.entries.length === 2;'), description='second text capture')
                copy_text('Hello UbuntuTool — 文本历史')
                time.sleep(0.6)
                assert extension('return e._model.entries.length;') == 2
                print('PASS text capture and deduplication', flush=True)

                extension(f'e._clipboard.set_content(imports.gi.St.ClipboardType.CLIPBOARD,"image/png",new imports.gi.GLib.Bytes(imports.gi.GLib.base64_decode("{PNG}"))); return true;')
                wait_for(lambda: extension('return e._model.entries.some(item=>item.kind === "image");'), description='image capture')
                extension('e._model.togglePin(e._model.entries.find(item=>item.kind==="image").id); e.historyChanged(); return true;')
                assert extension('return e._model.query("hello").length;') == 1
                print('PASS image capture, pinning and search', flush=True)

                extension('e._panel.toggle(); return true;')
                time.sleep(4)
                assert extension('return e._panel.indicator.menu.isOpen && e._panel._rows.length === 3;')
                command(['gdbus', 'call', '--session', '--dest', 'org.gnome.Shell.Screenshot',
                         '--object-path', '/org/gnome/Shell/Screenshot', '--method', 'org.gnome.Shell.Screenshot.Screenshot',
                         'false', 'false', str(artifacts/'clipboard.png')])
                rectangle = extension('const a=e._panel.indicator.menu.actor; const [x,y]=a.get_transformed_position(); const [w,h]=a.get_transformed_size(); return [Math.floor(x),Math.floor(y),Math.ceil(w),Math.ceil(h)];')
                command(['gdbus', 'call', '--session', '--dest', 'org.gnome.Shell.Screenshot',
                         '--object-path', '/org/gnome/Shell/Screenshot', '--method', 'org.gnome.Shell.Screenshot.ScreenshotArea',
                         *map(str, rectangle), 'false', str(artifacts/'clipboard-panel.png')])
                extension('e._settings.set_boolean("auto-paste",false); e._select(e._model.entries.find(item=>item.kind==="image")); return true;')
                extension('e._clipboard.get_content(imports.gi.St.ClipboardType.CLIPBOARD,"image/png",(_clipboard,bytes)=>{globalThis.utImageRoundtrip=bytes?.get_size()??0;}); return true;')
                assert wait_for(lambda: evaluate('globalThis.utImageRoundtrip ?? 0'), description='image clipboard round trip') > 0
                print('PASS history popup and image clipboard restoration', flush=True)

                receiver_log = (artifacts/'receiver.log').open('w')
                receiver_state = base/'receiver-state.json'
                receiver = subprocess.Popen(['python3', str(ROOT/'tests/gtk-receiver.py'), str(receiver_state)],
                                            env=bus_env, stdout=receiver_log, stderr=subprocess.STDOUT)
                wait_for(lambda: receiver_state.exists(), description='GTK paste target')
                evaluate('(()=>{const w=global.get_window_actors().map(a=>a.meta_window).find(w=>w.get_title()==="UbuntuTool paste target"); w.activate(global.get_current_time()); return true;})()')
                time.sleep(0.4)
                extension('e._settings.set_boolean("auto-paste",true); return true;')
                # Exercise the real compositor keybinding, not just the menu method.
                evaluate('(()=>{const C=imports.gi.Clutter; globalThis.utKeyboard=global.stage.context.get_backend().get_default_seat().create_virtual_device(C.InputDeviceType.KEYBOARD_DEVICE); const t=imports.gi.GLib.get_monotonic_time(); utKeyboard.notify_keyval(t,C.KEY_Super_L,C.KeyState.PRESSED); utKeyboard.notify_keyval(t+1,C.KEY_v,C.KeyState.PRESSED); utKeyboard.notify_keyval(t+2,C.KEY_v,C.KeyState.RELEASED); utKeyboard.notify_keyval(t+3,C.KEY_Super_L,C.KeyState.RELEASED); return true;})()')
                wait_for(lambda: extension('return e._panel.indicator.menu.isOpen;'), description='actual Super+V binding')
                extension('e._select(e._model.entries.find(item=>item.kind==="text" && item.text.startsWith("Hello"))); return true;')
                wait_for(lambda: json.loads(receiver_state.read_text()).get('text') == 'Hello UbuntuTool — 文本历史', description='automatic paste into GTK application')
                extension('e._activate("minimize-all"); return true;')
                wait_for(lambda: evaluate('global.get_window_actors().some(a=>a.meta_window.get_title()==="UbuntuTool paste target" && a.meta_window.minimized)'), description='minimize all')
                extension('e._activate("restore-all"); return true;')
                wait_for(lambda: evaluate('global.get_window_actors().some(a=>a.meta_window.get_title()==="UbuntuTool paste target" && !a.meta_window.minimized)'), description='restore minimized windows')
                receiver.terminate(); receiver.wait(timeout=5); receiver_log.close()
                print('PASS actual Win+V shortcut and automatic paste into a GTK application', flush=True)

                marker = base/'custom-shortcut-ran'
                custom = [{'id': 'integration', 'label': '测试命令', 'accelerator': '<Super>F12', 'command': f'printf launched > {marker}'}]
                extension(f'e._settings.set_string("custom-shortcuts",{json.dumps(json.dumps(custom))}); return true;')
                evaluate('(()=>{const C=imports.gi.Clutter; const t=imports.gi.GLib.get_monotonic_time(); utKeyboard.notify_keyval(t,C.KEY_Super_L,C.KeyState.PRESSED); utKeyboard.notify_keyval(t+1,C.KEY_F12,C.KeyState.PRESSED); utKeyboard.notify_keyval(t+2,C.KEY_F12,C.KeyState.RELEASED); utKeyboard.notify_keyval(t+3,C.KEY_Super_L,C.KeyState.RELEASED); return true;})()')
                wait_for(marker.exists, description='custom command shortcut')
                assert marker.read_text() == 'launched'
                extension('e._settings.set_string("custom-shortcuts","[]"); return true;')
                print('PASS user-configured shortcut executes the configured command', flush=True)

                # Actual preferences service startup catches GTK/GJS integration errors.
                prefs_log = (artifacts/'prefs.log').open('w')
                prefs = subprocess.Popen(['gnome-extensions', 'prefs', UUID], env=bus_env, stdout=prefs_log, stderr=subprocess.STDOUT)
                time.sleep(3)
                assert prefs.poll() in (None, 0), 'preferences launcher failed'
                assert 'JS ERROR' not in (artifacts/'prefs.log').read_text()
                wait_for(lambda: evaluate('global.get_window_actors().some(a=>a.meta_window.get_title()==="快捷工具箱 — UbuntuTool")'), description='preferences window')
                command(['gdbus', 'call', '--session', '--dest', 'org.gnome.Shell.Screenshot',
                         '--object-path', '/org/gnome/Shell/Screenshot', '--method', 'org.gnome.Shell.Screenshot.Screenshot',
                         'false', 'false', str(artifacts/'preferences.png')])
                print('PASS preferences launcher', flush=True)

                # Captures no plaintext after pause, then persistence survives disable/enable.
                extension('e._settings.set_boolean("paused",true); return true;')
                copy_text('this paused text must not be saved')
                time.sleep(0.5)
                assert extension('return e._model.entries.length;') == 3
                extension('e._settings.set_boolean("paused",false); return true;')
                time.sleep(0.6)
                command(['gnome-extensions', 'disable', UUID])
                index = base/'data/ubuntutool/history.json'
                wait_for(lambda: index.exists() and len(json.loads(index.read_text())['entries']) == 3, description='persistent index')
                assert command(['gsettings', 'get', 'org.gnome.shell.keybindings', 'toggle-message-tray']) == "['<Super>v', '<Super>m']"
                assert index.stat().st_mode & 0o777 == 0o600
                assert index.parent.stat().st_mode & 0o777 == 0o700
                for image in (index.parent/'images').iterdir():
                    assert image.stat().st_mode & 0o777 == 0o600
                command(['gnome-extensions', 'enable', UUID])
                wait_for(lambda: extension('return e._alive && e._model.entries.length >= 3;'), description='restored history')
                assert extension('return e._model.entries.some(item=>item.kind==="image" && item.pinned);')
                print('PASS pause, persistent image history, private permissions and shortcut restoration', flush=True)
                extension('e._settings.set_boolean("paused",true); e._settings.set_string("clear-request","all:integration"); return true;')
                wait_for(lambda: json.loads(index.read_text())['entries'] == [] and not list((index.parent/'images').iterdir()), description='cleared text and image history')
                print('PASS clearing all history removes pinned image payloads too', flush=True)

                def tap(modifiers, key):
                    constants = [*modifiers, key]
                    evaluate(f'(()=>{{const C=imports.gi.Clutter;const t=imports.gi.GLib.get_monotonic_time();const keys={json.dumps(constants)}.map(k=>C[k]);let i=0;for(const k of keys)utKeyboard.notify_keyval(t+i++,k,C.KeyState.PRESSED);for(const k of [...keys].reverse())utKeyboard.notify_keyval(t+i++,k,C.KeyState.RELEASED);return true;}})()')
                def screenshot_window(title, filename):
                    rect = wait_for(lambda: evaluate(f'(()=>{{const a=global.get_window_actors().find(a=>a.meta_window.get_title()==={json.dumps(title)});if(!a?.mapped)return null;const r=a.meta_window.get_frame_rect();return r.width>100&&r.height>100?[r.x,r.y,r.width,r.height]:null;}})()'), description='mapped window geometry')
                    evaluate(f'(()=>{{global.get_window_actors().find(a=>a.meta_window.get_title()==={json.dumps(title)}).meta_window.activate(global.get_current_time());return true;}})()')
                    evaluate('Main.messageTray._notification?.destroy(); true;')
                    time.sleep(0.3)
                    command(['gdbus', 'call', '--session', '--dest', 'org.gnome.Shell.Screenshot',
                             '--object-path', '/org/gnome/Shell/Screenshot', '--method', 'org.gnome.Shell.Screenshot.ScreenshotArea',
                             *map(str, rect), 'false', str(artifacts/filename)])
                extension('e._settings.set_boolean("paused",false); return true;')
                tap(['KEY_Super_L', 'KEY_Shift_L'], 'KEY_t')
                wait_for(lambda: evaluate('global.get_window_actors().some(a=>a.meta_window.get_title()==="UbuntuTool 工具箱")'), description='toolbox hotkey opens hub')
                screenshot_window('UbuntuTool 工具箱', 'toolbox.png')
                tap(['KEY_Alt_L'], 'KEY_a')
                wait_for(lambda: extension('return e._captureController.selector?.mapped && e._captureController.selector.width>100;'), description='Alt+A selector')
                tap([], 'KEY_Escape')
                wait_for(lambda: extension('return !e._captureController.busy;'), description='cancel screenshot with Escape')
                tap(['KEY_Alt_L'], 'KEY_a')
                wait_for(lambda: extension('return e._captureController.selector?.mapped && e._captureController.selector.width>100;'), description='second screenshot selector')
                evaluate('(()=>{const C=imports.gi.Clutter;globalThis.utPointer=global.stage.context.get_backend().get_default_seat().create_virtual_device(C.InputDeviceType.POINTER_DEVICE);utPointer.notify_absolute_motion(imports.gi.GLib.get_monotonic_time(),120,140);return true;})()')
                time.sleep(0.15)
                evaluate('(()=>{const C=imports.gi.Clutter;utPointer.notify_button(imports.gi.GLib.get_monotonic_time(),1,C.ButtonState.PRESSED);return true;})()')
                time.sleep(0.1)
                for step in range(1, 21):
                    evaluate(f'(()=>{{const t=imports.gi.GLib.get_monotonic_time();utPointer.notify_absolute_motion(t,{120+step*32},{140+step*20});return true;}})()')
                    time.sleep(0.015)
                evaluate('(()=>{const C=imports.gi.Clutter;utPointer.notify_button(imports.gi.GLib.get_monotonic_time(),1,C.ButtonState.RELEASED);return true;})()')
                time.sleep(0.4)
                (artifacts/'capture-state.json').write_text(json.dumps(extension('return {busy:e._captureController.busy,selector:!!e._captureController.selector,start:e._captureController.selector?._startX,last:e._captureController.selector?._lastX,pointer:global.get_pointer()};')))
                wait_for(lambda: evaluate('global.get_window_actors().some(a=>a.meta_window.get_title()==="截图标注 — UbuntuTool")'), description='captured region opens annotation editor')
                capture = sorted((base/'cache/ubuntutool/captures').glob('capture-*.png'))[-1]
                assert capture.stat().st_mode & 0o777 == 0o600
                print('PASS toolbox hotkey, Alt+A rectangular capture and Escape cancellation', flush=True)
                editor_log = (artifacts/'editor.log').open('w')
                report = base/'editor-report.json'
                driver = subprocess.Popen(['gjs', '-m', str(ROOT/'tests/editor-driver.js'), str(extensions/UUID),
                                           str(capture), str(artifacts/'annotated.png'), str(report)],
                                          env=bus_env, stdout=editor_log, stderr=subprocess.STDOUT)
                wait_for(report.exists, description='annotation editor draw/save/copy integration')
                result = json.loads(report.read_text())
                assert result['ok'], result.get('error')
                assert result['shapeCount'] == 2 and result['redPixels'] > 100
                screenshot_window('截图标注测试 — UbuntuTool', 'screenshot-editor.png')
                wait_for(lambda: extension('return e._model.entries.some(item=>item.kind==="image");'), description='annotated screenshot reaches Win+V history')
                driver.terminate(); driver.wait(timeout=5); editor_log.close()
                print('PASS red rectangle + arrow gestures, undo/redo, PNG save and clipboard/history export', flush=True)
                owner = evaluate('global.get_window_actors().find(a=>a.meta_window.get_title()==="UbuntuTool 工具箱").meta_window.get_pid()')
                os.kill(owner, signal.SIGTERM)
                time.sleep(0.3)
                cold_cli = subprocess.Popen(['bash', str(ROOT/'scripts/ubuntutool'), 'screenshot'], env=bus_env,
                                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                wait_for(lambda: extension('return e._captureController.selector?.mapped && e._captureController.selector.width>100;'), description='cold CLI screenshot action')
                tap([], 'KEY_Escape')
                wait_for(lambda: extension('return !e._captureController.busy;'), description='cold CLI screenshot cancellation')
                assert cold_cli.wait(timeout=5) == 0
                print('PASS screenshot command starts correctly without an existing toolbox process', flush=True)
                command(['gnome-extensions', 'disable', UUID])
                # Release any remaining preferences windows via their private session at cleanup.
                prefs_log.close()
                if 'JS ERROR' in logfile.read_text():
                    raise AssertionError('Shell reported a JavaScript error; inspect shell.log')
                print('ALL GNOME INTEGRATION CHECKS PASSED', flush=True)
            finally:
                try: os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError: pass
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
                # Only unmount the private test runtime's portal/FUSE mounts.
                for name in ('doc', 'gvfs'):
                    mount = base/'runtime'/name
                    assert mount.parent == base/'runtime'
                    subprocess.run(['fusermount3', '-uz', str(mount)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifacts', type=Path, default=ROOT/'work/integration')
    run(parser.parse_args().artifacts.resolve())
