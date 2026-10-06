// The mixer's output on the web, the C++ side. The JavaScript is beside it: WebAudioOutput.js runs
// on the main thread (an Emscripten library) and WebAudioWorklet.js on the audio thread.
//
// To top up the worklet, WebAudioOutput.js calls port_web_audio_mix to mix into g_mixBuffer, which
// lives in wasm memory, and copies the frames out from there.

#if defined(__EMSCRIPTEN__)

#include "audio/WebAudioOutput.h"

#include <emscripten.h>
#include <vector>
#include "audio/Mixer.h"

// In WebAudioOutput.js.
extern "C" int port_web_audio_open(float* mixBuffer, int mixBufferFrames);
extern "C" void port_web_audio_close();

namespace {

port::audio::Mixer* g_outputMixer = 0;
//! The most frames WebAudioOutput.js mixes at a time, and the interleaved stereo buffer it mixes into.
const int MIX_BUFFER_FRAMES = 1024;
std::vector<float> g_mixBuffer(MIX_BUFFER_FRAMES * 2);

} // end anonymous namespace

//! Mixes `frames` (at most MIX_BUFFER_FRAMES) into g_mixBuffer; called from WebAudioOutput.js.
extern "C" EMSCRIPTEN_KEEPALIVE void port_web_audio_mix(int frames)
{
    if (g_outputMixer)
        g_outputMixer->mix(&g_mixBuffer[0], (ma_uint32)frames);
}

namespace port {
namespace audio {

unsigned int startWebAudioOutput(Mixer* mixer)
{
    g_outputMixer = mixer;
    int rate = port_web_audio_open(&g_mixBuffer[0], MIX_BUFFER_FRAMES);
    if (rate <= 0)
        g_outputMixer = 0;
    return rate > 0 ? (unsigned int)rate : 0;
}

void stopWebAudioOutput()
{
    port_web_audio_close();
    g_outputMixer = 0;
}

} // end namespace audio
} // end namespace port

#endif
