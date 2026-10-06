// The game's audio output on the web, the main-thread half: an Emscripten JS library (linked with
// --js-library; WebAudioOutput.cpp declares these functions).
//
// The mixer runs on this thread. A timer tops up the worklet (WebAudioWorklet.js): it calls the wasm
// export port_web_audio_mix, which mixes into the C++ mix buffer in wasm memory, copies those frames
// out and transfers them to the worklet, until SECONDS_AHEAD of audio is queued ahead of what the
// worklet has played. A long frame on this thread eats into that margin instead of cutting the sound.

addToLibrary({
  // mixBuffer: the byte address of the C++ mix buffer, room for mixBufferFrames frames of
  // interleaved stereo floats. Returns the sample rate to mix at, or 0 without Web Audio.
  port_web_audio_open__deps: ["port_web_audio_mix"],
  port_web_audio_open: function (mixBuffer, mixBufferFrames) {
    const SECONDS_AHEAD = 0.08;
    const TOP_UP_MILLISECONDS = 10;

    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context || !globalThis.AudioWorkletNode) return 0;

    const output = {
      context: new Context({ latencyHint: "interactive" }),
      worklet: null,
      timer: 0,
      framesSent: 0,
      framesPlayed: 0, // as the worklet last reported
    };
    Module.webAudioOutput = output;
    const framesAhead = Math.round(output.context.sampleRate * SECONDS_AHEAD);

    // Mixes and sends frames until framesAhead are queued ahead of the worklet.
    output.topUp = () => {
      if (!output.worklet || output.context.state !== "running") return;
      let queued = output.framesSent - output.framesPlayed;
      while (queued < framesAhead) {
        const frames = Math.min(mixBufferFrames, framesAhead - queued);
        _port_web_audio_mix(frames);
        const start = mixBuffer / 4; // HEAPF32 is indexed in floats
        const block = HEAPF32.slice(start, start + 2 * frames);
        output.worklet.port.postMessage(block, [block.buffer]);
        output.framesSent += frames;
        queued += frames;
      }
    };

    output.context.audioWorklet.addModule("WebAudioWorklet.js").then(() => {
      output.worklet = new AudioWorkletNode(output.context, "queued-output", {
        numberOfInputs: 0,
        outputChannelCount: [2],
      });
      output.worklet.port.onmessage = (event) => { output.framesPlayed = event.data; };
      output.worklet.connect(output.context.destination);
      output.timer = setInterval(output.topUp, TOP_UP_MILLISECONDS);
      output.topUp();
    }).catch((error) => console.warn("cannot start the audio worklet:", error));

    // Browsers keep a new AudioContext suspended until the player clicks or presses a key.
    const unlockEvents = ["pointerdown", "keydown", "touchend"];
    output.unlock = () => {
      output.context.resume();
      if (output.context.state === "running")
        for (const name of unlockEvents) document.removeEventListener(name, output.unlock, true);
    };
    for (const name of unlockEvents) document.addEventListener(name, output.unlock, true);
    output.context.addEventListener("statechange", output.topUp);
    if (output.context.state !== "running") output.context.resume();

    return output.context.sampleRate;
  },

  port_web_audio_close: function () {
    const output = Module.webAudioOutput;
    if (!output) return;
    clearInterval(output.timer);
    if (output.worklet) output.worklet.port.postMessage("stop");
    output.context.close();
    Module.webAudioOutput = null;
  },
});
