// Run on Ubuntu's actual desktop display using a synthetic PNG input. The
// Windows probe then verifies the bytes received through the real RDP channel.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';
import {publishCompatibleImage, bitmapToPng} from '../extension/clipboard.js';
const root = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
const directory = GLib.build_filenamev([GLib.get_user_cache_dir(), 'ubuntutool', 'captures']);
GLib.mkdir_with_parents(directory, 0o700);
const [, bytes] = Gio.File.new_for_path(ARGV[0]).load_contents(null);
const pixels = GdkPixbuf.Pixbuf.new_from_file(ARGV[0]);
const [bmpOk, bitmap] = pixels.save_to_bufferv('bmp', [], []);
if (!bmpOk) throw new Error('BMP fixture encoding failed');
const imported = bitmapToPng(new GLib.Bytes(bitmap)).get_data();
if (![137,80,78,71,13,10,26,10].every((n,i)=>imported[i]===n)) throw new Error('Windows BMP could not be normalized to PNG');
const result = await publishCompatibleImage(`${root}/extension`, directory, new GLib.Bytes(bytes), 'image/png');
print(JSON.stringify({ok: true, bmpImport: true, pngHash: result.pngHash, pid: result.process.get_identifier()}));
