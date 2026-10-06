// The main-thread half of the game's audio output on the web, an Emscripten JS library (linked with
// --js-library; port/src/audio/WebAudioOutput.cpp declares these functions).
//
// The mixer runs on this thread: a timer calls the wasm export port_audio_render, which mixes a block
// into a buffer in wasm memory, copies it out and transfers it to the worklet (port/web/
// audio-worklet.js), keeping TARGET_SECONDS of audio queued ahead of what the worklet has played. A
// long frame on this thread eats into that margin instead of cutting the sound.

addToLibrary({
  // block: the byte address of the C++ buffer port_audio_render mixes into, room for blockFrames
  // frames of interleaved stereo floats. Returns the sample rate to mix at, or 0 without Web Audio.
  harvest_audio_start__deps: ["port_audio_render"],
  harvest_audio_start: function (block, blockFrames) {
    const TARGET_SECONDS = 0.08;
    const PUMP_MILLISECONDS = 10;

    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context || !globalThis.AudioWorkletNode) return 0;

    const audio = {
      context: new Context({ latencyHint: "interactive" }),
      node: null,
      timer: 0,
      sent: 0, // frames sent to the worklet
      played: 0, // frames the worklet reports played
    };
    Module.harvestAudio = audio;
    const target = Math.round(audio.context.sampleRate * TARGET_SECONDS);

    // Mixes and sends blocks until `target` frames are queued ahead of the worklet.
    audio.pump = () => {
      if (!audio.node || audio.context.state !== "running") return;
      let queued = audio.sent - audio.played;
      while (queued < target) {
        const frames = Math.min(blockFrames, target - queued);
        _port_audio_render(frames);
        const start = block / 4; // HEAPF32 is indexed in floats
        const samples = HEAPF32.slice(start, start + 2 * frames);
        audio.node.port.postMessage(samples, [samples.buffer]);
        audio.sent += frames;
        queued += frames;
      }
    };

    audio.context.audioWorklet.addModule("audio-worklet.js").then(() => {
      audio.node = new AudioWorkletNode(audio.context, "harvest-output", {
        numberOfInputs: 0,
        outputChannelCount: [2],
      });
      audio.node.port.onmessage = (event) => { audio.played = event.data; };
      audio.node.connect(audio.context.destination);
      audio.timer = setInterval(audio.pump, PUMP_MILLISECONDS);
      audio.pump();
    }).catch((error) => console.warn("cannot start the audio worklet:", error));

    // Browsers keep a new AudioContext suspended until the player clicks or presses a key.
    const unlockEvents = ["pointerdown", "keydown", "touchend"];
    audio.unlock = () => {
      audio.context.resume();
      if (audio.context.state === "running")
        for (const name of unlockEvents) document.removeEventListener(name, audio.unlock, true);
    };
    for (const name of unlockEvents) document.addEventListener(name, audio.unlock, true);
    audio.context.addEventListener("statechange", audio.pump);
    if (audio.context.state !== "running") audio.context.resume();

    return audio.context.sampleRate;
  },

  harvest_audio_stop: function () {
    const audio = Module.harvestAudio;
    if (!audio) return;
    clearInterval(audio.timer);
    if (audio.node) audio.node.port.postMessage("stop");
    audio.context.close();
    Module.harvestAudio = null;
  },
});
