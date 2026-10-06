// The mixer's output on the web: the C++ side. The JavaScript is in web_audio.js (the main thread's
// pump, linked as an Emscripten library) and port/web/audio-worklet.js (the worklet that plays).
//
// The pump calls port_audio_render to mix one block into g_block, which lives in wasm memory, and
// copies it out from there.

#if defined(__EMSCRIPTEN__)

#include "audio/WebAudioOutput.h"

#include <emscripten.h>
#include <vector>
#include "audio/Mixer.h"

// In web_audio.js.
extern "C" int harvest_audio_start(float* block, int blockFrames);
extern "C" void harvest_audio_stop();

namespace {

port::audio::Mixer* g_mixer = 0;
//! The most frames the pump asks for at a time, and the interleaved stereo buffer they are mixed into.
const int BLOCK_FRAMES = 1024;
std::vector<float> g_block(BLOCK_FRAMES * 2);

} // end anonymous namespace

//! Mixes `frames` (at most BLOCK_FRAMES) into g_block; called by the pump in web_audio.js.
extern "C" EMSCRIPTEN_KEEPALIVE void port_audio_render(int frames)
{
    if (g_mixer)
        g_mixer->mix(&g_block[0], (ma_uint32)frames);
}

namespace port {
namespace audio {

unsigned int startWebAudioOutput(Mixer* mixer)
{
    g_mixer = mixer;
    int rate = harvest_audio_start(&g_block[0], BLOCK_FRAMES);
    if (rate <= 0)
        g_mixer = 0;
    return rate > 0 ? (unsigned int)rate : 0;
}

void stopWebAudioOutput()
{
    harvest_audio_stop();
    g_mixer = 0;
}

} // end namespace audio
} // end namespace port

#endif
