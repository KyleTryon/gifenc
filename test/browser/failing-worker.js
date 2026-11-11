self.addEventListener("message", (event) => {
  if (event.data.event === "init") self.postMessage("ready");
  else throw new Error("intentional frame failure");
});
