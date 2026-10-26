import test from 'node:test';
import assert from 'node:assert/strict';
import {fitImage, imagePoint, makeAnnotation, rectangleBounds, arrowHead, AnnotationDocument} from '../extension/core/annotations.js';

test('reverse drags produce normalized rectangle bounds', () => {
    const shape = makeAnnotation('rectangle', {x: 150, y: 120}, {x: 25, y: 30});
    assert.deepEqual(rectangleBounds(shape), {x: 25, y: 30, width: 125, height: 90});
});
test('view transforms retain original image coordinates at different preview sizes', () => {
    for (const view of [[1200, 800], [640, 480]]) {
        const fit = fitImage(1920, 1080, ...view);
        const point = imagePoint(fit.x + 555 * fit.scale, fit.y + 321 * fit.scale, fit, 1920, 1080);
        assert.ok(Math.abs(point.x - 555) < 1e-8);
        assert.ok(Math.abs(point.y - 321) < 1e-8);
        assert.equal(imagePoint(-100, -100, fit, 1920, 1080), null);
        assert.deepEqual(imagePoint(-100, -100, fit, 1920, 1080, true), {x: 0, y: 0});
    }
});
test('arrow head points at the drag endpoint and remains proportional on short arrows', () => {
    const shape = makeAnnotation('arrow', {x: 10, y: 50}, {x: 100, y: 50}, 4);
    const [tip, a, b] = arrowHead(shape);
    assert.deepEqual(tip, {x: 100, y: 50});
    assert.ok(a.x < tip.x && b.x < tip.x && a.y !== b.y);
    assert.equal(makeAnnotation('arrow', {x: 1, y: 1}, {x: 1, y: 1}), null);
    assert.equal(makeAnnotation('unknown', {x: 1, y: 1}, {x: 10, y: 10}), null);
    assert.equal(makeAnnotation('rectangle', {x: NaN, y: 0}, {x: 10, y: 10}), null);
});
test('annotations undo, redo and clear without mutating earlier snapshots', () => {
    const document = new AnnotationDocument();
    document.add(makeAnnotation('rectangle', {x: 5, y: 5}, {x: 30, y: 30}));
    const first = document.signature;
    document.add(makeAnnotation('arrow', {x: 40, y: 30}, {x: 60, y: 15}));
    assert.equal(document.shapes.length, 2);
    document.undo(); assert.equal(document.signature, first);
    document.redo(); assert.equal(document.shapes.length, 2);
    document.clear(); assert.equal(document.shapes.length, 0);
    document.undo(); assert.equal(document.shapes.length, 2);
    document.undo();
    document.add(makeAnnotation('arrow', {x: 5, y: 15}, {x: 60, y: 15}));
    assert.equal(document.redo(), false);
    assert.equal(document.undoStack[0].length, 0);
});
