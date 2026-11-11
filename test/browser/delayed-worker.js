import "../../examples/browser/worker.js";

// Exercise the real encoder while forcing frame zero to complete last.
const post = self.postMessage.bind(self);
self.postMessage = (data, transfer) => {
  if (Array.isArray(data)) {
    setTimeout(() => post(data, transfer), data[1] === 0 ? 200 : 60);
  } else {
    post(data, transfer);
  }
};
