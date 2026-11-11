import assert from "node:assert/strict";
import test from "node:test";
import { GIFEncoder } from "../dist/gifenc.mjs";

for (const method of ["writeBytes", "writeBytesView"]) {
  test(`${method} writes ranges relative to the source view`, () => {
    const stream = GIFEncoder({ initialCapacity: 4 }).stream;
    const data = new Uint8Array([99, 10, 20, 30, 99]).subarray(1, 4);
    stream[method](data, 1);
    assert.deepEqual([...stream.bytes()], [20, 30]);
    stream[method](data, 0, 1);
    stream[method](data, data.length, 0);
    stream[method](data, data.length);
    stream[method](data, 1, 2); // grows the original capacity
    assert.deepEqual([...stream.bytes()], [20, 30, 10, 20, 30]);
    stream.reset();
    stream[method](data, 2);
    assert.deepEqual([...stream.bytes()], [30]);
  });

  test(`${method} rejects invalid ranges without changing the stream`, () => {
    const stream = GIFEncoder({ initialCapacity: 4 }).stream;
    const data = new Uint8Array([10, 20]);
    stream.writeByte(7);
    const buffer = stream.buffer;
    for (const [offset, length] of [
      [-1, 1],
      [0, -1],
      [0.5, 1],
      [0, 0.5],
      [NaN, 1],
      [0, NaN],
      [Infinity, 1],
      [0, Infinity],
      [3, 0],
      [1, 2],
      [0, 1000],
      [Number.MAX_SAFE_INTEGER + 1, 0],
    ]) {
      assert.throws(() => stream[method](data, offset, length), RangeError);
      assert.deepEqual([...stream.bytes()], [7]);
      assert.equal(stream.buffer, buffer);
    }
    assert.throws(() => stream[method](data, 3), RangeError);
    assert.deepEqual([...stream.bytes()], [7]);
    stream[method](data);
    assert.deepEqual([...stream.bytes()], [7, 10, 20]);
  });
}

test("writeBytes rejects an oversized array range before appending", () => {
  const stream = GIFEncoder({ initialCapacity: 4 }).stream;
  stream.writeByte(9);
  assert.throws(() => stream.writeBytes([1], 0, 3), RangeError);
  assert.deepEqual([...stream.bytes()], [9]);
});
