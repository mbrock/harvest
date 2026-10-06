// The game's audio output on the web: an AudioWorklet processor that only plays.
//
// It runs on the browser's audio rendering thread, which calls process() for every render quantum
// (128 frames) while the context runs. The page's main thread mixes ahead of it (see
// port/src/audio/web_audio.js) and posts blocks of interleaved stereo float samples; this queues
// them, copies them into the two output channels, plays silence when the queue runs dry, and posts
// back how many frames it has played so the main thread knows how far ahead it is.

class HarvestOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = []; // Float32Arrays of interleaved stereo frames
    this.offset = 0; // frames of queue[0] already played
    this.played = 0; // frames played since the start
    this.quanta = 0;
    this.running = true;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.running = false;
      else this.queue.push(event.data);
    };
  }

  process(inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1] || left;
    let i = 0;
    while (i < left.length && this.queue.length) {
      const block = this.queue[0];
      const frames = Math.min(block.length / 2 - this.offset, left.length - i);
      for (let k = 0; k < frames; k++) {
        left[i + k] = block[2 * (this.offset + k)];
        right[i + k] = block[2 * (this.offset + k) + 1];
      }
      i += frames;
      this.offset += frames;
      this.played += frames;
      if (2 * this.offset >= block.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    left.fill(0, i);
    right.fill(0, i);
    // Every fourth quantum (about 10 ms) is often enough for the main thread's pump.
    if (++this.quanta % 4 === 0) this.port.postMessage(this.played);
    return this.running;
  }
}

registerProcessor("harvest-output", HarvestOutput);
