import Cairo from 'cairo';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {arrowHead, rectangleBounds} from '../core/annotations.js';

export function drawAnnotations(cr, shapes) {
    cr.setSourceRGBA(1, 59 / 255, 48 / 255, 1);
    cr.setLineCap(Cairo.LineCap.ROUND);
    cr.setLineJoin(Cairo.LineJoin.ROUND);
    for (const shape of shapes) {
        cr.setLineWidth(shape.lineWidth);
        if (shape.tool === 'rectangle') {
            const box = rectangleBounds(shape);
            cr.rectangle(box.x, box.y, box.width, box.height);
            cr.stroke();
        } else {
            cr.moveTo(shape.start.x, shape.start.y);
            cr.lineTo(shape.end.x, shape.end.y);
            cr.stroke();
            const [tip, left, right] = arrowHead(shape);
            cr.moveTo(tip.x, tip.y); cr.lineTo(left.x, left.y); cr.lineTo(right.x, right.y);
            cr.closePath(); cr.fill();
        }
    }
}

export function exportPng(source, document) {
    const directory = GLib.build_filenamev([GLib.get_user_cache_dir(), 'ubuntutool', 'captures']);
    GLib.mkdir_with_parents(directory, 0o700);
    GLib.chmod(GLib.path_get_dirname(directory), 0o700); GLib.chmod(directory, 0o700);
    const file = Gio.File.new_for_path(`${directory}/export-${GLib.uuid_string_random()}.png`);
    // Cairo's filename API respects the already-created private file's permissions.
    file.create(Gio.FileCreateFlags.PRIVATE, null).close(null);
    const surface = new Cairo.ImageSurface(Cairo.Format.ARGB32, source.getWidth(), source.getHeight());
    const cr = new Cairo.Context(surface);
    try {
        cr.setSourceSurface(source, 0, 0); cr.paint();
        drawAnnotations(cr, document.shapes);
        surface.flush(); surface.writeToPNG(file.get_path());
    } catch (error) {
        try { file.delete(null); } catch (_) { /* incomplete export */ }
        throw error;
    } finally { cr.$dispose(); surface.finish(); }
    return file;
}
