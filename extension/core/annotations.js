// Image-space geometry is independent of GTK scaling and scroll positions.
export function fitImage(imageWidth, imageHeight, viewWidth, viewHeight, padding = 24) {
    const scale = Math.max(0.001, Math.min(1, (viewWidth - padding * 2) / imageWidth, (viewHeight - padding * 2) / imageHeight));
    return {scale, x: (viewWidth - imageWidth * scale) / 2, y: (viewHeight - imageHeight * scale) / 2};
}

export function imagePoint(x, y, transform, width, height, clamp = false) {
    const px = (x - transform.x) / transform.scale;
    const py = (y - transform.y) / transform.scale;
    if (!clamp && (px < 0 || py < 0 || px > width || py > height)) return null;
    return {x: Math.min(width, Math.max(0, px)), y: Math.min(height, Math.max(0, py))};
}

export function makeAnnotation(tool, start, end, lineWidth = 4) {
    if (!['rectangle', 'arrow'].includes(tool) || !start || !end ||
        ![start.x, start.y, end.x, end.y, lineWidth].every(Number.isFinite)) return null;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 3) return null;
    return {tool, start: {...start}, end: {...end}, lineWidth: Math.max(1, Math.min(16, lineWidth)), color: '#ff3b30'};
}

export function rectangleBounds(shape) {
    return {x: Math.min(shape.start.x, shape.end.x), y: Math.min(shape.start.y, shape.end.y),
        width: Math.abs(shape.end.x - shape.start.x), height: Math.abs(shape.end.y - shape.start.y)};
}

export function arrowHead(shape) {
    const angle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
    const length = Math.min(Math.hypot(shape.end.x - shape.start.x, shape.end.y - shape.start.y) * 0.45, Math.max(12, shape.lineWidth * 4));
    return [shape.end,
        {x: shape.end.x - length * Math.cos(angle - Math.PI / 6), y: shape.end.y - length * Math.sin(angle - Math.PI / 6)},
        {x: shape.end.x - length * Math.cos(angle + Math.PI / 6), y: shape.end.y - length * Math.sin(angle + Math.PI / 6)}];
}

export class AnnotationDocument {
    constructor() { this.shapes = []; this.undoStack = []; this.redoStack = []; }
    add(shape) {
        const value = shape && makeAnnotation(shape.tool, shape.start, shape.end, shape.lineWidth);
        if (!value) return false;
        if (this.shapes.length >= 500) throw new Error('最多添加 500 个标注，请先保存图片。');
        this.undoStack.push(this.shapes); this.shapes = [...this.shapes, value]; this.redoStack = [];
        return true;
    }
    undo() {
        if (!this.undoStack.length) return false;
        this.redoStack.push(this.shapes); this.shapes = this.undoStack.pop(); return true;
    }
    redo() {
        if (!this.redoStack.length) return false;
        this.undoStack.push(this.shapes); this.shapes = this.redoStack.pop(); return true;
    }
    clear() {
        if (!this.shapes.length) return;
        this.undoStack.push(this.shapes); this.shapes = []; this.redoStack = [];
    }
    get signature() { return JSON.stringify(this.shapes); }
}
