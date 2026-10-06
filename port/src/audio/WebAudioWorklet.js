// The game's audio output on the web, the worklet half: an AudioWorklet processor that only plays.
//
// It runs on the browser's audio rendering thread, which calls process() for every render quantum
// (128 frames) while the context runs. The main thread mixes ahead of it (WebAudioOutput.js) and
// posts blocks of interleaved stereo float samples; this queues them, copies them into the two
// output channels, plays silence when the queue runs dry, and posts back how many frames it has
// played so the main thread knows how far ahead it is. build.zig installs it beside the page.

class QueuedOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blocks = []; // Float32Arrays of interleaved stereo frames, oldest first
    this.blockOffset = 0; // frames of blocks[0] already played
    this.framesPlayed = 0; // since the start
    this.quantaSinceReport = 0;
    this.running = true;
    this.port.onmessage = (event) => {
      if (event.data === "stop") this.running = false;
      else this.blocks.push(event.data);
    };
  }

  process(inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1] || left;
    let written = 0;
    while (written < left.length && this.blocks.length) {
      const block = this.blocks[0];
      const frames = Math.min(block.length / 2 - this.blockOffset, left.length - written);
      for (let i = 0; i < frames; i++) {
        left[written + i] = block[2 * (this.blockOffset + i)];
        right[written + i] = block[2 * (this.blockOffset + i) + 1];
      }
      written += frames;
      this.blockOffset += frames;
      this.framesPlayed += frames;
      if (2 * this.blockOffset >= block.length) {
        this.blocks.shift();
        this.blockOffset = 0;
      }
    }
    left.fill(0, written);
    right.fill(0, written);
    // Every fourth quantum (about 10 ms) is often enough for the main thread.
    if (++this.quantaSinceReport === 4) {
      this.quantaSinceReport = 0;
      this.port.postMessage(this.framesPlayed);
    }
    return this.running;
  }
}

registerProcessor("queued-output", QueuedOutput);
