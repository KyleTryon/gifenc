import test from "node:test";
import assert from "node:assert/strict";
import { GifReader } from "omggif";
import { GIFEncoder } from "../dist/gifenc.mjs";

const palette = [
  [10, 20, 30],
  [200, 210, 220],
];

function write(gif, indexes) {
  gif.writeFrame(Uint8Array.from(indexes), indexes.length, 1, { palette });
  gif.finish();
}

function decode(bytes) {
  const reader = new GifReader(bytes);
  const pixels = new Uint8Array(reader.width * reader.height * 4);
  reader.decodeAndBlitFrameRGBA(0, pixels);
  return pixels;
}

test("takeBytes releases only the written range and survives transfer and reuse", () => {
  const gif = GIFEncoder({ initialCapacity: 4096 });
  write(gif, [0, 1]);
  const copy = gif.bytes();
  const oldView = gif.bytesView();
  const originalBuffer = gif.buffer;
  const taken = gif.takeBytes();
  assert.equal(taken.buffer, originalBuffer);
  assert.equal(taken.byteOffset, 0);
  assert.ok(taken.byteLength < taken.buffer.byteLength);
  assert.deepEqual(taken, copy);
  assert.equal(gif.bytesView().length, 0);
  assert.notEqual(gif.buffer, taken.buffer);
  assert.deepEqual(oldView, taken);
  const received = structuredClone(taken, { transfer: [taken.buffer] });
  assert.equal(taken.byteLength, 0);
  assert.equal(oldView.byteLength, 0);
  assert.deepEqual(
    decode(received),
    Uint8Array.from([10, 20, 30, 255, 200, 210, 220, 255]),
  );
  write(gif, [1]);
  assert.deepEqual(
    decode(gif.takeBytes()),
    Uint8Array.from([200, 210, 220, 255]),
  );
  assert.deepEqual(copy, received);
});

test("reset retains capacity, copies stay independent, and released spare capacity is zero", () => {
  const gif = GIFEncoder({ initialCapacity: 1024 });
  write(gif, Array(200).fill(1));
  const before = gif.bytes();
  const buffer = gif.buffer;
  const view = gif.bytesView();
  gif.reset();
  assert.equal(gif.buffer, buffer);
  write(gif, [0]);
  assert.notDeepEqual(view, before);
  const taken = gif.takeBytes();
  assert.equal(taken.buffer, buffer);
  assert.ok(
    new Uint8Array(buffer, taken.byteLength).every((byte) => byte === 0),
  );
  assert.equal(new GifReader(before).width, 200);
  assert.equal(new GifReader(taken).width, 1);
  assert.equal(gif.takeBytes().byteLength, 0);
});

test("repeated extraction preserves output across growth and reset cycles", () => {
  const reusable = GIFEncoder({ initialCapacity: 0 });
  for (let i = 0; i < 20; i++) {
    const indexes = Array.from({ length: i * 17 + 1 }, (_, j) => (i + j) % 2);
    const fresh = GIFEncoder();
    write(reusable, indexes);
    write(fresh, indexes);
    const bytes = reusable.takeBytes();
    assert.deepEqual(bytes, fresh.bytes());
    assert.deepEqual(decode(bytes), decode(fresh.bytes()));
  }
});

test("low-level stream extraction resets the stream and returns its transferable storage", () => {
  const gif = GIFEncoder({ initialCapacity: 8 });
  gif.stream.writeBytes([1, 2, 3]);
  const buffer = gif.stream.buffer;
  const bytes = gif.stream.takeBytes();
  assert.equal(bytes.buffer, buffer);
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(gif.stream.bytesView().length, 0);
  structuredClone(bytes, { transfer: [bytes.buffer] });
  gif.stream.writeByte(4);
  assert.deepEqual([...gif.stream.bytes()], [4]);
});

test("extraction handles empty and exactly full buffers", () => {
  const gif = GIFEncoder({ initialCapacity: 3 });
  const empty = gif.takeBytes();
  assert.equal(empty.byteLength, 0);
  assert.deepEqual([...new Uint8Array(empty.buffer)], [0, 0, 0]);
  const exact = GIFEncoder({ initialCapacity: 3 });
  exact.stream.writeBytes([7, 8, 9]);
  const result = exact.takeBytes();
  assert.equal(result.byteLength, result.buffer.byteLength);
  assert.deepEqual([...result], [7, 8, 9]);
});
