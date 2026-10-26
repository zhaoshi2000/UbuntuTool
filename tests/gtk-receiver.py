#!/usr/bin/env python3
"""Private-session paste receiver used by shell-session.py."""
import gi
gi.require_version('Gtk', '4.0')
from gi.repository import Gtk, GLib
import json
from pathlib import Path
import sys

state = Path(sys.argv[1])
app = Gtk.Application(application_id='org.example.UbuntuToolTestReceiver')

def activate(application):
    window = Gtk.ApplicationWindow(application=application, title='UbuntuTool paste target', default_width=500, default_height=140)
    entry = Gtk.Entry(placeholder_text='Paste test target', margin_top=30, margin_bottom=30, margin_start=24, margin_end=24)
    window.set_child(entry)
    window.present()
    entry.grab_focus()
    def publish():
        temp = state.with_suffix('.tmp')
        temp.write_text(json.dumps({'text': entry.get_text(), 'visible': window.get_visible()}))
        temp.replace(state)
        return True
    GLib.timeout_add(100, publish)

app.connect('activate', activate)
app.run([])
