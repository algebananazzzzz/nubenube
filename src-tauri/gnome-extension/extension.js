// Exported on the shell's own bus connection, so callers address it as org.gnome.Shell.

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const IFACE = `<node>
  <interface name="app.nubenube.Tracker">
    <method name="Focused">
      <arg type="s" direction="out" name="app"/>
      <arg type="u" direction="out" name="pid"/>
    </method>
  </interface>
</node>`;

// The .desktop Name, so it matches the names installed.rs lists.
const appName = (win) => Shell.WindowTracker.get_default().get_window_app(win)?.get_name() ?? win.get_wm_class() ?? '';

const tracker = {
    Focused() {
        const win = global.display.focus_window;
        return win ? [appName(win), win.get_pid()] : ['', 0];
    },
};

export default class NubeNubeTracker extends Extension {
    enable() {
        this._dbus = Gio.DBusExportedObject.wrapJSObject(IFACE, tracker);
        this._dbus.export(Gio.DBus.session, '/app/nubenube/Tracker');
    }

    disable() {
        this._dbus.unexport();
        this._dbus = null;
    }
}
