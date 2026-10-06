// The mixer's output on the web.
//
// miniaudio's Web Audio device is a ScriptProcessorNode (deprecated), and its AudioWorklet device
// needs wasm workers and shared memory, so a cross-origin isolated page. Instead the main thread
// mixes: a timer keeps about 80 ms of mixed stereo queued ahead of the AudioWorklet, which only plays
// the blocks it is sent (transferred, not copied) and reports how many frames it has played. A long
// game frame eats into that margin instead of cutting the sound.

#if defined(__EMSCRIPTEN__)

#include "audio/WebAudioOutput.h"

#include <emscripten.h>
#include <vector>
#include "audio/Mixer.h"

namespace {

port::audio::Mixer* g_mixer = 0;
//! The block the pump asks for at a time, in frames, and its interleaved stereo buffer.
const int BLOCK_FRAMES = 1024;
std::vector<float> g_block(BLOCK_FRAMES * 2);

} // end anonymous namespace

//! Mixes `frames` (at most BLOCK_FRAMES) into the block buffer; called by the pump.
extern "C" EMSCRIPTEN_KEEPALIVE void port_audio_render(int frames)
{
    if (g_mixer)
        g_mixer->mix(&g_block[0], (ma_uint32)frames);
}

// The worklet processor: a queue of interleaved stereo blocks, played into two output channels,
// silence when it runs dry, and the played frame count posted back every few render quanta.
EM_JS(int, harvestAudioStart, (float* block, int blockFrames), {
    var Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context || !globalThis.AudioWorkletNode)
        return 0;
    var a = Module.harvestAudio = {
        ctx: new Context({ latencyHint: "interactive" }),
        node: null,
        timer: 0,
        sent: 0,
        played: 0,
    };
    a.target = Math.round(a.ctx.sampleRate * 0.08);

    var processor = `
class HarvestOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.at = 0;
    this.played = 0;
    this.quanta = 0;
    this.running = true;
    this.port.onmessage = (e) => { if (e.data === "stop") this.running = false; else this.queue.push(e.data); };
  }
  process(inputs, outputs) {
    const left = outputs[0][0], right = outputs[0][1] || left;
    let i = 0;
    while (i < left.length && this.queue.length) {
      const block = this.queue[0];
      const take = Math.min(block.length / 2 - this.at, left.length - i);
      for (let k = 0; k < take; k++) {
        left[i + k] = block[2 * (this.at + k)];
        right[i + k] = block[2 * (this.at + k) + 1];
      }
      i += take;
      this.at += take;
      this.played += take;
      if (2 * this.at >= block.length) { this.queue.shift(); this.at = 0; }
    }
    left.fill(0, i);
    right.fill(0, i);
    if (++this.quanta % 4 === 0) this.port.postMessage(this.played);
    return this.running;
  }
}
registerProcessor("harvest-output", HarvestOutput);`;

    // Keeps `target` frames queued ahead of what the worklet has played.
    a.pump = function() {
        if (!a.node || a.ctx.state !== "running")
            return;
        var queued = a.sent - a.played;
        while (queued < a.target) {
            var frames = Math.min(blockFrames, a.target - queued);
            _port_audio_render(frames);
            var start = block >> 2;
            var chunk = HEAPF32.slice(start, start + 2 * frames);
            a.node.port.postMessage(chunk, [chunk.buffer]);
            a.sent += frames;
            queued += frames;
        }
    };

    var url = URL.createObjectURL(new Blob([processor], { type: "text/javascript" }));
    a.ctx.audioWorklet.addModule(url).then(function() {
        a.node = new AudioWorkletNode(a.ctx, "harvest-output", { numberOfInputs: 0, outputChannelCount: [2] });
        a.node.port.onmessage = function(e) { a.played = e.data; };
        a.node.connect(a.ctx.destination);
        a.timer = setInterval(a.pump, 10);
        a.pump();
    }).catch(function(err) { console.warn("cannot start the audio worklet:", err); });

    // Browsers start an AudioContext suspended until the player clicks or types.
    var events = ["pointerdown", "keydown", "touchend"];
    a.unlock = function() {
        a.ctx.resume();
        if (a.ctx.state === "running")
            events.forEach(function(e) { document.removeEventListener(e, a.unlock, true); });
    };
    events.forEach(function(e) { document.addEventListener(e, a.unlock, true); });
    a.ctx.addEventListener("statechange", a.pump);
    if (a.ctx.state !== "running")
        a.ctx.resume();
    return a.ctx.sampleRate;
});

EM_JS(void, harvestAudioStop, (), {
    var a = Module.harvestAudio;
    if (!a)
        return;
    clearInterval(a.timer);
    if (a.node)
        a.node.port.postMessage("stop");
    a.ctx.close();
    Module.harvestAudio = null;
});

namespace port {
namespace audio {

unsigned int startWebAudioOutput(Mixer* mixer)
{
    g_mixer = mixer;
    int rate = harvestAudioStart(&g_block[0], BLOCK_FRAMES);
    if (rate <= 0)
        g_mixer = 0;
    return rate > 0 ? (unsigned int)rate : 0;
}

void stopWebAudioOutput()
{
    harvestAudioStop();
    g_mixer = 0;
}

} // end namespace audio
} // end namespace port

#endif
